---
title: "04: Build Result"
---

Assemble the final `GenerationTurnResult` from accumulated state.

**File:** `src/utils/chat/toolLoop.ts:411-455`
(includes `resolveThoughtLogOwner` at 441-450 and `mergeDetails` at 452-455)

## Mission

Construct the `GenerationTurnResult` returned by `runToolLoop` to its caller
(`runGenerationTurn`). Merges the NovelAI scene-metadata suffix into the
response text, packages the persona response objects, and resolves which
identity owns the thought log for display purposes.

This function is called from every exit point in the outer loop — both
terminal-status exits (completed, error, timeout, etc.) and the post-tool
`endTurn`/`shouldEndAfterPreToolText` exits.

## Input

- `status: GenerationTurnResult["status"]` — the final loop status.
- `context: ChatTurnContext` — provides persona identity and impersonation flags.
- `streamResults: StreamResult[]` — all stream results accumulated across
  iterations (included verbatim in the result).
- `responseText: string` — the final accumulated response text (empty string
  when no text was produced).
- `detailsText: string` — accumulated NovelAI scene-metadata content from
  `streamResult.detailsContent` fields across tool-call iterations.
- `thoughtLog: GenerationTurnResult["thoughtLog"] | undefined` — the last
  thought log payload emitted by any iteration, or `undefined`.
- `selectedSticker?: Sticker` — the latest successful sticker selection. The
  loop supplies it only on completed exits; timeout/error/stop paths and the
  max-iterations exit omit it.

## Output

`GenerationTurnResult` — defined in `src/utils/chat/types.ts`:

```ts
{
  status: StreamResult["status"] | "skipped";
  streamResults: StreamResult[];
  personaResponses: ChatPersonaResponse[];   // empty if no text
  thoughtLog?: ThoughtLogPayload;
  thoughtLogOwner?: ThoughtLogOwner;
  selectedSticker?: Sticker;
}
```

### `mergeDetails` — scene-metadata suffix

`detailsText` is produced by NovelAI when the model returns structured scene
metadata alongside its response. `mergeDetails` appends it as:

```
<responseText>

[Scene Metadata]
<detailsText>
```

If `detailsText` is empty or whitespace-only, `responseText` is used unchanged.

### `personaResponses` assembly

When the merged text is non-empty, a single `ChatPersonaResponse` is emitted:

```ts
{
  personaName: context.currentPersona.persona_nickname,
  text: mergedText,
  personaId: context.currentPersona.persona_id,
  personaLineageId: context.currentPersona.persona_lineage_id,
}
```

When the merged text is empty (e.g. status `"error"` with no pre-error text),
`personaResponses` is an empty array. Post-turn effects and the caller
distinguish empty `personaResponses` from the `"skipped"` status.

### `resolveThoughtLogOwner` — identity resolution

Maps the turn context to the thought-log owner shape:

| Condition | `thoughtLogOwner` |
|---|---|
| `context.isUserImpersonation === true` | `{ type: "user_impersonation", username, avatarUrl }` |
| `context.currentPersona.is_alter === true` | `{ type: "persona", persona: currentPersona }` |
| Default | `{ type: "default" }` |

`thoughtLogOwner` is `undefined` when `thoughtLog` is `undefined`.

## Side effects

None — this function is pure assembly; it reads state but does not write to
Discord, the database, the cache, or any external system.

## Invariants

After this stage runs:

- `streamResults` contains every `StreamResult` from every iteration,
  regardless of status.
- `personaResponses.length === 0` when there is nothing to display;
  `responseSink.finalize` (caller of `runGenerationTurn`) handles this case.
- If `thoughtLog` is present, `thoughtLogOwner` is also present.
- `selectedSticker` is present only when post-turn effects may safely deliver
  it after a completed text stream.

## Extension points

| Surface | Plugin-relevance |
|---|---|
| `ChatPersonaResponse` / `selectedSticker` result shape | Internal — the shape is consumed by `responseSink.finalize` and post-turn effects; changing it requires updating both consumers |
| `resolveThoughtLogOwner` identity types | Internal — `"user_impersonation"`, `"persona"`, `"default"` map to distinct display behaviors in the stream orchestrator |
| `mergeDetails` scene-metadata format | Internal — the `[Scene Metadata]` block format is NovelAI-specific; no plugin surface |

## Related docs

- Result consumer: → `responseSink.finalize` in
  [`docs/architecture/pipelines/chat/06-per-turn/02-create-response-sink.md`](../chat/06-per-turn/02-create-response-sink)
- Post-turn effects (reads `personaResponses`): →
  [`docs/architecture/pipelines/chat/06-per-turn/04-post-turn-effects.md`](../chat/06-per-turn/04-post-turn-effects)
- Tool-loop coordinator: → [`README.md`](README.md)
