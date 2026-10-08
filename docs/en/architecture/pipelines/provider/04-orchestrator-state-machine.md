---
title: "04: Orchestrator State Machine"
---

The orchestrator state machine drives the provider generator loop, routes normalized chunks to downstream
stages, resolves stop and interrupt signals, and compiles the terminal `StreamResult`.

## Flow and ownership

`StreamOrchestrator.streamToDiscord()` is the universal coordinator for Discord streaming. It wraps
the private `executeStream()` method, which instantiates fresh `StreamMetrics`, `StreamState`, and
delivery configurations before consuming the generator yielded by
[stage 02](/architecture/pipelines/provider/02-raw-chunk-generation/).

The state machine runs through a `for await` loop over the raw chunk generator:

```
Stream generator
       |
       v
Check stop registry (pre-chunk)
       |
       +---> Stop / Interrupt detected? ---> Return stop result
       |
Reset caller watchdog (onStreamProgress)
       |
Normalize chunk (stage 03 processChunk)
       |
Route chunk by type:
  - "text"          -> stage 05 processTextChunk
  - "function_call" -> flush pending buffer -> return { status: "function_call" }
  - "error"         -> flush pending buffer -> show error embed -> return { status: "error" }
  - "done"          -> record terminal metadata; continue loop
       |
Check stop registry (post-write)
       |
Loop exhausted?
       |
       v
completeStreamAfterProviderEnd()
       |  (flushFinalBuffer, clear internal stops, assemble StreamResult)
       v
Check wasEmptyStreamResponse()
       |
       +---> Empty? ---> return { status: "empty_response" }
       +---> Output? -> return { status: "completed" }
```

## Stop and interrupt resolution

The orchestrator inspects the stop registry (`src/utils/discord/stream/stopRequests.ts`) before
processing each chunk and again immediately after delivery writes. The post-write check resolves
delivery caps (such as message limits) without awaiting another token from the provider.

Stop handling distinguishes these cases:

- **Follow-up interrupts:** When a user sends a new message while generation is in flight, the
  orchestrator clears the stop request, discards the buffer, and exits immediately with
  `{ status: "follow_up_interrupt" }`. This lets the chat pipeline start the next turn without delay.
- **Graceful user stops:** A stop request observed by the orchestrator flushes pending buffered text
  and exits with `{ status: "stopped_by_user" }`. `/kill` additionally aborts the transport and
  rejects the [stream race](/architecture/pipelines/tool-loop/01-stream-once/), which can bypass this flush.
- **Internal delivery stops:** Stops triggered by delivery caps (`send_message_limit`, `flush_limit`,
  `speaker_guard`, `channel_deleted`, `missing_access`) skip the pending buffer flush. Flushing into
  an inaccessible or rate-limited destination would trigger redundant rejected Discord requests and
  risk re-registering stops that leak into subsequent turns. A speaker-guard stop can still flush
  already-accepted aggregated text; it discards the unsafe remainder.
- **Silent speaker-guard stops:** When a speaker guard stops generation before any visible text is
  sent, the orchestrator returns `{ status: "empty_response" }` so retry logic can reschedule the turn.

## Chunk routing and token usage

The orchestrator routes normalized chunks based on `ProcessedChunk.type`:

- **Text:** Sent to [stage 05](/architecture/pipelines/provider/05-buffer-management/)
  (`StreamBufferFlusher.processTextChunk()`) for semantic buffering and boundary detection.
- **Tool calls:** Triggers a pending buffer flush before returning `{ status: "function_call" }`.
  The tool loop executes the tool and starts a subsequent generation turn with the tool result.
- **Errors:** Flushes pending buffer text and displays a Discord error embed via `StreamErrorUi`
  (unless suppressed by retries or user impersonation), returning `{ status: "error" }`.
- **Done metadata:** Captures terminal completion data such as `finishReason`.
- **Token usage:** Captured from `metadata.usage` on any chunk (latest non-null wins). This handles
  providers that report usage on trailing empty chunks or override terminal metadata.

## Stream completion

When the generator finishes normally, `completeStreamAfterProviderEnd()` invokes `flushFinalBuffer()`,
clears internal stop requests, and constructs the completed `StreamResult`.

The outer `streamToDiscord()` wrapper inspects the completed result. If `wasEmptyStreamResponse()`
detects that no visible text and no tool call were delivered, it returns `{ status: "empty_response" }`
instead of `"completed"`, allowing upstream fallback and retry logic to trigger.

## Source pointers

- `src/utils/discord/stream/stateMachine.ts`: `StreamOrchestrator.executeStream` and loop routing.
- `src/types/provider/interfaces.ts`: `StreamResult` definition.
- `src/utils/discord/stream/stopRequests.ts`: channel stop registry.
- `src/utils/discord/stream/thoughtLog.ts`: `wasEmptyStreamResponse` evaluation.
