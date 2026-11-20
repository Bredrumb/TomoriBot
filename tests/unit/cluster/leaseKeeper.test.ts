import { describe, expect, test } from "bun:test";
import { LeaseKeeper, type CoordinationClock, type LeaseState, type LeaseStore } from "@/utils/cluster/leaseKeeper";
import { ShardLeaseCoordinator } from "@/utils/cluster/shardLeases";
import { parseShardTopology } from "@/utils/discord/shardOwnership";

function fixture() {
  let now = 0;
  const scheduled = new Set<{ callback: () => void; at: number }>();
  const states: LeaseState[] = [];
  let losses = 0;
  const clock: CoordinationClock = {
    now: () => now,
    sleep: async (ms, signal) => {
      signal.throwIfAborted();
      now += ms;
    },
    schedule(callback, ms) {
      const timer = { callback, at: now + ms };
      scheduled.add(timer);
      return () => {
        scheduled.delete(timer);
      };
    },
  };
  const repository: LeaseStore = {
    takeIfExpired: async () => ({ token: "1" }),
    renew: async () => ({ token: "1" }),
    release: async () => true,
  };
  const callbacks = {
    onLost: () => {
      losses++;
    },
    onStateChange: (state: LeaseState) => {
      states.push(state);
    },
  };
  return {
    clock,
    repository,
    callbacks,
    states,
    losses: () => losses,
    setTime: (value: number) => {
      now = value;
    },
    async advance(ms: number) {
      now += ms;
      for (const timer of [...scheduled]) {
        if (timer.at <= now && scheduled.delete(timer)) timer.callback();
      }
      for (let i = 0; i < 10; i++) await Promise.resolve();
    },
    keeper: () => new LeaseKeeper(["shard:0", "shard:1"], "incarnation-a", callbacks, repository, clock),
  };
}

describe("lease keeper", () => {
  test("starts the safety clock before acquisition and renewal queries", async () => {
    const f = fixture();
    f.repository.takeIfExpired = async () => {
      f.setTime(f.clock.now() + 2_000);
      return { token: "1" };
    };
    f.repository.renew = async () => {
      f.setTime(f.clock.now() + 2_000);
      return { token: "1" };
    };
    const keeper = f.keeper();
    expect(await keeper.acquire(new AbortController().signal)).toBe(true);
    expect(keeper.safetyDeadline).toBe(25_000);
    await f.advance(10_000);
    expect(keeper.safetyDeadline).toBe(39_000);
    await keeper.stop();
  });

  test("renews every selected shard serially and schedules the next sweep after completion", async () => {
    const f = fixture();
    const calls: string[] = [];
    let finish: (() => void) | undefined;
    f.repository.renew = async (name) => {
      calls.push(name);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { token: "1" };
    };
    const keeper = f.keeper();
    await keeper.acquire(new AbortController().signal);
    await f.advance(10_000);
    expect(calls).toEqual(["shard:0"]);
    await f.advance(10_000);
    expect(calls).toEqual(["shard:0"]);
    finish?.();
    await f.advance(0);
    expect(calls).toEqual(["shard:0", "shard:1"]);
    finish?.();
    await f.advance(0);
    await f.advance(9_999);
    expect(calls).toHaveLength(2);
    f.repository.renew = async () => ({ token: "1" });
    await keeper.stop();
  });

  test("a hung renewal closes owner work at the deadline without claiming observed loss", async () => {
    const f = fixture();
    let finish: (() => void) | undefined;
    f.repository.renew = async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { token: "1" };
    };
    const keeper = f.keeper();
    await keeper.acquire(new AbortController().signal);
    const work = keeper.workSignal;
    await f.advance(10_000);
    await f.advance(15_000);
    expect(keeper.getState()).toBe("uncertain");
    expect(keeper.isValid()).toBe(false);
    expect(work.aborted).toBe(true);
    expect(f.losses()).toBe(0);
    const cleanup = keeper.stop();
    finish?.();
    await cleanup;
  });

  test("transport uncertainty aborts current work and successful renewal permits fresh work", async () => {
    const f = fixture();
    f.repository.renew = async () => {
      throw new Error("transport unavailable");
    };
    const keeper = f.keeper();
    await keeper.acquire(new AbortController().signal);
    const work = keeper.workSignal;
    await f.advance(10_000);
    expect(keeper.getState()).toBe("uncertain");
    expect(work.aborted).toBe(true);
    expect(f.losses()).toBe(0);
    f.repository.renew = async () => ({ token: "1" });
    await f.advance(10_000);
    expect(keeper.isValid()).toBe(true);
    expect(keeper.workSignal.aborted).toBe(false);
    expect(keeper.workSignal).not.toBe(work);
    await keeper.stop();
  });

  test("an observed failed renewal notifies loss once and never reacquires", async () => {
    const f = fixture();
    f.repository.renew = async () => null;
    const keeper = f.keeper();
    await keeper.acquire(new AbortController().signal);
    await f.advance(10_000);
    expect(keeper.getState()).toBe("lost");
    expect(f.losses()).toBe(1);
    await f.advance(60_000);
    expect(f.losses()).toBe(1);
    expect(keeper.workSignal.aborted).toBe(true);
    await keeper.stop();
  });

  test("a blocked selection releases partial grants and bounds predecessor waiting", async () => {
    const f = fixture();
    let releases = 0;
    f.repository.takeIfExpired = async (name) => (name === "shard:0" ? { token: "1" } : null);
    f.repository.release = async () => {
      releases++;
      return true;
    };
    const keeper = f.keeper();
    expect(await keeper.acquire(new AbortController().signal)).toBe(false);
    expect(releases).toBeGreaterThan(0);
    expect(f.clock.now()).toBe(35_000);
    expect(keeper.safetyDeadline).toBeNull();
    expect(keeper.isValid()).toBe(false);
    await keeper.stop();
  });

  test("shutdown cancels acquisition and releases a partial grant", async () => {
    const f = fixture();
    const controller = new AbortController();
    let released = false;
    f.repository.takeIfExpired = async () => {
      controller.abort();
      return { token: "1" };
    };
    f.repository.release = async () => {
      released = true;
      return true;
    };
    const keeper = f.keeper();
    await expect(keeper.acquire(controller.signal)).rejects.toThrow();
    expect(released).toBe(true);
    expect(keeper.isValid()).toBe(false);
    await keeper.stop();
  });

  test("all-shard ownership stays locally primary and performs no database acquisition", async () => {
    const f = fixture();
    f.repository.takeIfExpired = async () => {
      throw new Error("Unexpected cluster acquisition");
    };
    for (const topology of [parseShardTopology({}), parseShardTopology({ SHARD_COUNT: "4" })]) {
      const coordinator = new ShardLeaseCoordinator(topology, f.callbacks, f.repository, f.clock);
      expect(await coordinator.acquire(new AbortController().signal)).toBe(true);
      expect(coordinator.isPrimaryProcess()).toBe(true);
      await coordinator.stop();
      expect(coordinator.hasOwnership()).toBe(false);
    }
  });
});
