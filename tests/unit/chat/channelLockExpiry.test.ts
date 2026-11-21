import { afterEach, describe, expect, it } from "bun:test";
import {
  CHANNEL_LOCK_TIMEOUT_MS,
  type ChannelLockEntry,
  channelLocks,
  isChannelProcessingLocked,
  releaseStaleChannelLockIfExpired,
  runUnderWatchdog,
  touchChannelLock,
} from "@/utils/chat/channelQueue";

const CHANNEL_ID = "channel-lock-expiry-test";

function heldLock(ageMs: number): ChannelLockEntry {
  const entry: ChannelLockEntry = {
    isLocked: true,
    lockedAt: Date.now() - ageMs,
    serverDiscId: "server",
    typingKeepaliveTimer: null,
    followUpCount: 0,
    messageQueue: [],
    activeTurnAbortController: null,
  };
  channelLocks.set(CHANNEL_ID, entry);
  return entry;
}

/** Starts a watchdog phase that stays in flight until the returned `finish` is called. */
function startPhase(): { finish: () => void; settled: Promise<void> } {
  let finish = () => {};
  const settled = runUnderWatchdog(
    CHANNEL_ID,
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  return { finish: () => finish(), settled };
}

function ageLock(entry: ChannelLockEntry, ageMs: number): void {
  entry.lastProgressAt = Date.now() - ageMs;
}

afterEach(() => {
  channelLocks.delete(CHANNEL_ID);
});

describe("channel lock expiry", () => {
  it("does not release a lock while a watchdog phase is in flight, however long it runs", async () => {
    // A slow provider queue or a long tool used to cross the lock timeout, and the next message in
    // the channel then killed the healthy turn with the same "Response Timed Out" embed.
    const entry = heldLock(0);
    const phase = startPhase();
    ageLock(entry, CHANNEL_LOCK_TIMEOUT_MS * 2);

    expect(releaseStaleChannelLockIfExpired(CHANNEL_ID, entry)).toBe(false);
    expect(isChannelProcessingLocked(CHANNEL_ID)).toBe(true);

    phase.finish();
    await phase.settled;
  });

  it("restarts the stale window when a watchdog phase settles", async () => {
    const entry = heldLock(CHANNEL_LOCK_TIMEOUT_MS * 2);
    const phase = startPhase();
    phase.finish();
    await phase.settled;

    expect(entry.activeWatchdogs?.size).toBe(0);
    expect(releaseStaleChannelLockIfExpired(CHANNEL_ID, entry)).toBe(false);
  });

  it("still releases a lock with no watchdog phase once it outlives the timeout", () => {
    const entry = heldLock(CHANNEL_LOCK_TIMEOUT_MS + 1000);

    expect(isChannelProcessingLocked(CHANNEL_ID)).toBe(false);
    expect(releaseStaleChannelLockIfExpired(CHANNEL_ID, entry)).toBe(true);
    expect(entry.isLocked).toBe(false);
  });

  it("measures staleness from the last progress heartbeat and keeps lockedAt as turn start", () => {
    const startedAt = Date.now() - CHANNEL_LOCK_TIMEOUT_MS - 1000;
    const entry = heldLock(CHANNEL_LOCK_TIMEOUT_MS + 1000);

    touchChannelLock(CHANNEL_ID);

    expect(releaseStaleChannelLockIfExpired(CHANNEL_ID, entry)).toBe(false);
    expect(entry.lockedAt).toBeLessThanOrEqual(startedAt + 5);
  });

  it("does not let a settling phase from a killed turn lift the next turn's exemption", async () => {
    const entry = heldLock(0);
    const killedTurnPhase = startPhase();
    // `/kill` releases the lock and a new turn acquires it while the old phase is still settling.
    entry.activeWatchdogs?.clear();
    const nextTurnPhase = startPhase();

    killedTurnPhase.finish();
    await killedTurnPhase.settled;
    ageLock(entry, CHANNEL_LOCK_TIMEOUT_MS * 2);

    expect(releaseStaleChannelLockIfExpired(CHANNEL_ID, entry)).toBe(false);

    nextTurnPhase.finish();
    await nextTurnPhase.settled;
  });
});
