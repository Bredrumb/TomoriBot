---
title: "Provider Pipeline"
sidebar:
  label: "Overview"
  groupLabel: "Provider"
  order: 400
---

Streams an LLM response from a provider API to one or more Discord messages, handling all text processing, delivery timing, and stop signals between the provider's HTTP stream and Discord's message API.

The pipeline is entered from [tool-loop stage 01: `streamOnce`](../tool-loop/01-stream-once) via
`LLMProvider.streamToDiscord()`. That facade method constructs a `StreamAdapter` and a `StreamConfig`,
then hands both to `StreamOrchestrator.streamToDiscord()`, which drives the remaining stages.

## Optional Decision capability

`SupportsDecisions` extends the optional capability map and resolver. `OpenrouterProvider` and
`CustomProvider` own its implementations; other providers remain unsupported.
`loadDecisionModelsForScope(scope)` in `providerFeatureExecutors.ts` returns `DecisionModelOption`
records. Consumers persist their `reference`: `provider`, `modelId`, nullable `registrationId`, and
nullable `customEndpointId`. Global native entries have null registration IDs. Scoped native entries
carry their exact scoped registration ID. Custom entries use `custom:<connection_id>` and the exact
endpoint row ID, with a null native registration ID. Deletion and re-registration invalidate old
references even when a codename repeats.

`callDecisionsForProvider({scope, reference, evidence, questions, abortSignal?, onUsage?})` rechecks ownership,
the exact registration, saved credentials, and the stored custom protocol. Null selection returns
`unavailable/not-selected`. Evidence is text; questions are `{type: "predicate", id, instructions}`.
IDs are unique application-owned identifiers, start with a lowercase letter, contain lowercase
letters/digits/underscores, and have at most 64 characters. Requests admit 1-64 questions. Rubrics,
thresholds, calibration, and response routing belong to consumers.

| Transport | Translation |
|---|---|
| Native OpenRouter | `/api/alpha/decisions`: text `state`, named `noul` questions and answers |
| Custom System One | `POST <stored-base>/systemone`: the same named `noul` protocol |
| Custom OpenAI Decisions | `POST <stored-base>/decisions`: text `input`, ordered predicates and predicate/refusal answers |

Results distinguish `completed`, `refused`, `cancelled`, `invalid-input`, `unavailable`, and `failed`.
Completed/refused results carry ordered typed answers, optional actual usage/cost, local correlation,
bounded provider request identity, and returned model ID. Probabilities must be finite in [0, 1].
Missing/extra/duplicate answers, wrong types/order, invalid usage, and explicit evidence truncation
fail validation. Partial OpenAI refusals return `refused`. No chat or prose interpretation is used.

`onUsage` receives validated usage before answer validation. A malformed verdict or cancellation
after response decoding retains reported spend. Routing records this callback once, including
responses settling after its deadline, without accepting their late verdict. Missing or invalid
usage stays unknown; raw HTTP error bodies are discarded without parsing private prose.

Requests compose caller cancellation with the existing `STREAM_SDK_CALL_TIMEOUT_MS` policy. Responses
are bounded to 1 MiB. Until callers need a model-specific tokenizer, the serialized request's UTF-8
byte count must fit its documented input-token ceiling. This conservative admission rule can reject
otherwise fitting requests and never truncates evidence. Custom calls retain the SSRF gate and pinned
fetch. Discovery checks explicit Decision output modality, finite prices, and documented input limits.
Only OpenRouter receives global seeds; seeding does not select a model or activate a drafting gate.

INFO traces contain protocol, numeric model/registration identities, correlation, counts, elapsed
time, outcome, and actual usage/cost when supplied. They omit evidence, question text, caller labels,
raw bodies, credentials, and endpoint URLs. Operational failures emit one sanitized ERROR where their
cause is known, with stage/category and optional HTTP status in existing `ErrorContext` metadata.
`failed.errorLogged` is true, so recovery must not log the failure again. Cancellation, valid refusal,
missing selection, and rejected input are expected outcomes. The existing logger hides INFO under
`RUN_ENV=production` unless `TEST_PRODUCTION=true`; ERROR retains production visibility, persistence,
and ambient workspace/turn context.

Protocol references: [OpenRouter Decisions](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request),
[System One](https://docs.typesafe.ai/api), and
[OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions).

## Read order

1. `README.md`: this file (pipeline overview and entry-point wiring)
2. `01-context-assembly.md`: adapter translates `StructuredContextItem[]` into provider-native format
3. `02-raw-chunk-generation.md`: HTTP stream opens; `RawStreamChunk` objects are yielded
4. `03-chunk-normalization.md`: `processChunk` converts `RawStreamChunk` → `ProcessedChunk`
5. `04-orchestrator-state-machine.md`: `executeStream` drives the for-await loop and routes chunk types
6. `05-buffer-management.md`: `StreamBufferFlusher` accumulates text and flushes at boundaries
7. `06-segment-normalization.md`: `StreamSegmentProcessor` cleans text and resolves Discord-specific concerns
8. `07-discord-delivery.md`: `StreamMessageDelivery` + `StreamUiUpdater` send messages to Discord

## Stage flow

```
tool-loop pipeline ─► LLMProvider.streamToDiscord()
                           │  (provider facade: builds StreamConfig + StreamAdapter)
                           │
                           ▼
                   [Stage 1] startStream — Context assembly
                           │  contextItems → provider-native contents + system instruction
                           │  tools, function history, stop strings, config options
                           ▼
                   [Stage 2] startStream — Raw chunk generation
                           │  HTTP stream open → yield RawStreamChunk per token delivery
                           │  speaker guard holdback, text deduplication (Google)
                           ▼
                   [Stage 3] processChunk — Chunk normalization
                           │  RawStreamChunk → ProcessedChunk { type, content, functionCall,
                           │  error, thoughts, metadata }
                           ▼
                   [Stage 4] executeStream — Orchestrator state machine
                     for-await loop ──► checks stop/abort/timeout per chunk
                           │
                      ┌────┴────────────────────────────────────────────┐
                      │ type="text"          │ type="function_call"       │ type="done"
                      ▼                     ▼                            ▼
              [Stage 5]              flush buffer → return         record terminal
          processTextChunk         { status: "function_call" }     metadata; continue
           Buffer management
                      │
                      ▼
              [Stage 6]
          sendBufferSegment
           Segment normalization
           (clean, mentions, guard)
                      │
                      ▼
              [Stage 7]
           sendSegment →
         sendSinglePayload
           Discord delivery
         (webhook / channel,
          typing simulation)
                      │
                      ▼
            StreamResult
          { status, accumulatedText,
            thoughtLog, detailsContent }
                      │
                      ▼
             tool-loop pipeline
```

## Stage index

| File | Stage | Code symbol | Owns |
|---|---|---|---|
| `01-context-assembly.md` | 1 | `BaseStreamAdapter.startStream` (setup) | Provider-native request construction |
| `02-raw-chunk-generation.md` | 2 | `BaseStreamAdapter.startStream` (generator) | HTTP streaming + provider-specific pre-processing |
| `03-chunk-normalization.md` | 3 | `BaseStreamAdapter.processChunk` | `RawStreamChunk` → `ProcessedChunk` conversion |
| `04-orchestrator-state-machine.md` | 4 | `StreamOrchestrator.executeStream` | Chunk routing, stop signals, timeout, `StreamResult` assembly |
| `05-buffer-management.md` | 5 | `StreamBufferFlusher.processTextChunk` | Text accumulation, semantic block detection, boundary flush |
| `06-segment-normalization.md` | 6 | `StreamSegmentProcessor.sendBufferSegment` | LLM output cleaning, mention resolution, speaker guard, prefill |
| `07-discord-delivery.md` | 7 | `StreamMessageDelivery.sendSegment` + `StreamUiUpdater.sendSinglePayload` | Discord API calls, typing simulation, webhook routing |

## Cross-references

- **Caller:** [tool-loop pipeline: Stage 01 `streamOnce`](../tool-loop/01-stream-once):
  the direct entry point for `LLMProvider.streamToDiscord()`
- **Upstream caller:** [chat per-turn Stage 03 `runGenerationTurn`](../chat/06-per-turn/03-run-generation-turn):
  orchestrates the model + key fallback loop that calls the tool-loop
- **Feeds into:** [tool-loop pipeline: Stage 04 `buildResult`](../tool-loop/04-build-result):
  consumes the `StreamResult` this pipeline returns
- **Memory write:** [tool-loop pipeline: Stage 04](../tool-loop/04-build-result) routes
  `StreamResult.accumulatedText` and `detailsContent` to short-term memory cache writes

## Pipeline-wide concerns

### Provider identity

`LLMProvider.streamToDiscord()` is defined on each provider class (e.g., `GoogleProvider`,
`OpenrouterProvider`). The method constructs a provider-specific `StreamAdapter` but immediately
delegates to the universal `StreamOrchestrator`. Stages 1-3 are therefore provider-owned (each
adapter handles its own API format); stages 4-7 are orchestrator-owned and provider-agnostic.

### Stop and interrupt signals

The stop registry (`src/utils/discord/stream/stopRequests.ts`) is a per-channel map checked at
every iteration of the stage 4 orchestrator loop. Two stop modes exist:
- **User stop** (`status: "stopped_by_user"`): `/kill` command; pending buffer is flushed before returning.
- **Follow-up interrupt** (`status: "follow_up_interrupt"`): a new user message arrived; buffer is
  discarded and the pipeline exits immediately to allow the chat pipeline to re-run.

### Delivery modes

Controlled by `HumanizerDegree` (from `TomoriState.config`):

| Degree | Mode | Behavior |
|---|---|---|
| `NONE` (0) | Aggregated | Text is queued until a tool/final boundary, then sent in one batch |
| `LOW`/`MEDIUM` (1-2) | Streaming | Each segment is sent as it flushes; typing simulation runs between messages |
| `HEAVY` (3) | Streaming + humanize | Like degree 1-2 but `humanizeString()` applies additional noise |

### Persona and webhook routing

When `StreamContext.webhook` and `StreamContext.personaUsername` are set (alter persona mode),
stage 7 routes all Discord sends through `sendWebhookMessageWithIdentity()` so the message
appears with the persona's name and avatar. The first message in an alter response that also has
a `replyToMessage` context gets a separate reply-notice via `sendWebhookReplyNotice()` before
the main content send.

### Thought log capture

`<think>…</think>` blocks in the streamed text are silently captured into
`state.thinkBlockBuffer` (stage 5) rather than sent to Discord. At stream end, stage 4
assembles these into `StreamResult.thoughtLog` for the thought-log embed that stage 04 of the
tool-loop pipeline emits to a dedicated channel.

### `<details>` block capture

`<details>…</details>` blocks are captured into `state.detailsBlockBuffer` (stage 5) and
routed to `StreamResult.detailsContent`. Stage 04 of the tool-loop pipeline writes
`detailsContent` to the short-term memory cache separately from `accumulatedText`.
