<!-- ARCH-ALIGNMENT: prereq-phase-5.5d -->

# Stage 03 — `handleEnhancedContextRestart`

Consume a context-enrichment restart signal from a tool response and mutate
the live context before the loop continues.

**File:** `src/utils/chat/toolLoop.ts:333-364`

## Mission

Some tools respond with a `context_restart_*` typed payload instead of
normal result data. This signals that the tool has produced enriched context
that must be injected before the next provider call — rather than appending a
tool-response history entry and continuing, the loop restarts with a richer
context window.

`handleEnhancedContextRestart` inspects the tool result data, applies the
enrichment to `params.context.contextItems` and `params.context.streamingContext`,
and returns `true` to tell `executeToolCall` to return `{kind: "restart"}`.

This stage is called from within [stage 02 — `executeToolCall`](02-execute-tool-call.md)
immediately after the registry dispatch. It only runs when `toolResult.success
=== true`.

## Input

- `params: ToolLoopParams` — full loop context; `contextItems` and
  `streamingContext` are mutated in place.
- `data: unknown` — the raw `toolResult.data` value from `ToolRegistry.executeTool`.
  Expected shape when a restart is triggered:
  ```ts
  {
    type: "context_restart_<suffix>";   // e.g. "context_restart_message_metadata"
    enhanced_context_item?: StructuredContextItem;
  }
  ```

## Output

`boolean` — `true` if a restart was triggered and applied; `false` if `data`
was not a restart signal (caller continues normally).

## Side effects

All mutations apply only when `data.type` starts with `"context_restart_"`.

**Message-metadata restart** (`type.includes("message_metadata")`):
- Calls `annotateRecentMessageMetadataInContext` — annotates recent messages
  in `contextItems` with author/timestamp metadata and patches reply references.
  Logs annotated and patched counts.
- Appends a tail directive message block via `buildTailDirectiveMessage` +
  `buildRevealedMessageMetadataTailDirective` to `contextItems` when the
  directive is non-empty.
- Sets `streamingContext.disableMessageMetadataContext = true` to prevent
  the context-build pipeline from re-injecting the same metadata on a
  subsequent turn.

**All restart types:**
- Appends `data.enhanced_context_item` to `contextItems` when present — this
  is the primary enrichment payload (e.g. YouTube transcript, fetched image).
- Sets the type-matched disable flag on `streamingContext`:

  | `type` contains | Disable flag set |
  |---|---|
  | `"youtube"` | `disableYouTubeProcessing = true` |
  | `"image"` | `disableProfilePictureProcessing = true` |
  | `"gif"` | `disableGifProcessing = true` |
  | `"message_metadata"` | `disableMessageMetadataContext = true` |

  Disable flags prevent the context-build pipeline from re-fetching the same
  resource on follow-up turns within the same channel lock window.

## Invariants

After this stage runs (when it returns `true`):

- `contextItems` contains the enriched item at the end of the list — the
  next `streamOnce` call will include it in the provider's context.
- The `context_restart_*` tool call is **not** appended to `functionHistory`.
  The provider will not see the tool's raw response; it sees only the
  enriched context that was injected.
- `consecutiveToolErrors` in the outer loop is reset to `0` (restarts are
  treated as success).
- The loop does `continue` — the iteration count advances but no history entry
  is pushed for this tool call.

## Extension points

| Surface | Plugin-relevance |
|---|---|
| `context_restart_*` type namespace | The seam — a tool that needs to inject enriched context before the next generation returns a `context_restart_<suffix>` payload. Adding a new suffix requires a matching `type.includes(...)` check here and a new disable flag if re-fetch prevention is needed. → plugin plan candidate |
| `enhanced_context_item` field | The enrichment contract — any `StructuredContextItem` can be injected; type determines how the provider interprets it |
| Disable flags on `StreamingContext` | Internal — flags are consumed by the context-build pipeline; adding a new flag requires both the restart handler and the context-build stage that checks it |

## Related docs

- Context items and tags: →
  [`docs/pipelines/context-build/`](../context-build/)
- Stage 02 (caller): → [`02-execute-tool-call.md`](02-execute-tool-call.md)
- Tool-loop coordinator: → [`README.md`](README.md)
