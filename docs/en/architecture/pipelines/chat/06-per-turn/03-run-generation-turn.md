---
title: "06.3: Generation Turn"
---

Drive the provider call with model fallback and API-key rotation.

- **File**: `src/utils/chat/generationTurn.ts:77-283` (`runGenerationTurn` and the attempt loop)

## Mission

Run the LLM call for this turn, with two layers of resilience: a **model
fallback chain** (primary model + any configured fallback entries) and, per
attempt, an API-key rotation loop (cycles through saved rotation keys
before giving up). Each attempt delegates the actual streaming + tool-call
dispatch to the [tool-loop pipeline](../../tool-loop/). Emits stream results to the sink and finalizes
with the first non-error result (or the last attempt's result if all fail).

## Input

- `ChatTurnContext` (from per-turn stage 01, with `responseTarget` populated
  by stage 02).
- `ChatResponseSink` (from per-turn stage 02).

## Output

`GenerationTurnResult`: see `src/utils/chat/types.ts:244-250`:

```ts
{
  status: StreamResult["status"] | "skipped";
  streamResults: StreamResult[];
  personaResponses: ChatPersonaResponse[];
  thoughtLog?: ThoughtLogPayload;
  thoughtLogOwner?: ThoughtLogOwner;
  usageEntries?: TurnUsageEntry[];
}
```

`status === "skipped"` is emitted when the attempts list is exhausted without
a non-error result *and* the loop falls through (rare; defensive).

## Side effects

### Per-attempt setup (`buildGenerationPlan`, `createAttempt`)

- Resolves the primary `TomoriState`: applies personal-provider selection
  (if BYOK), channel LLM override (a thread without its own override
  inherits its parent channel's), and any `llmOverrideCodename` from the
  incoming.
- Selects an API key from the rotation pool, falling back to the server's
  own encrypted key via `decryptApiKey`.
- Builds a `ProviderConfig` via the resolved `LLMProvider.createConfig`.
- Assembles a unified pool with the primary model at index 0 followed by
  every configured fallback entry, then builds one attempt per pool member
  (custom-endpoint or saved-provider-config flavor). The lead attempt is always
  labelled `"primary"` in logs even when the randomizer (below) promoted a
  fallback into that slot; the true model is still visible via `successModel`.
- Resolves a custom-endpoint fallback from the endpoint row's connection ID. Server
  endpoints use the server's saved custom provider, while personal endpoints use
  the owning user's saved provider and key. Personal fallback refs are isolated
  from the server chain and retain their configured order.
- Returns a plan rather than a bare list: the attempts for the route the turn was
  planned on, plus an optional extension thunk for the server route (below). The
  thunk is not invoked here, so a turn that never leaves its planned route never
  resolves server provider config or asks for the server's quota admission.

### Per-turn model randomizer (`buildPlannedRouteAttempts`, `buildServerRouteAttempts`)

- When `config.model_randomizer_enabled` is `true` and the pool has ≥2 members,
  a random pool member is spliced to the front of the attempt list **per
  generation turn**; the remaining members keep their relative order as the
  failover tail. This is a pure *reordering*: the original primary stays in the
  chain and serves as failover if the random lead errors. No model is dropped
  and no model is attempted twice.
- Because the fallback-used notice keys on `index > 0`, a randomized lead that
  *succeeds* stays silent (no spurious "Fallback Used" embed); a genuine
  failover after the lead fails still notifies correctly.
- When the toggle is `false`, the pool order is unchanged (`[primary,
  ...fallbacks]`), preserving the deterministic primary-first behavior.
- The server toggle is `server_chat_configs.model_randomizer_enabled`, set via
  `/config` > Models > Fallbacks & Randomizer, which refuses to enable unless ≥1 fallback model is
  configured, guaranteeing the pool always has ≥2 members.
- `config.model_randomizer_enabled` is not always the server value. When a user has
  an active personal Text route, `applyPersonalProviderSelectionsToTomoriState`
  overlays that provider row's own `user_saved_provider_configs.model_randomizer_enabled`
  (migration 076), so a personal preference wins in both directions: personal `false`
  suppresses a server `true`, and personal `true` applies under a server `false`. A row
  counts as the active Text route only when it has the `text` capability enabled and
  a configured text model, so a personal row whose model pointer went NULL leaves the
  server value in place. `/personal config` > Models > Fallbacks writes it through
  `personalConfigOperations.setRandomizer`.
- Each pool draws on its own state: the planned route's pool reads the overlaid
  personal flag, and the server route's pool reads the unmodified server flag. A
  personal randomizer therefore never reorders the server route, and vice versa.

### Server route fallback (`resolveServerRouteExtension`, `buildServerRouteAttempts`)

- Exists only for a turn planned on personal text credentials outside user
  impersonation. Every other turn's planned route already is the server route,
  so there is nothing to extend with.
- Is materialized once, and only after every planned attempt has failed on an
  `error`/`timeout`. Until then nothing about the server route is resolved: no
  server provider config, no server key, no admission. The extension runs from the
  attempt loop, not from the plan builder.
- Rebuilds its pool from the unmodified server state
  (`resolveTomoriStateForRoute(context, "server")`: persona server model, channel
  override, then `llmOverrideCodename`), so each attempt carries the server's
  credentials even when both routes name models from one provider. Attempt numbering
  continues from the planned route, so log labels stay unique.
- Is withheld when the server sets `user_byok_mode`: the server does not lend its
  models to member-triggered turns, so a failure on member credentials is the turn's
  outcome rather than a reason to reach for them.
- Is withheld when the account set `personal_server_fallback_enabled` to `false` in
  `/personal config` > Models > Fallbacks. The column defaults to `true` and the
  projection reports that default, so only an explicit opt-out withholds it.
- Admits itself against the server's own rules before building any attempt
  (`admitServerRoute`), because planning skipped both of them while the personal route
  was paying. A refused admission contributes no attempts, so the personal failure
  stays the outcome:
  - **Message cooldown.** `admitServerRouteCooldown` runs the same
    `enforceServerTriggerCooldownForAdmission` planning runs for a server-sourced turn,
    under the same exemptions (stop responses, persona jobs, the bot's own messages).
    Without it, a personal provider that fails on every message would buy a server reply
    on every message for as long as the server's quota allows, and a server that leaves
    quota off would never stop at all.
  - **Text quota.** `admitServerRouteTextQuota` reuses `checkTextQuotaForAdmission` with
    the applicability predicate planning uses (`shouldApplyServerTextQuota`). A refusal
    is reported once per trigger: a refusal stores no quota state, so a reply that runs
    several persona turns would otherwise take the check again and post one quota embed
    per turn (`markTextQuotaRefused` / `hasTextQuotaBeenRefused`).
- A granted quota admission arms `context.shouldApplyTextQuota` and
  `context.textQuotaState`, which is what makes post-turn consumption charge the
  server. Consumption itself stays in post-turn effects and still requires a reply,
  so a server route that also fails costs the quota nothing.
- Once it contributes an attempt, the turn's reported credential source switches to
  `server` on both `ChatTurnContext` and `StreamingContext`. Everything downstream reads
  that field as "who is answering": the thought-log attribution no longer credits the
  user's personal provider, and a failing server attempt gets server-scoped recovery
  tips instead of "switch your personal model".
- A suppressed attempt holds its SDK-call timeout notice back while a fallback is still
  pending (`StreamingContext.deferredTimeoutNotice`). If the server route then
  contributes nothing, the terminal branch resends it, because no error result carries a
  timeout and the turn would otherwise end in silence. The resend only happens on a turn
  that surfaces user errors outside impersonation: the tool loop also defers on turns
  that hide errors on purpose (auto-chat, random triggers), and those stay silent.
- A success on this route is the only fallback that names an opt-out: the
  `Fallback Used` details modal then points at `/personal config` > Models >
  Fallbacks through `offerPersonalFallbackOptOut`. A personal-route success has no
  such control to point at, and a model that is its route's own lead reports slot 1
  rather than a fallback slot it does not hold.

### Per-attempt context prep (`prepareProviderContextItems`)

- Resolves dialogue `mediaDescriptors` into final image/video parts or
  model-appropriate system notices using the attempt's `TomoriState`. This is
  where personal-provider routing, fallback model capability differences, and
  OpenRouter live media capability corrections affect media visibility.
- Applies token-limit truncation (`truncateDialogueHistory`) whenever
  `resolveContextBudget()` knows the window. `resolveModelLimits()` supplies it
  for every provider except NovelAI: a live provider value first (the OpenRouter
  capability cache, or the Anthropic and Gemini models APIs through
  `liveModelLimitsCache.ts`), then the catalog's `llms.context_window`, and for a custom
  endpoint the `num_ctx` its request sends. An unknown window skips truncation.
  NovelAI keeps its subscription-tier windows.
- The reserved output budget comes from `resolveChatMaxOutputTokens`, the same
  function every request builder sends through: the server's `/config` > Models >
  Text Samplers & Parameters override (`config.llm_max_output_tokens`) wins, then
  the provider env cap (`OPENROUTER_MAX_OUTPUT_TOKENS`, `GOOGLE_MAX_OUTPUT_TOKENS`,
  `ANTHROPIC_MAX_OUTPUT_TOKENS`), then a per-provider fallback (8192 for
  OpenRouter, Gemini, and Anthropic; 4096 for the other OpenAI-compatible
  providers and custom endpoints), clamped to the model's output ceiling
  (`llms.max_output_tokens` or the live value) when known. The fallback alone also
  shrinks to a quarter of a known window, because a 4096 default on a 4096 `num_ctx`
  would leave no room for history; an override or env cap is sent as set. The clamp also keeps a
  server override above the model's real cap from being rejected. Keeping the
  reserve in lockstep with the request avoids over-dropping history. The one
  exception is an OpenRouter model with no known ceiling: its request omits
  `max_tokens`, and truncation still reserves the default budget.
- If the previous attempt ended with `emptyResponseFinishReason === "length"`
  and we're on a retry, additionally drops the oldest history exchange
  pairs.

### Per-attempt execution (key rotation inner loop)

- Calls `runToolLoop(...)`: see [tool-loop pipeline](../../tool-loop/).
- On success: `recordKeySuccess(rotationKeyId)`, break out of the rotation
  loop.
- On error: classifies the error (rate-limit vs api-error),
  `recordKeyError(...)`, rotates to the next rotation key (up to
- Suppresses user-facing stream errors while another rotation key or model
  fallback can still be tried.
- Holds non-final failed model attempts out of `responseSink.emitStreamResult`
  so their details can be summarized by the fallback notice instead of posted
  as public errors.
- On completed model fallback: sends the compact `Fallback Used` button notice
  with the earlier failure chain available in a read-only text modal, unless a stop/follow-up
  interrupt is pending for the channel.
- On non-error or last attempt: emits only final error results, calls
  `responseSink.finalize(result)`, and returns.
- A pending server route counts as a pending model, so the last planned attempt keeps its
  errors suppressed while a server model may still answer. The terminal branch resets
  suppression before emitting the error, and reports a held-back timeout notice.
- On thrown error: calls `responseSink.emitError(error)` and finalizes with
  an `error` result, except under user impersonation, where `emitError`
  rethrows by design and neither the `error` result nor `finalize` is reached.
  `responseSink.cleanup()` runs from a `finally` on every path, so per-turn
  resources are released even then.

### Superseded-message cleanup (`purgeSupersededDeliveries`)

- A shared, per-turn sink (`streamingContext.deliveredMessageRefs`) collects one
  entry per message the streaming layer commits to Discord. The orchestrator
  appends to it in `uiUpdater.recordSuccessfulSend`, and because it is threaded
  through `buildStreamContext` as an array *reference*, the entries survive even
  when a stalled `streamToDiscord` promise is abandoned by the SDK-call-timeout
  race in the tool loop (that path returns `timeout` but never reports the
  messages it had already flushed).
- Whenever the stage decides not to keep an invocation's result (a
  key-rotation retry, or a model fallback after an `error`/`timeout`), it deletes
  that invocation's already-committed messages. Deletion tries the persona webhook
  first (`webhook.deleteMessage`, no Manage Messages needed) and falls back to a
  channel-level delete (`channel.messages.delete`) if that fails (e.g. the
  webhook was recreated mid-stream) or for bot-native messages. It is
  best-effort: individual failures are logged and skipped. This prevents a
  timed-out primary's truncated partial output from lingering above the fallback
  model's complete response (two conflicting messages). The surviving/final
  attempt's messages are always kept. On total failure, the last attempt's output
  stays and the error embed is shown.
- **Straggler safety:** on the SDK-call timeout the tool loop aborts the stalled
  stream but the losing `streamToDiscord` promise is not cancelled; only its HTTP
  request is. `streamOnce` therefore awaits that promise settling (bounded by
  `STREAM_ABANDONED_SETTLE_TIMEOUT_MS`) before returning `timeout`, so any Discord
  send that was already in flight is recorded in `deliveredMessageRefs` *before*
  the fallback path's cleanup runs and cannot leak past it.
- **Scope:** only messages sent through `StreamUiUpdater.recordSuccessfulSend` are
  tracked. Ancillary artifacts posted outside that path (the alter "Replying
  to…" notice, warning/progress embeds) are not tracked and may persist after a
  purge.

### NovelAI subscription refresh

- For NovelAI providers without a cached context-token count, refreshes the
  subscription via `refreshNovelAISubscription` (one-shot, cached for
  subsequent turns).

## Invariants

After this stage runs:

- `responseSink.finalize(result)` has been called exactly once on every path
  that returns a result: that is, all of them except user impersonation, whose
  rethrowing error handler propagates instead of returning.
- `responseSink.cleanup()` has been called exactly once, without exception.
  This is the invariant per-turn resource release relies on; `finalize` is not.
- If the result is non-error, `result.personaResponses.length > 0` (or the
  status is `"skipped"`, which post-turn effects will distinguish).
- Rotation-key bookkeeping (`recordKeySuccess`/`recordKeyError`) reflects
  the outcome of the key that was actually used for each attempt.
- The server route never charges the server's text quota for a turn it did not
  answer: consumption is armed only when the route is entered, and post-turn
  consumption still requires a reply from the winning attempt.
- An account that turned the server fallback off never has server provider config
  resolved, and a server that requires member-provided providers never contributes a
  server route.
- No superseded attempt's partial output committed through the streaming send
  path (`recordSuccessfulSend`) remains in the channel: those messages are
  deleted, leaving only the surviving (or final) attempt's response. Artifacts
  sent outside that path (alter reply notice, warning embeds) are not tracked and
  are out of scope for this guarantee.

## Extension points

The stage is a coordinator over several plugin-relevant subsystems:

| Subsystem | Helper | Plugin-relevance |
|---|---|---|
| Provider dispatch | `ProviderFactory.getProviderByName`, `getProviderForTomori` | The provider plugin contract is the seam: see [provider pipeline](../../provider/) |
| Tool execution | `runToolLoop` | See [tool-loop pipeline](../../tool-loop/) |
| Key rotation | `selectApiKey`, `recordKeySuccess`, `recordKeyError`, `hasAvailableRotationKey` | Internal: rotation-key schema is core, not plugin-relevant |
| Fallback chain | `createFallbackAttempt`, `applySavedProviderConfig`, `resolveServerRouteExtension` | The fallback-entry schema (`FallbackEntry` union: `model` or `custom_endpoint`) is the data-model seam |
| Context truncation | `truncateDialogueHistory`, `resolveModelLimits` | A model's catalog `contextWindow` and `maxOutputTokens` are the registration surface |
| Personal-provider routing | `applyPersonalProviderSelectionsToTomoriState` | BYOK substitution; see [provider pipeline](../../provider/) |

- **The stage itself is internal**: its job is to orchestrate the
"attempt with fallback + key rotation" pattern. Plugins wanting to:

- **Add a new provider**: register it via the provider plugin contract.
- **Change attempt-list construction** (e.g. add a probe attempt before the
  primary): would extend `buildGenerationPlan`. → plugin plan candidate.
- **Intercept stream results**: wrap the sink (per-turn stage 02), not this
  stage.

## Configuration

| Source | Key | Value | Purpose |
|---|---|---|---|
| Env var | `OPENROUTER_APP_ATTRIBUTION_ENABLED` | `true` | Sends TomoriBot app attribution headers to OpenRouter for app rankings and aggregated usage analytics. Set to `false` to omit them. |
| Constant (`generationTurn.ts`) | `OPENROUTER_LENGTH_EMPTY_RETRY_DROP_PAIRS` | `2` | Per-retry history-pair drop count when OpenRouter returns empty/length |
| Env var | `OPENROUTER_MAX_OUTPUT_TOKENS` | `8192` | OpenRouter truncation/request output-token cap (overridden by `/config` > Models > Text Samplers & Parameters) |
| Env var | `GOOGLE_MAX_OUTPUT_TOKENS` | `8192` | Gemini truncation/request output-token cap (overridden by `/config` > Models > Text Samplers & Parameters) |
| Env var | `ANTHROPIC_MAX_OUTPUT_TOKENS` | `8192` | Anthropic truncation/request output-token cap (overridden by `/config` > Models > Text Samplers & Parameters) |
| Constant (`toolLoop.ts`) | `STREAM_ABANDONED_SETTLE_TIMEOUT_MS` | `5000` | Max wait (ms) for an SDK-timeout-aborted stream to settle so its in-flight sends are recorded before superseded-message cleanup. `0` disables the wait. |

Plus `MAX_KEY_ATTEMPTS` from `keyRotation.ts`.

## Related docs

- Tool execution loop: → [tool-loop pipeline](../../tool-loop/)
- Provider streaming + adapter pattern: → [provider pipeline](../../provider/)
- Key rotation: → no dedicated doc yet; `keyRotation.ts` helper only
- Fallback chain schema: → [`docs/en/architecture/subsystems/database-schema.md`](../../../subsystems/database-schema) (`fallback_chain` column)
- Personal-provider runtime substitution: → [provider pipeline](../../provider/)

## Response-text review

`runGenerationAttempts` creates one `ResponseReviewState` before selecting attempts when Response
Drafting is On. Ordinary persona text uses `holdResponseText`; text-suppressed tool-only work and
user impersonation retain their existing paths. Off makes no review request and keeps streaming.
The state survives model fallback and key rotation: review/revision counters, correction feedback,
successful tool history, tool-review and correction counters, rejected request identities, verdict
identity, and actual usage remain turn-local. Each failed author
attempt discards its pending presentation without discarding successful tool results.

`responseReview.ts` projects only admitted `contextItems` and actual function history into a JSON
packet. The pending candidate has a separate label from historical replies. Persona instructions,
trigger, explicit reply target, visible participant fields, memories/documents, and tool outcomes
are required. The two most recent dialogue items are retained; older dialogue and complete sample
pairs have bounded optional coverage. Emoji, sticker, sprite, and verbatim-tool catalogs are omitted.
Participant fields come from the same privacy-filtered hydration used by the author, before mention
rendering instructions. Tool arguments use the existing credential redactor.

The packet requires complete text evidence. Uninspected media, tool image outcomes, a missing
trigger/target/persona, redaction of the candidate, or required evidence exceeding the budget makes
review unavailable. The model's admitted context window bounds input conservatively by UTF-8 bytes,
with a 96,000-byte ceiling and space reserved for protocol and output. Unknown model limits also
make review unavailable; review does not discover limits through an extra provider request.

An inherited reviewer uses the actual author attempt's model, capability, and key. A pinned reviewer
revalidates its workspace registration and resolves its own saved provider and endpoint. The existing
structured-output capability performs one private request with strict `pass`, `revise`, or
`unavailable` validation. Immutable evidence and output instructions surround the editable creative
rubric. Candidate text and tool results are evidence and cannot change the review protocol.

A turn allows two response reviews and one author revision. Pass delivers without another author
request. Revise sends concise persona-aware findings and the whole pending reply back to the author,
with successful tool outcomes retained. A second revise delivers the latest candidate within the
budget. Refusal, malformed output, or a 120-second deadline makes review unavailable and delivers
the current candidate without correction or another reviewer. A verdict can be reused only for the
same model, candidate, rubric, and complete evidence packet.

Reviewer resolution and execution use the channel watchdog. `/kill`, follow-up interruption, or turn
abort cancels review and discards held prose. INFO records start/outcome, identities, budgets,
coverage, timing, and reported usage. Each operational failure emits one normalized ERROR; expected
refusals and cancellation remain INFO outcomes. Logs omit private packet and feedback content.

Actual author tool requests use the [pre-execution checkpoint](../../tool-loop/02-execute-tool-call.md#actual-request-review)
before any effect. The response allowance remains separate: eight tool reviews and two changed
corrections cannot consume the two final-response review calls. Unavailability at either checkpoint
ends review for the same turn, while earlier rejected actions remain blocked. The persisted setting
controls both checkpoints; optional checker evidence and Decision routing are not connected yet.
