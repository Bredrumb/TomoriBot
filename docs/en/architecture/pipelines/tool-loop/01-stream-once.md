---
title: "01: Stream Once"
---

One provider generation pass, wrapped with a rolling AbortController SDK timeout.

**File:** `src/utils/chat/toolLoop.ts:142-195`

## Mission

Call `provider.streamToDiscord(...)` with the current accumulated context and
tool history, and race the result against a configurable SDK timeout. The
timeout is *rolling*: it resets on every `onStreamProgress` heartbeat, so a
long but active stream is not killed; only a truly stalled one is. The wait for
the first heartbeat gets a longer budget than the gaps after it, because hosted
queues (NVIDIA NIM's free tier measured 266 s) can hold a healthy request for
minutes before the first token. Returns a `StreamResult` describing how the
generation ended.

## Input

- `params: ToolLoopParams`: full loop context (provider, config, `ChatTurnContext`).
- `accumulatedModelParts: Array<Record<string, unknown>>`: provider-native model
  turn parts accumulated across prior iterations of the tool loop. Empty on the
  first iteration; grows as each tool call appends its model response. Passed by
  reference and read (not written) inside `streamOnce`.
- `functionHistory: ToolHistoryEntry[]`: paired call/response records from prior
  tool dispatches. Passed to the provider so it can continue the multi-turn tool
  conversation. Empty on the first call.

## Output

`Promise<StreamResult>`: defined in `src/types/provider/interfaces.ts`. The
`status` field drives the outer loop's switch:

| `status` | Meaning |
|---|---|
| `"completed"` | Provider finished; `accumulatedText` carries the final response |
| `"error"` | Provider threw a non-timeout error |
| `"timeout"` | No first heartbeat within the first-token budget, or no later heartbeat within `STREAM_SDK_CALL_TIMEOUT_MS` |
| `"empty_response"` | Provider returned with no text and no tool call |
| `"stopped_by_user"` | User triggered `/kill` while streaming |
| `"follow_up_interrupt"` | A follow-up message arrived; caller should yield |
| `"function_call"` | Provider requested a tool call; `data` carries the call payload |

## Side effects

- **Sets `params.context.streamingContext.abortSignal`** to a fresh
  `AbortController.signal` before each call. Provider adapters consume this
  signal to abort in-flight HTTP requests when the timeout fires.
- **Sets `params.context.streamingContext.onStreamProgress`** to a callback that
  re-arms the timeout at the idle budget, and resets it to `undefined` in the
  `finally` block. Provider adapters call this on each token delivery to prevent
  the timeout from firing on active streams.
- **Runs the race under `runUnderWatchdog`**, which exempts the channel lock
  from stale release until the race settles, and heartbeats the lock via
  `touchChannelLock` on every re-arm. Before this, a turn older than
  `CHANNEL_LOCK_TIMEOUT_MS` was killed by the next message anyone sent in the
  channel, even while it was actively streaming. Tool execution runs under the
  same wrapper for the same reason.
- **Records a `stream_sdk_timeout` metric** when the watchdog fires, with the
  provider, the phase (`first_token` or `idle`), and the kill reason. The timeout
  embed uses first-token copy when no heartbeat ever arrived, and adds a
  free-model tip on NVIDIA.
- **Registers `killStream` on the channel lock entry** via
  `setChannelStreamKill(channelId, killStream)`. `killStream` is a unified
  callback that both calls `abortController.abort()` *and* rejects the
  `Promise.race`: ensuring the HTTP request is cancelled and the race unblocks
  simultaneously. This is what `/kill` triggers via `forceKillChannelStream`.
- **Clears the timeout and the kill registration** (`clearTimeout`,
  `setChannelStreamKill(channelId, null)`) in the `finally` block regardless of
  success or error.
- **Derives the `replyToMessage` argument** passed to the provider. Queued turns
  (`isFromQueue`) normally reply to their trigger message so the response renders
  as a Discord reply. Scene turns are the exception: every queued scene persona
  job shares the *same* trigger message, so replying would make all of them render
  "replying to" one message. When `incoming.sceneTurn` is set, `replyToMessage` is
  forced to `undefined` so the generated scene reads as a free-standing dialogue.

## Invariants

After this stage runs:

- `params.context.streamingContext.onStreamProgress` is `undefined`: the
  heartbeat reference is always cleaned up.
- The channel lock's `activeStreamKill` is `null`: the kill callback is
  always deregistered in `finally`.
- If the result status is `"timeout"`, it originated from the SDK-call
  timeout race (error message prefix `"SDK_CALL_TIMEOUT:"`), not from a
  provider-specific timeout mechanism.
- Errors that are not SDK timeouts are re-thrown to the caller
  (`runToolLoop`), which does not catch them; they propagate to
  `runGenerationTurn`'s outer `catch`.

## Extension points

| Surface | Plugin-relevance |
|---|---|
| `provider.streamToDiscord(...)` call | The provider contract is the seam: see [provider pipeline](../provider/) |
| `STREAM_SDK_CALL_TIMEOUT_MS` / rolling `onStreamProgress` | Internal: timeout behavior is an operational concern, not plugin-relevant |
| `params.context.streamingContext.abortSignal` | Internal: consumed by provider adapters only |

## Configuration

| Env var | Default | Minimum | Purpose |
|---|---|---|---|
| `STREAM_SDK_CALL_TIMEOUT_MS` | `120000` (2 min) | `10000` (10 s) | Idle timeout for one provider call; resets on each heartbeat |

The first-token budget is `DISCORD_STREAMING_CONSTANTS.FIRST_TOKEN_TIMEOUT_MS`
(300 s), or `STREAM_SDK_CALL_TIMEOUT_MS` when that is set higher. Adapters that
run their own stall detection must honor it before the first token too, or the
shortest detector caps the wait for all of them: the OpenRouter adapter applies
it until its first content chunk, since its queue sends only
`: OPENROUTER PROCESSING` keepalives, which never count as content.

## Related docs

- Provider streaming contract: → [provider pipeline](../provider/)
- Tool-loop coordinator: → [`README.md`](README.md)
