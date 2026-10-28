---
title: "Provider Pipeline"
sidebar:
  label: "Overview"
  groupLabel: "Provider"
  order: 400
aiGenerated: true
---

The provider pipeline streams an LLM response from a provider API to Discord messages. It coordinates
request construction, text processing, safety guards, delivery timing, and stop signals between the
HTTP stream and Discord's message API.

The pipeline starts from the tool loop stage [`streamOnce`](/architecture/pipelines/tool-loop/01-stream-once/)
via `LLMProvider.streamToDiscord()`. That facade constructs a provider-specific `StreamAdapter` and
a `StreamConfig`, then delegates to `StreamOrchestrator.streamToDiscord()`.

## Optional Decision capability

`SupportsDecisions` extends the optional capability map and resolver. `OpenrouterProvider` and
`CustomProvider` own its implementations; other providers remain unsupported.
`loadDecisionModelsForScope(scope)` in `providerFeatureExecutors.ts` supplies model menus and execution
validation with `DecisionModelOption` records. Managed options must pass availability and their
`selection.validateModel` entitlement check; availability alone does not admit a model. The repository
retains scoped registration and custom endpoint ownership checks even for managed catalogs.
Consumers persist their `reference`: `provider`, `modelId`, nullable `registrationId`, and
nullable `customEndpointId`. Global native entries have null registration IDs. Scoped native entries
carry their exact scoped registration ID. Custom entries use `custom:<connection_id>` and the exact
endpoint row ID, with a null native registration ID. Deletion and re-registration invalidate old
references even when a codename repeats.

`callDecisionsForProvider({scope, reference, evidence, questions, abortSignal?, onUsage?})` rechecks ownership,
the exact registration, saved credentials, and the stored custom protocol. Null selection returns
`unavailable/not-selected`. Evidence is text; questions are `{type: "predicate", id, instructions}`.
Managed execution resolves credentials through the owning option with capability `decision`.
The caller retains its selected slot (`decision` or `nudge-checker`) and scope state, so a pinned
checker uses its own payer. Previously resolved credentials are revalidated by the same option;
removing that option or refusing the request never switches to a saved catalog key.
IDs are unique application-owned identifiers, start with a lowercase letter, contain lowercase
letters/digits/underscores, and have at most 64 characters. Requests admit 1-64 questions. Rubrics,
thresholds, calibration, and response routing belong to consumers.

| Transport | Translation |
|---|---|
| Native OpenRouter | `/api/alpha/decisions`: text `state`, named `noul` questions and answers |
| Custom System One | `POST <stored-base>/systemone`: the same named `noul` protocol |
| Custom OpenAI Decisions | `POST <stored-base>/decisions`: text `input`, ordered predicates and predicate/refusal answers |

Results distinguish `completed`, `refused`, `denied`, `cancelled`, `invalid-input`, `unavailable`, and `failed`.
Request admission denials retain their error without logging an operational failure. Failed HTTP
responses preserve validated OpenRouter limit metadata as a cause; scrubbed HTTP status and body
details stay in retained warning or error logs and never enter the returned result.
Completed/refused results carry ordered typed answers, optional actual usage/cost, local correlation,
bounded provider request identity, and returned model ID. Probabilities must be finite in [0, 1].
Missing/extra/duplicate answers, wrong types/order, invalid usage, and explicit evidence truncation
fail validation. Partial OpenAI refusals return `refused`. No chat or prose interpretation is used.

`onUsage` receives validated usage before answer validation. A malformed verdict or cancellation
after response decoding retains reported spend. Routing records this callback once, including
responses settling after its deadline, without accepting their late verdict. Missing or invalid
usage stays unknown; HTTP failure results retain only validated limit metadata and the numeric media minimum.

Requests compose caller cancellation with the existing `STREAM_SDK_CALL_TIMEOUT_MS` policy. Responses
are bounded to 1 MiB. Until callers need a model-specific tokenizer, the serialized request's UTF-8
byte count must fit its documented input-token ceiling. This conservative admission rule can reject
otherwise fitting requests and never truncates evidence. Custom calls retain the SSRF gate and pinned
fetch. Discovery checks explicit Decision output modality, finite prices, and documented input limits.
Only OpenRouter receives global seeds; seeding does not select a model or activate a drafting gate.

INFO traces contain protocol, numeric model/registration identities, correlation, counts, elapsed
time, outcome, and actual usage/cost when supplied. They omit evidence, question text, caller labels,
raw bodies, credentials, and endpoint URLs. Failure reporting retains scrubbed provider diagnostics
with stage/category and optional HTTP status in existing `ErrorContext` metadata. Authentication,
model availability, throttling, network failures, timeouts and upstream outages produce a metric plus
a retained warning. Malformed requests and responses remain errors.
`failed.errorLogged` is true, so recovery must not log the failure again. Cancellation, valid refusal,
missing selection, and rejected input are expected outcomes. The existing logger hides INFO under
`RUN_ENV=production` unless `TEST_PRODUCTION=true`; retained warnings reach JSON logs at every level,
and errors also persist in `error_logs`. Both carry ambient workspace/turn context.

Protocol references: [OpenRouter Decisions](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request),
[System One](https://docs.typesafe.ai/api), and
[OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions).

## Usage reporting and request denial

`src/utils/provider/providerUsage.ts` owns optional usage reporting and request-denial translation.
`ResolvedCredentials.usageContext` carries request ownership through auxiliary requests, tool calls,
and stream contexts. `ProviderUsageContext` is a branded interface that deployment modules augment
through TypeScript declaration merging. Keep the same context object through a request: denial
matching uses object identity, so a nested request cannot claim another request's refusal.

`withProviderUsageContext(context, execute)` binds asynchronous work to its request owner.
`currentProviderUsageContext()` exposes that owner to the transport admission callback. Bind every
auxiliary operation explicitly, including an undefined context for an unfunded nested request; the
outer owner is restored when it returns. The release consumer is
`src/modules/supporter-billing/runtime/spendGuard.ts`, which uses the context to distinguish scopes
that share a credential. Its context factory returns the same object for the same funding object.

Callers report provider usage once per completed provider response, or pass
`createProviderUsageRecorder(context, model)` as the provider's `onUsage` callback. Reports preserve
reported cost, tokens, and provider request identity; they do not estimate missing charges. Job
polling reports the final job identity once at the caller. A registered reporter owns persistence and
deduplication. Reporting does not await storage, and reporter failures cannot fail inference.
Without a reporter, reporting does nothing. Document retrieval and re-embedding accept the same
embedding `onUsage` callback; the caller supplies the recorder for each response.
Decision execution owns its usage recorder and forwards validated usage to consumer callbacks.
RAG query retrieval and config model re-embedding supply the same recorder under their resolved
credential context. A model-switch denial retains that context through the result and localized
panel receipt; the successful selection write and cache invalidation still precede re-embedding.

`ProviderRequestDeniedError` carries its context and a locale-dependent renderer. The renderer returns
a title locale key and localized description, and accepts a flag for fallback notices. A registered
translator can turn a provider failure into this error using the failed request's context.
`findProviderRequestDeniedError` searches both `cause` and `originalError`, checks ownership before
translation, and never translates a denial belonging to another context. Omit the context argument only
for credential resolution or an already-scoped error propagating to its presentation owner. An
explicit undefined context matches only an unscoped denial.
Check for denials before credential-specific and generic handling. `deferNotice` lets the stream
state machine leave a notice to the retry owner rather than posting it before fallback completes.

Commands and streams render `getProviderRequestFailureCopy`. Tools use
`notifyProviderToolFailure`, which returns the description and posts the same notice to the channel.
`isUserImpersonation` or `suppressFailureNotices` returns the description without posting. Channel-send failures preserve the
returned tool error. `StreamingContext` copies usage context through `buildStreamContext` so stream
error handling sees the same owner as its caller.

These entry points intentionally have no in-tree reporter, translator, or denial producer on main.
The release branch registers deployment implementations and supplies contexts during credential
resolution, including paths that main still serves through direct key decryption. This is an
exception to the dead-code rule: the release branch is a real consumer of this shared contract.
Registration belongs at startup; each registration returns a disposer that restores the previous
handler, which also lets tests isolate their registrations.

## Recovery and completion copy

Provider options may supply `contributeCopy(context)` in `providerOptionRegistry.ts` to return one
locale key or null. `withProviderOptionCopy(keys, context)` appends those contributions to existing
recovery tips or completion receipts. Callers choose the eligible surfaces explicitly and pass the
user Discord ID, internal workspace ID, `server` or `personal` credential scope, and managed provider
identity (null for ordinary credentials). Managed usage contexts carry `credentialScope` independently
of deployment-specific source tags; a catalog transport name does not identify the managed provider
that paid for a request.

The callback owns eligibility and copy only. It cannot send messages, acknowledge interactions, or
change billing state. Commands acknowledge an error response before awaiting eligibility; successful
modal and pagination paths keep their own acknowledgement. Request-denial surfaces skip recovery
contributions. Missing contributions preserve existing tips and receipts, and a failed lookup cannot
prevent the original response. Release registers Subscription eligibility on its provider option,
including active member and workspace sponsorship suppression.

## Request holds

`src/utils/provider/providerRequestHook.ts` owns the optional request hook. A registered hook returns
an optional hold for one provider request: `reportCost` settles the request's reported cost, and
`release(retainEstimate)` ends the hold, counting the initial estimate as spent when `retainEstimate`
is set and no cost arrived. The stream adapter and the job-based adapters call `beginProviderRequest`
before the HTTP call, report each cost the provider or the job reports, and release the hold on
completion or failure. HTTP errors and pre-send aborts report zero; an in-flight failure releases
the hold without retaining an unreported estimate. Already-reported costs survive release.
With no hook registered,
`beginProviderRequest` returns no hold and each adapter sends exactly the request it sent before.

`fetchWithProviderRequest` wraps the one-shot POST JSON callers. With no hook registered it calls the
underlying fetch directly, with no body buffering. With a hook, it begins a hold from the bearer key,
the URL path, and the parsed body; reads the response through the bounded reader; reports the JSON
response's `usage.cost`; and returns an equivalent response so callers still read the body. Callers
that need a gated transport pass it as the third argument. Hooks must never log the API key, path, or
body. A registered hook also disables the OpenRouter adapter's verbose fetch output, because that
output can print the headers and body the hook accounts for. The OpenRouter embedding SDK uses
`fetchWithProviderRequest` through its `HTTPClient` and always disables SDK debug output.

The hook has no in-tree implementation on main. The release branch registers its deployment
implementation at startup, and the registration returns a disposer like the usage and denial ones.

## Provider options

`src/utils/provider/providerOptionRegistry.ts` owns the optional extra entries the provider panels,
setup wizard, and model views can offer beside the built-in providers. Built-in providers keep their
existing code paths: every surface asks the registry first and falls through unchanged when nothing
is registered. Registration returns a disposer, and no option is registered in-tree on main.

An option declares its stored provider value, the provider catalog its models come from, the
capabilities it serves, and the copy keys every surface renders. Its `availability` decides whether
the workspace or user can use it and supplies the locale key that explains a refusal. Its `selection`
hooks own the payer state: `load` reports a stored selection the panel can show, `ensure` creates one,
`owns` answers which capabilities that payer currently holds, `claim` and `release` move a capability
between payers, `validateModel` refuses a model the payer cannot serve, and `remove` deletes the
stored selection. `setSpeech` writes speech selection and registration under the option's payer;
its input preserves scope, mode and replacement identity. Hosted speech registration resolves the
catalog separately and sends option writes to this callback, so personal options can store selections
without built-in credentials. Built-in speech writes keep using the speech repository.
The registry never adds storage of its own.

An option's panel `handleAction` owns interaction acknowledgement. It may show a modal immediately,
or acknowledge before awaiting its lazy `loadSelection()` callback, which loads the scope and edit
entry. Returning false repaints an acknowledged interaction or sends a refusal on an unacknowledged
one. Setup acknowledges option selection and `setup.handleAction` buttons before awaiting provider work.
`setup.components` receives `actionRouteId`; controls using that ID dispatch to `setup.handleAction`,
whose optional receipt appears on the repainted wizard. This route supports one option control; add
a sub-action segment before introducing a second. `startSetupWizard` also accepts an acknowledged
button, and the initial provider-panel builders accept component interactions and a receipt.
The release consumers are `src/modules/supporter-billing/discord/providerOption.ts` for setup
onboarding and `src/modules/supporter-billing/subscribe/components.ts` for returning to setup or
provider panels after subscription actions.

Surfaces resolve an option through `findProviderOption` before treating a provider value as a
built-in one. `getProviderDisplayName` resolves the option's `copy.labelKey`, and
`loadConfigModelChoices` loads models from its `catalogProvider`. Model views attribute a slot to
the option only while its `owns` answers for that capability, so the same model ID under the catalog
provider and under the option stay distinct.
Reviewer labels and picker defaults use the active slot owner. Fallback displays resolve each stored
reference through the registry's fallback-owner callback before choosing its provider label; the
callback leaves payer persistence and retry policy with their owning module.
`claimProviderModelSelection` records ownership after a successful selection write, and
`clearProviderModelSelection` releases it when a slot is emptied. Built-in selections release the
previous option's marker even when the new model comes from another catalog. Removing a built-in
server provider checks text ownership the same way, so a catalog provider whose models an option
pays for is not reported as the active payer. The model-write
wrapper runs `onWritten` after every successful model write, including failed or throwing ownership
updates, so callers can invalidate cached state.

Structured calls outside the persona's own turn (the pinned response reviewer and Natural Nudges)
resolve their model through `resolveServerStructuredModel`
(`src/utils/provider/serverStructuredOutput.ts`), which names the slot that pays: `reviewer`,
`nudge-planner`, `nudge-checker`, or `text` when the call borrows the server's chat model. An option
that owns that slot must supply the key through `selection.resolveCredentials`, together with
its usage context and optionally the saved row whose settings the call mirrors. An owning option that
is unavailable or has no resolver leaves the call unavailable rather than falling back to the
server's saved key, and a `ProviderRequestDeniedError` it throws reaches the caller. Each selection
of a pinned slot claims or releases it like any other model write.

`selection.resolveCredentials` accepts a personal or server scope, the capability whose slot owns
the request, and the exact catalog model ID. It returns an API key, its usage context, and an optional
`savedProvider` identifying the settings row. That saved provider can differ from `catalogProvider`:
a managed option can use an OpenRouter model without using the saved OpenRouter key. The callback
resolves one chosen credential; callers own routing and fallback policy. Null means unavailable and
must not cause the caller to try the catalog provider's key.
Speech synthesis passes the admitted key and usage context as `previous` to the same callback.
The option must revalidate that payer and credential, refusing a changed identity or key; a successful
revalidation returns the current usage context. The dispatcher refuses a missing option, unavailable
resolver, or changed key before sending audio.

An option's usage context identifies its credential owner through `credentialProvider`. Nested
OpenRouter search calls that option's resolver with the initiating `usageContext` alone, preserving
the fallback or pinned request's owner and model. The callback returns that same context and its
current key. A missing resolver, refusal, or different returned context stops the search without
trying a saved key or resolving the current default text provider.

`resolveCapabilityCredentials` uses this callback for explicit option selections and for the active
option owning a default capability. Default server resolution passes the loaded capability columns
as `scope.modelConfig` to the ownership lookup. Personal routing keeps its existing precedence and
BYOK restriction. Resolved credentials retain the selected model ID, scope, settings row, and usage
context; built-in custom providers also retain their model-specific endpoint and API style.
`resolveTextCredentialState` builds request state from those resolved values, so a personal key uses
its selected model and sampler settings instead of the persona's server model or endpoint.
Expressions can resolve the `vision` slot through the same state builder. Persona generation,
compaction, cost probing, and hidden image planning resolve credentials before choosing their
request model and endpoint; cost estimation keeps its legacy estimate when server credentials are
missing. Persona generation resolves after modal submission, so a refusal retains the submitted
inputs and does not consume the operation quota.

Deployment behavior maps onto these fields:

| Behavior | Field |
|---|---|
| Stored provider value | `value` |
| Models sourced from an existing catalog | `catalogProvider` |
| Capabilities offered and panel sections exposed | `capabilities` |
| Scope eligibility and refusal copy key | `availability` |
| Stored payer presence for the panel entry | `selection.load`, `selection.ensure` |
| Capability ownership read, write, and clear | `selection.owns`, `selection.claim`, `selection.release` |
| Model admission and refusal | `selection.validateModel` |
| Payer-aware speech selection and registration | `selection.setSpeech` |
| Credentials for a selected scope, capability, and model | `selection.resolveCredentials` |
| Removing the stored selection | `selection.remove` |
| Panel entry, description, and removal copy | `copy.labelKey`, `copy.entryDescriptionKeys`, `copy.removeImpactKey` |
| Panel select action and its copy | `copy.addActionLabelKey`, `copy.addActionDescriptionKeys`, `panel.handleAction` |
| Panel entry buttons and extra components | `panel.entryActions`, `panel.entryComponents`, `panel.entryOwned` |
| Model option description | `copy.modelDescriptionKey` |
| Setup option, summary, receipt, onboarding, and commit | `setup.optionLabelKey`, `setup.optionDescriptionKey`, `setup.summaryKey`, `setup.receiptDescriptionKey`, `setup.available`, `setup.ready`, `setup.components`, `setup.committed`, `setup.handleAction` |

One deployment-managed behavior stays outside the registry because main has no field for it: a
fallback ref's payer tag. A deployment that needs it keeps that tag on its own branch, where
`src/types/db/schema.ts` and the fallback identity helpers already differ.

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
