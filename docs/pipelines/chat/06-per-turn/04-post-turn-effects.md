<!-- ARCH-ALIGNMENT: prereq-phase-5.5d -->

# Per-Turn Stage 04 — `runPostTurnEffects`

Side-effect sequence after generation completes.

**File:** `src/utils/chat/postTurnEffects.ts:21-28`

## Mission

Run the post-generation side effects that depend on the produced result.
Six ordered steps: empty-response retry, text-quota consumption, self-reply
chain bookkeeping, short-term memory write, thought-log emission, boomerang
follow-up scheduling. Each step is independent — failures in one are logged
but do not block the others.

## Input

- `ChatTurnContext` (the closure built in per-turn stage 01).
- `GenerationTurnResult` (from per-turn stage 03).

## Output

`Promise<void>` — terminal stage for this turn iteration.

## Side effects

Steps run in this order:

### 1. `maybeScheduleEmptyResponseRetry`

If `result.status === "empty_response"` and `incoming.retryCount <
MAX_EMPTY_RESPONSE_RETRIES` (default 2):

- Sleeps `EMPTY_RESPONSE_RETRY_DELAY_MS` (default 1000ms).
- If the empty-response reason was `"speaker_guard"`, prepends a synthetic
  speaker-guard directive to `injectedContextItems` via
  `buildSpeakerGuardRetryDirective`.
- Re-enters `tomoriChat()` with `skipLock=true`, `retryCount + 1`,
  `selectedPersonaId` pinned to the same persona, and the OpenRouter
  finish-reason-length flag forwarded so stage 03 can trim history.

### 2. `consumeTextQuota`

If `shouldApplyTextQuota` was true, quota state exists, it wasn't already
consumed, and the response was non-empty:

- `incrementTextQuota(serverId, userDiscId)`.
- Marks the quota state consumed and writes it back to
  `textQuotaTriggerStates`.

### 3. `updateSelfReplyBookkeeping`

If the response was non-empty:

- `setLastRespondedPersona(channel.id, persona_id)` — records which persona
  spoke last (used by stage 05 self-message persona-rotation).
- Increments `selfReplyChainState.triggerCount` for non-manual, non-reminder,
  non-stop real responses. If the message was a self-message, also sets
  `lastWasSelf = true`.

### 4. `writeShortTermMemory`

If not a stop response, history is non-empty, user is not privacy-FULL, and
the response was non-empty:

- Builds the last 10 simplified messages + persona responses (one entry per
  responding persona).
- Calls `storeShortTermMemory(...)` once per unique persona ID (or once with
  `null` if no persona IDs are known).
- Failures are logged but don't propagate.

### 5. `emitThoughtLog`

If a `thought_log_channel_disc_id` is configured, the source channel isn't
DM, and the source channel isn't in the persona's `private_channel_ids`:

- If `thoughtLog` has content (provider emitted reasoning/thinking blocks):
  computes `generationDurationMs = now - message.createdTimestamp`, sends a
  full thought-log embed via `sendThoughtLogEmbed`.
- Else if the response was via personal BYOK (`textCredentialSource ===
  "personal"`): sends an attribution-only embed crediting the user's
  provider.
- Else: no-op.

### 6. `scheduleBoomerangFollowUp`

Schedules a `setImmediate` callback:

- Checks `consumePendingBoomerang(channel.id)` — set by the
  `crossChannelMessage` tool when the active turn used it.
- If pending, fetches the latest message in the boomerang's source channel,
  calls `suppressNextSelfReply(sourceChannel.id)` to prevent the boomerang
  from triggering its own self-reply detection, and re-enters
  `tomoriChat()` against the source channel with the boomerang's persona +
  injected context.

## Invariants

After this stage runs:

- The text-quota state for this trigger is *consumed exactly once* per
  successful turn-sequence (across multiple personas responding to the same
  trigger, only the first non-empty response increments).
- `setLastRespondedPersona` reflects the last persona to actually speak in
  this channel — used by the next turn's persona-rotation logic.
- Short-term memory entries are scoped per-persona-ID (so each persona has
  its own conversational continuity in the cache).
- A pending boomerang from this turn is consumed exactly once.
- Recursive re-entries (empty-response retry, boomerang) are *scheduled*
  with the appropriate flags (`skipLock=true` for retry,
  `suppressNextSelfReply` for boomerang) so they do not interfere with the
  outer lock or self-reply chain semantics.

## Extension points

This is **the richest plugin surface in the chat pipeline.** Each of the six
steps is an independent side-effect concern that a plugin might want to
extend or replace:

| Step | Named helper | Plugin-relevance |
|---|---|---|
| Empty-response retry | `maybeScheduleEmptyResponseRetry` | Retry policy (provider-specific) — extension via per-provider hook |
| Text-quota consumption | `incrementTextQuota` | Quota-manager subsystem; plugins shipping their own quotas would add hooks here |
| Self-reply bookkeeping | `setLastRespondedPersona`, `getSelfReplyChainState` | Cascade-trigger limit semantics; coupled to stage 05 |
| Short-term memory write | `storeShortTermMemory` | → memory pipeline <!-- TBD-XREF:sibling --> |
| Thought-log emission | `sendThoughtLogEmbed`, `sendAttributionOnlyEmbed` | New "logging channel kinds" plug in here |
| Boomerang follow-up | `consumePendingBoomerang`, `buildBoomerangContext` | Cross-channel-tool-specific; one plugin (the cross-channel tool) owns the pending-boomerang state |

**The sequencing matters**: empty-response retry runs *first* so it can
short-circuit the rest (a retry skips the other steps because the original
result was empty); quota consumption runs *before* memory write so quota
exhaustion doesn't pollute the memory cache; boomerang runs *last* via
`setImmediate` so the outer lock has released before the cross-channel
re-entry attempts to acquire its own lock.

A future plugin extension for "add a new post-turn hook" would likely take
the form of a hook list (`postTurnHooks: PostTurnHook[]`) where each hook
runs after the built-in steps with the same `(context, result)` signature.
→ plugin plan candidate.

## Configuration

| Constant | Default | Purpose |
|---|---|---|
| `MAX_EMPTY_RESPONSE_RETRIES` | `2` | Cap on empty-response retry chain (file-local constant) |
| `EMPTY_RESPONSE_RETRY_DELAY_MS` | `1000` | Backoff between retries (file-local constant) |

Both are currently file-local — promoting to env vars would be a small
follow-up if operational tuning becomes useful.

## Related docs

- Short-term memory: → [memory pipeline](../../memory/)
  <!-- TBD-XREF:sibling --> (currently `shortTermMemoryCache.ts` helper only)
- Thought log: → no dedicated doc; `thoughtLog.ts` helper only
- Boomerang / cross-channel tool: → no dedicated doc;
  `crossChannelMessageTool.ts` helper only
- Self-reply chain semantics: → folded into stage 05 docs (cascade limits)
