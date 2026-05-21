<!-- ARCH-ALIGNMENT: prereq-phase-5.5d -->

# Per-Turn Stage 03 — `runGenerationTurn`

Drive the provider call with model fallback and API-key rotation.

**File:** `src/utils/chat/generationTurn.ts:46-152`

## Mission

Run the LLM call for this turn, with two layers of resilience: a **model
fallback chain** (primary model + any configured fallback entries) and, per
attempt, an **API-key rotation loop** (cycles through saved rotation keys
before giving up). Each attempt delegates the actual streaming + tool-call
dispatch to the [tool-loop pipeline](../../tool-loop/)
<!-- TBD-XREF:sibling -->. Emits stream results to the sink and finalizes
with the first non-error result (or the last attempt's result if all fail).

## Input

- `ChatTurnContext` (from per-turn stage 01, with `responseTarget` populated
  by stage 02).
- `ChatResponseSink` (from per-turn stage 02).

## Output

`GenerationTurnResult` — see `src/utils/chat/types.ts:244-250`:

```ts
{
  status: StreamResult["status"] | "skipped";
  streamResults: StreamResult[];
  personaResponses: ChatPersonaResponse[];
  thoughtLog?: ThoughtLogPayload;
  thoughtLogOwner?: ThoughtLogOwner;
}
```

`status === "skipped"` is emitted when the attempts list is exhausted without
a non-error result *and* the loop falls through (rare; defensive).

## Side effects

**Per-attempt setup (`buildGenerationAttempts`, `createAttempt`):**

- Resolves the primary `TomoriState` — applies personal-provider selection
  (if BYOK), channel LLM override, and any `llmOverrideCodename` from the
  incoming.
- Selects an API key from the rotation pool, falling back to the server's
  own encrypted key via `decryptApiKey`.
- Builds a `ProviderConfig` via the resolved `LLMProvider.createConfig`.
- For each fallback entry: builds another attempt (custom-endpoint or
  saved-provider-config flavor).

**Per-attempt context prep (`prepareProviderContextItems`):**

- Applies provider-specific token-limit truncation
  (`truncateDialogueHistory`) for Gemini, OpenRouter, NovelAI.
- If the previous attempt ended with `emptyResponseFinishReason === "length"`
  and we're on a retry, additionally drops the oldest history exchange
  pairs.

**Per-attempt execution (key rotation inner loop):**

- Calls `runToolLoop(...)` — see [tool-loop pipeline](../../tool-loop/)
  <!-- TBD-XREF:sibling -->.
- On success: `recordKeySuccess(rotationKeyId)`, break out of the rotation
  loop.
- On error: classifies the error (rate-limit vs api-error),
  `recordKeyError(...)`, rotates to the next rotation key (up to
  `MAX_KEY_ATTEMPTS`).
- Emits each stream result to `responseSink.emitStreamResult`.
- On non-error or last attempt: calls `responseSink.finalize(result)` and
  returns.
- On thrown error: calls `responseSink.emitError(error)` and finalizes with
  an `error` result.

**NovelAI subscription refresh:**

- For NovelAI providers without a cached context-token count, refreshes the
  subscription via `refreshNovelAISubscription` (one-shot, cached for
  subsequent turns).

## Invariants

After this stage runs:

- `responseSink.finalize(result)` has been called exactly once. Generation
  guarantees this in both the success and the `catch` paths.
- If the result is non-error, `result.personaResponses.length > 0` (or the
  status is `"skipped"`, which post-turn effects will distinguish).
- Rotation-key bookkeeping (`recordKeySuccess`/`recordKeyError`) reflects
  the outcome of the key that was actually used for each attempt.

## Extension points

The stage is a coordinator over several plugin-relevant subsystems:

| Subsystem | Helper | Plugin-relevance |
|---|---|---|
| Provider dispatch | `ProviderFactory.getProviderByName`, `getProviderForTomori` | The provider plugin contract is the seam — see [provider pipeline](../../provider/) <!-- TBD-XREF:sibling --> |
| Tool execution | `runToolLoop` | See [tool-loop pipeline](../../tool-loop/) <!-- TBD-XREF:sibling --> |
| Key rotation | `selectApiKey`, `recordKeySuccess`, `recordKeyError`, `hasAvailableRotationKey` | Internal — rotation-key schema is core, not plugin-relevant |
| Fallback chain | `createFallbackAttempt`, `applySavedProviderConfig` | The fallback-entry schema (`FallbackEntry` union: `model` or `custom_endpoint`) is the data-model seam |
| Context truncation | `truncateDialogueHistory` | Per-provider token-limit table is the registration surface |
| Personal-provider routing | `applyPersonalProviderSelectionsToTomoriState` | BYOK substitution; see personal-providers doc <!-- TBD-XREF:legacy --> |

**The stage itself is internal** — its job is to orchestrate the
"attempt with fallback + key rotation" pattern. Plugins wanting to:

- **Add a new provider** — register it via the provider plugin contract.
- **Change attempt-list construction** (e.g. add a probe attempt before the
  primary) — would extend `buildGenerationAttempts`. → plugin plan candidate.
- **Intercept stream results** — wrap the sink (per-turn stage 02), not this
  stage.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `OPENROUTER_LENGTH_EMPTY_RETRY_DROP_PAIRS` | `2` | Per-retry history-pair drop count when OpenRouter returns empty/length |
| `OPENROUTER_MAX_OUTPUT_TOKENS` | `8192` | Cap on OpenRouter truncation output-token budget |

Plus `MAX_KEY_ATTEMPTS` from `keyRotation.ts`.

## Related docs

- Tool execution loop: → [tool-loop pipeline](../../tool-loop/)
  <!-- TBD-XREF:sibling -->
- Provider streaming + adapter pattern: → [provider pipeline](../../provider/)
  <!-- TBD-XREF:sibling --> (currently in `docs/ai/streaming.md`
  <!-- TBD-XREF:legacy --> and `docs/ai/providers.md`
  <!-- TBD-XREF:legacy -->)
- Key rotation: → no dedicated doc yet; `keyRotation.ts` helper only
- Fallback chain schema: → `docs/systems/database-schema.md`
  <!-- TBD-XREF:legacy --> (`fallback_chain` column)
- Personal-provider runtime substitution: → `docs/ai/personal-providers.md`
  <!-- TBD-XREF:legacy -->
