import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { EventEmitter } from "node:events";
import { registerShutdown } from "@/init/shutdown";
import {
  acquireChannelLockForTurn,
  channelLocks,
  getOrCreateChannelLockEntry,
  releaseChannelLockAndReplayQueue,
} from "@/utils/chat/channelQueue";
import * as shutdownState from "@/utils/misc/shutdownState";
import { log } from "@/utils/misc/logger";

const nativeSetTimeout = globalThis.setTimeout;
const timers = new Map<number, () => void>();
let draining = false;
let restore: Array<() => void> = [];

beforeEach(() => {
  draining = false;
  timers.clear();
  const isDraining = spyOn(shutdownState, "isDraining").mockImplementation(() => draining);
  const beginDrain = spyOn(shutdownState, "beginDrain").mockImplementation(() => {
    draining = true;
  });
  const warn = spyOn(log, "warn").mockImplementation(() => {});
  const timeout = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, ms: number) => {
    const timer = nativeSetTimeout(() => {}, 60_000);
    timer.unref();
    timers.set(ms, callback);
    return timer;
  }) as typeof setTimeout);
  restore = [
    () => timeout.mockRestore(),
    () => warn.mockRestore(),
    () => beginDrain.mockRestore(),
    () => isDraining.mockRestore(),
  ];
});

afterEach(() => {
  for (const reset of restore) reset();
  channelLocks.clear();
});

function fixture() {
  const events = new EventEmitter();
  const order: string[] = [];
  const destroy = mock(async () => {
    order.push("destroy");
  });
  const exit = mock((_code: number) => {
    order.push("exit");
  });
  const cleanup = {
    stopScheduledWork: mock(() => {
      order.push("stop");
    }),
    flushStats: mock(async () => {
      order.push("stats");
    }),
    cleanupMcp: mock(async () => {
      order.push("mcp");
    }),
    cleanupCoordination: mock(async () => {
      order.push("coordination");
    }),
  };
  const client = { destroy };
  const runtime = { on: events.on.bind(events), exit };
  const controller = registerShutdown(client, cleanup, runtime);
  return { events, order, destroy, exit, cleanup, client, runtime, controller };
}

function activeTurn() {
  const entry = getOrCreateChannelLockEntry("shutdown-channel", "300000000000000035");
  acquireChannelLockForTurn(entry, {
    messageId: "active",
    userDiscId: "100000000000000025",
    isPersonaJob: false,
    isCommandTriggered: false,
  });
  return entry;
}

async function reachStep(work: () => boolean) {
  for (let turn = 0; turn < 100 && !work(); turn++) await Promise.resolve();
  expect(work()).toBe(true);
}

describe("bounded shutdown", () => {
  it("owns both signals before ready and runs ordered cleanup once", async () => {
    const f = fixture();
    expect(registerShutdown(f.client, f.cleanup, f.runtime)).toBe(f.controller);
    expect(f.events.listenerCount("SIGTERM")).toBe(1);
    expect(f.events.listenerCount("SIGINT")).toBe(1);
    f.events.emit("SIGTERM");
    expect(draining).toBe(true);
    expect(f.order).toEqual(["stop"]);
    f.events.emit("SIGINT");
    const first = f.controller.shutdown();
    expect(f.controller.shutdown()).toBe(first);
    await first;
    expect(f.order).toEqual(["stop", "stats", "mcp", "coordination", "destroy", "exit"]);
    expect(f.exit).toHaveBeenCalledWith(0);
  });

  it("keeps the client usable until an existing turn releases", async () => {
    const entry = activeTurn();
    const signal = entry.activeTurnAbortController?.signal;
    const f = fixture();
    const done = f.controller.shutdown();
    await Promise.resolve();
    expect(f.destroy).not.toHaveBeenCalled();
    expect(f.cleanup.flushStats).not.toHaveBeenCalled();
    expect(signal?.aborted).toBe(false);
    releaseChannelLockAndReplayQueue({
      channelId: "shutdown-channel",
      lockEntry: entry,
      completedMessageId: "active",
      handleStopResponse: async () => {},
      processQueuedMessage: async () => {},
    });
    await done;
    expect(f.exit).toHaveBeenCalledWith(0);
  });

  it("aborts a turn at 25 seconds before stats and later cleanup", async () => {
    const entry = activeTurn();
    const signal = entry.activeTurnAbortController?.signal;
    const f = fixture();
    entry.activeStreamKill = mock(() => {
      f.order.push("abort");
    });
    const done = f.controller.shutdown();
    await reachStep(() => timers.has(25_000));
    expect(timers.has(38_000)).toBe(true);
    expect(f.destroy).not.toHaveBeenCalled();
    timers.get(25_000)?.();
    await done;
    expect(signal?.aborted).toBe(true);
    expect(f.order.indexOf("abort")).toBeLessThan(f.order.indexOf("stats"));
    expect(f.destroy).toHaveBeenCalledTimes(1);
  });

  it("owner loss interrupts an already draining turn immediately", async () => {
    const entry = activeTurn();
    const signal = entry.activeTurnAbortController?.signal;
    const kill = mock(() => {});
    entry.activeStreamKill = kill;
    const f = fixture();
    const done = f.controller.shutdown();
    expect(f.controller.shutdown({ immediate: true, exitCode: 1 })).toBe(done);
    expect(signal?.aborted).toBe(true);
    await done;
    expect(kill).toHaveBeenCalledTimes(1);
    expect(f.exit).toHaveBeenCalledWith(1);
  });

  it("continues after a failed cleanup and bounds stalled cleanup steps", async () => {
    const f = fixture();
    f.cleanup.flushStats.mockImplementation(async () => {
      throw new Error("unavailable");
    });
    f.cleanup.cleanupMcp.mockImplementation(() => new Promise<void>(() => {}));
    const done = f.controller.shutdown();
    await reachStep(() => f.cleanup.cleanupMcp.mock.calls.length > 0);
    timers.get(3_000)?.();
    await done;
    expect(f.cleanup.cleanupCoordination).toHaveBeenCalledTimes(1);
    expect(f.destroy).toHaveBeenCalledTimes(1);
    expect(f.exit).toHaveBeenCalledWith(1);
  });

  it("continues cleanup even if stopping scheduled dispatch throws", async () => {
    const f = fixture();
    f.cleanup.stopScheduledWork.mockImplementation(() => {
      throw new Error("stop failed");
    });
    await f.controller.shutdown();
    expect(f.cleanup.flushStats).toHaveBeenCalledTimes(1);
    expect(f.destroy).toHaveBeenCalledTimes(1);
    expect(f.exit).toHaveBeenCalledWith(1);
  });

  it("bounds coordination and client destruction failures too", async () => {
    const f = fixture();
    f.cleanup.cleanupCoordination.mockImplementation(() => new Promise<void>(() => {}));
    f.destroy.mockImplementation(() => new Promise<void>(() => {}));
    const done = f.controller.shutdown();
    await reachStep(() => f.cleanup.cleanupCoordination.mock.calls.length > 0);
    timers.get(3_000)?.();
    await reachStep(() => f.destroy.mock.calls.length > 0);
    timers.get(1_000)?.();
    await done;
    expect(f.exit).toHaveBeenCalledWith(1);
  });
});
