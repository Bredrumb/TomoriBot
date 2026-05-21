<!-- ARCH-ALIGNMENT: prereq-phase-5.5d -->

# Stage 04 — `runWithChannelLock`

Per-channel mutex wrapper around the per-turn body.

**File:** `src/utils/chat/channelQueue.ts:75-134`

> **Concurrency wrapper, not a data-transform stage.** Input and output are
> structurally the same (`RunnableChatAdmission` flows in; the callback receives
> a `LockedChatTurn` derived from it). What this stage *does* is enforce that
> exactly one turn-sequence runs per channel at a time, manage the Discord
> typing indicator, and replay queued messages on release.

## Mission

Acquire a channel-scoped mutex, run the per-turn callback under that lock with a
Discord typing keepalive active, and on release: replay the next queued message
and/or trigger any pending stop-response generation. Make recursive re-entries
into `tomoriChat()` safe by recognizing the `skipLock=true` flag and reusing the
outer lock instead of deadlocking on it.

## Input

- `RunnableChatAdmission` (from stage 02).
- `callback: (LockedChatTurn, startTyping) => Promise<T>` — receives the locked
  turn and a function that starts the typing keepalive.
- `options: { handleStopResponse, processQueuedMessage }` — the coordinator's
  re-entry callbacks for stop-response and queued messages.

## Output

`Promise<T>` — the callback's return value, pass-through.

The callback receives `LockedChatTurn`:

```ts
{
  admission: RunnableChatAdmission;
  channelId: string;
  lockedAt: number;
  queueDepth: number;
  skipLock: boolean;
}
```

## Side effects

**Lock acquisition (if `skipLock === false`):**

- Looks up or creates a `ChannelLockEntry` keyed by `channelId` in the in-memory
  `channelLocks` map.
- Forcibly releases the lock if older than `CHANNEL_LOCK_TIMEOUT_MS` (default
  180s, configurable via env). Logs a warning and clears the existing queue.
- Sets `isLocked = true`, records `lockedAt`, `currentMessageId`, `userDiscId`,
  persona-job/persona-id/command-triggered flags.

**During the callback:**

- `startTyping()` (called by the coordinator after `planChatTurns` produces
  ≥ 1 turn) starts the Discord typing keepalive interval (default 8s,
  configurable via env). Interval auto-stops when the lock is released or a
  stop request is registered.

**Lock release (always runs via `finally`):**

- Clears `isLocked`, `lockedAt`, all active-turn state.
- Stops the typing keepalive.
- Checks `StreamOrchestrator.getAndClearStopContext(channelId)`. If present,
  schedules `handleStopResponse(originalStopMessage, client)` via
  `setImmediate` — stop-response generation runs *after* lock release so the
  stop response itself can acquire the lock.
- Pops the next message from `messageQueue` (FIFO). If present, schedules
  `processQueuedMessage(next)` via `setImmediate`.

**`skipLock=true` path:**

- Re-entries from retry/post-turn effects pass `skipLock=true`. The stage
  short-circuits: reuses the outer lock's `lockedAt` and queue depth, invokes
  the callback immediately, returns the result. No new typing keepalive is
  started (the outer keepalive is still active).

## Invariants

After this stage's `finally` block runs:

- `lockEntry.isLocked === false` for the duration between turn-sequences.
- The Discord typing keepalive timer is cleared (`typingKeepaliveTimer ===
  null`).
- The queued-message replay is **scheduled via `setImmediate`**, not awaited —
  the current invocation returns before the next message is processed, so the
  call stack stays shallow even under heavy queue pressure.
- A pending stop-response (if any) was scheduled *before* the queue replay, so
  the stop response runs first.

## Extension points

**Internal — concurrency primitive.** The lock, queue, and typing-keepalive
mechanics are tightly coupled to Discord rate limits, the stream orchestrator's
stop/follow-up signaling, and the recursive `tomoriChat()` re-entry pattern.
Replacing this stage from a plugin would risk breaking those guarantees.

**Plugin-relevant adjacent surfaces** (lower in the same module):

| Helper | What a plugin might do | Plugin-relevance |
|---|---|---|
| `enqueueBusyChannelMessage`, `queuePersonaJobsAtFront`, `queueStopResponseAtFront` | Add a new "queue at front" entry type | → plugin plan candidate; today these are call-site-specific |
| `queueFollowUpForLockedTurn` | Change follow-up interrupt eligibility rules | Internal — coupled to `MAX_FOLLOW_UP_INTERRUPTS` and the tool-call-chain flag |
| `requestNaturalStopForLockedTurn` | Add a new "soft stop" signal type | Internal — coupled to `StreamOrchestrator.requestStop` semantics |
| `clearQueuedSelfReplyWork` | Customize what gets cleared on natural stop | Internal — coupled to `isSelfTriggerMessage` and persona-job semantics |

The lock's *policy* (timeout, typing interval, max follow-ups) is configurable
via env vars; behaviour customization should go through that channel rather
than monkey-patching the stage.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `CHANNEL_LOCK_TIMEOUT_MS` | `180000` | Stale-lock detection threshold |
| `DISCORD_TYPING_KEEPALIVE_INTERVAL_MS` | `8000` | Typing-refresh cadence |
| `MAX_FOLLOW_UP_INTERRUPTS` | `3` | Per-lock follow-up interrupt cap |

## Related docs

- Queue policy decision tree: lives in `evaluateAdmissionQueueAndTriggerGate`
  (stage 02 helper); → admission-queue helper doc TBD if it grows.
- Stop request mechanics: → stream orchestrator
  <!-- TBD-XREF:sibling --> (currently documented in
  `docs/ai/streaming.md` <!-- TBD-XREF:legacy -->).
- Follow-up interrupt semantics: → folded into stage 05 docs (follow-up
  eligibility gating).
