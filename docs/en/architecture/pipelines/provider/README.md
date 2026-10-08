---
title: "Provider Pipeline"
sidebar:
  label: "Overview"
  groupLabel: "Provider"
  order: 400
---

The provider pipeline streams an LLM response from a provider API to Discord messages. It coordinates
request construction, text processing, safety guards, delivery timing, and stop signals between the
HTTP stream and Discord's message API.

The pipeline starts from the tool loop stage [`streamOnce`](/architecture/pipelines/tool-loop/01-stream-once/)
via `LLMProvider.streamToDiscord()`. That facade constructs a provider-specific `StreamAdapter` and
a `StreamConfig`, then delegates to `StreamOrchestrator.streamToDiscord()`.

## Read order

1. [Overview](/architecture/pipelines/provider/): pipeline structure and entry points
2. [01: Context Assembly](/architecture/pipelines/provider/01-context-assembly/): translating structured context into provider requests
3. [02: Raw Chunk Generation](/architecture/pipelines/provider/02-raw-chunk-generation/): opening HTTP streams, transport degradation, and raw chunks
4. [03: Chunk Normalization](/architecture/pipelines/provider/03-chunk-normalization/): mapping raw chunks, extracting reasoning, and normalizing errors
5. [04: Orchestrator State Machine](/architecture/pipelines/provider/04-orchestrator-state-machine/): driving the generator loop, routing chunks, and handling stops
6. [05: Buffer Management](/architecture/pipelines/provider/05-buffer-management/): accumulating text, protecting markdown blocks, and flushing boundaries
7. [06: Segment Normalization](/architecture/pipelines/provider/06-segment-normalization/): cleaning text, resolving mentions, render modifiers, and speaker guards
8. [07: Discord Delivery](/architecture/pipelines/provider/07-discord-delivery/): message chunking, typing simulation, webhook routing, and rate limits

## Stage flow

```
tool loop pipeline -> LLMProvider.streamToDiscord()
                            |  (builds StreamConfig + StreamAdapter)
                            v
                    [Stage 01] startStream: Context assembly
                            |  contextItems -> provider-native payload
                            |  tools, history replay, stop strings
                            v
                    [Stage 02] startStream: Raw chunk generation
                            |  HTTP stream open -> yield RawStreamChunk
                            |  parameter degradation, speaker tail holdback
                            v
                    [Stage 03] processChunk: Chunk normalization
                            |  RawStreamChunk -> ProcessedChunk
                            |  (text, function_call, error, done, thoughts)
                            v
                    [Stage 04] executeStream: Orchestrator state machine
                      for-await loop -> checks stop signals and heartbeats
                            |
                       +----+-------------------------------------------+
                       | type="text"          | type="function_call"    | type="done"
                       v                      v                         v
               [Stage 05]               flush buffer -> return      record terminal
           processTextChunk          { status: "function_call" }   metadata; continue
            Buffer management
                       |
                       v
               [Stage 06]
           sendBufferSegment
            Segment normalization
            (clean, mentions, guard)
                       |
                       v
               [Stage 07]
            sendSegment ->
          sendSinglePayload
            Discord delivery
          (webhook / channel,
           typing simulation)
                       |
                       v
             StreamResult
           { status, accumulatedText,
             thoughtLog, detailsContent }
                       |
                       v
              tool loop pipeline
```

## Stage index

| File | Stage | Code symbol | Primary ownership |
|---|---|---|---|
| `01-context-assembly.md` | 1 | `BaseStreamAdapter.startStream` (setup) | Native request construction |
| `02-raw-chunk-generation.md` | 2 | `BaseStreamAdapter.startStream` (generator) | HTTP streaming and parameter degradation |
| `03-chunk-normalization.md` | 3 | `BaseStreamAdapter.processChunk` | `RawStreamChunk` to `ProcessedChunk` conversion |
| `04-orchestrator-state-machine.md` | 4 | `StreamOrchestrator.executeStream` | Chunk routing, stop signals, and `StreamResult` assembly |
| `05-buffer-management.md` | 5 | `StreamBufferFlusher.processTextChunk` | Text accumulation, block holds, and boundary flush |
| `06-segment-normalization.md` | 6 | `StreamSegmentProcessor.sendBufferSegment` | Text cleaning, mentions, render modifiers, and prefill |
| `07-discord-delivery.md` | 7 | `StreamMessageDelivery.sendSegment` | Discord API calls, typing simulation, and webhooks |

## Cross-references

- **Direct caller:** [tool loop Stage 01 `streamOnce`](/architecture/pipelines/tool-loop/01-stream-once/):
  entry point invoking `LLMProvider.streamToDiscord()`.
- **Upstream caller:** [chat per-turn Stage 03 `runGenerationTurn`](/architecture/pipelines/chat/06-per-turn/03-run-generation-turn/):
  coordinates model and key fallback loops.
- **Result consumer:** [tool loop Stage 04 `buildResult`](/architecture/pipelines/tool-loop/04-build-result/):
  evaluates `StreamResult` and routes `accumulatedText` and `detailsContent` to short-term memory.

## Pipeline-wide concerns
<!-- anchor: pipeline-wide-concerns -->

### Provider identity and separation

Each provider defines `LLMProvider.streamToDiscord()` (such as `GoogleProvider` or `OpenrouterProvider`).
The method creates an adapter implementing `StreamProvider` and forwards execution to
`StreamOrchestrator`. Stages 01 to 03 are provider-owned, isolating API formats and transport
details. Stages 04 to 07 are orchestrator-owned and provider-agnostic.

### Stop and interrupt signals

The stop registry (`src/utils/discord/stream/stopRequests.ts`) tracks channel stop states checked on
every orchestrator iteration:

- **Graceful user stop** (`status: "stopped_by_user"`): a stop request observed in the loop flushes
  pending text before returning. `/kill` also aborts the active HTTP request and rejects the caller's
  stream race, so it can return immediately without this flush.
- **Follow-up interrupt** (`status: "follow_up_interrupt"`): triggered when a user sends a new
  message during generation. The buffer is discarded immediately so the chat pipeline can restart.
- **Internal stops** (`send_message_limit`, `flush_limit`, `speaker_guard`, `channel_deleted`,
  `missing_access`): skip buffer flushes to avoid duplicate rejections or outliving the turn.

### Delivery modes

`HumanizerDegree` from configuration sets delivery timing:

- `NONE` (0): aggregated mode. Text accumulates until a tool call, table attachment, or final flush,
  delivering in one batch.
- `LIGHT` or `MEDIUM` (1-2): streaming mode. Each segment sends as flushes occur, inserting
  interruptible typing simulation between messages.
- `HEAVY` (3): streaming mode with sentence-level splits and probabilistic comma and emphasis rolls.

### Persona and webhook routing

When `StreamContext.webhook` and `personaUsername` are set, stage 07 routes messages through
`sendWebhookMessageWithIdentity()`. The initial message of a webhook reply that references
`replyToMessage` sends a standalone reply notice via `sendWebhookReplyNotice()`.

### Reasoning and details capture

In-band `<think>` blocks are captured into `state.thoughtRawSegments` rather than sent to Discord.
At stream completion, stage 04 compiles them into `StreamResult.thoughtLog` for dedicated thought
logging. `<details>` blocks collect into `state.detailsSegments` and map to
`StreamResult.detailsContent` for short-term memory caching.

## Source pointers

- `src/types/stream/interfaces.ts`: `StreamProvider`, `BaseStreamAdapter`, `IStreamOrchestrator`, `StreamConfig`, and `StreamContext`.
- `src/utils/discord/stream/stateMachine.ts`: `StreamOrchestrator` implementation.
- `src/utils/discord/stream/stopRequests.ts`: channel stop registry.
