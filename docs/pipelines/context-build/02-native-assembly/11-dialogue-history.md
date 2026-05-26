# Stage 11 — `appendDialogueHistoryContext`

The actual recent message history as alternating user/model items. The
bottom of the prompt, immediately above the LLM's next response.

**File:** `src/utils/text/context/dialogueHistory.ts:25-157`

## Mission

Iterate `simplifiedMessageHistory` (built by the chat pipeline's
`buildSimplifiedHistory`) and append one or more context items per message
with three orthogonal concerns interleaved:

1. **Role mapping** — persona-authored → `model`; user impersonation flips
   the impersonated user → `model`; everyone else → `user`.
2. **Media + vision dispatch** — within the media window, attach images
   and videos as binary parts when the model can see them; outside the
   window or without vision, emit `[System: contains N image(s)]` hints
   with optional `{image_analysis_tool}` or `increase_media_context`
   guidance.
3. **Context-note injection** — if `context_note` is configured, inject
   `[System: ${note}]` at `context_note_depth` messages from the end of
   history.

## Input

Substantial — see signature in `dialogueHistory.ts:25-44`. Notable:

- `contextItems: StructuredContextItem[]` — the in-progress list (mutated
  in place; this is the only contributor that doesn't return new items)
- `simplifiedMessageHistory: SimplifiedMessageForContext[]`
- `tomoriConfig` (provides `message_fetch_limit`, `humanizer_degree`,
  `context_note`, `context_note_depth`)
- `tomoriState` (provides `llm.sees_images`, `llm.sees_videos`,
  `context_note`)
- `mediaContextWindow: number | undefined` — override; falls back to
  `memoryGuard.getMediaWindow()`
- `seesImagesOverride`, `seesVideosOverride` — chat pipeline passes live
  OpenRouter capability flags here (overriding stale DB values)
- `hasVisionTool: boolean` — whether the active persona has a vision tool
  configured (changes the "can't see image" framing)
- `isUserImpersonation`, `impersonatedUserId`
- `messageIdMap` — compact ID ↔ Discord message ID, populated as media
  hints emit
- `uncensorInputOptions`, `toolPromptMacroResolver`, `convertMentions`

## Output

`Promise<void>` — appends to `contextItems` in place. Each appended item
is tagged `DIALOGUE_HISTORY` (default in `pushDialogueHistoryContextItem`)
or `CONTEXT_NOTE_INJECTION` for the injected note.

## Side effects

**Per message:**

- **Role mapping** computed from author type and impersonation flags.
- **Media-window calculation** — `effectiveMediaWindow = min(requested,
  message_fetch_limit)`; `mediaWindowCutoff = totalMessages - effectiveMediaWindow`.
- **Image/video parts emission** (within window, with vision):
  - Filters `MEDIA_IMAGE_MESSAGE_LIMIT` (env, default 3) most-recent
    messages that carry "counted" images (non-emoji, non-sticker).
  - Drops duplicate images that recur in a later in-window message
    (`duplicateImageLastIndex` lookup).
  - Pushes `{ type: "image", uri, mimeType }` parts onto the message's
    `parts` list.
- **Media-skip hints** (within window, no vision OR outside window):
  - With vision tool: `[System: ... use {image_analysis_tool} only if
    user explicitly asks]`
  - Without vision tool: `[System: model cannot see images, do not
    describe]`
  - Outside window: `[System: ... use increase_media_context with
    extend_by=N to view]` plus a registered ID via
    `messageIdMap.register(...)`.
- **Media attribution hint** — when media is referenced from a reply or
  forward, `[System: These images (Media IDs: X, Y) were sent by Z]`.
- **Text part assembly** — `${authorName}: ${content}` prefix, mention
  conversion, humanizer transform (model items at HEAVY+), uncensor
  input transforms.
- **Detached system parts** — system hints that should not be merged with
  the message text are split into a separate `user`-role item via
  `pushDialogueHistoryContextItem`.

**Context-note injection (once per build):**

- If `context_note` is set, computes `contextNoteTargetIndex = max(0,
  totalMessages - context_note_depth)`.
- Injects `[System: ${context_note}]` as a `user`-role item with tag
  `CONTEXT_NOTE_INJECTION` at the target index (or at the end if the
  history is shorter than the depth).

## Invariants

After this stage runs:

- For each message, exactly one *or* two items are appended:
  - One combined item when the role is `user` and media/text both exist
  - Two separated items (`user` system parts + `role` real parts) when
    the role is `model` and detached system parts exist
- Counted images respect `MEDIA_IMAGE_MESSAGE_LIMIT` — older counted
  images get skipped silently (with a system note when applicable).
- Duplicate images don't appear twice; the *last* occurrence in the
  window is the one that renders.
- Context note injects exactly once per build — either at the depth
  target or at the very end if history is shorter.
- `messageIdMap.register(...)` is called for every media reference the
  LLM might ask about (so `increase_media_context` and
  `image_analysis_tool` have stable IDs).

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `MEDIA_IMAGE_MESSAGE_LIMIT` | `3` | Max in-window messages that render counted images |

| Source | Field | Effect |
|---|---|---|
| `tomoriConfig` | `message_fetch_limit` | Caps media window |
| `tomoriConfig` | `humanizer_degree` | HEAVY+ applies humanizer to model items |
| `tomoriConfig` | `context_note`, `context_note_depth` | Context-note injection |
| `tomoriConfig` | `uncensor_unicode_space_enabled`, `uncensor_sanitize_enabled` | Drives uncensor transforms |
| `tomoriState` | `context_note`, `context_note_depth` | Persona-level override of tomoriConfig values |
| `tomoriState` | `llm.sees_images`, `llm.sees_videos` | Default vision capability |
| `tomoriState` | `vision_llm` | Whether a vision tool is configured |
| Memory pressure | `memoryGuard.getMediaWindow()` | Dynamic media-window shrink under load |

## Extension points

This is the **biggest contributor by complexity**, with multiple
plugin-relevant seams:

| Surface | Plugin-relevance |
|---|---|
| Media-window policy (`effectiveMediaWindow`, `maxExtendBy`) | Coupled to `memoryGuard` + `message_fetch_limit`. A plugin adding "always include all media" or "per-channel media budget" would extend the window calculation. |
| Vision capability override (`seesImagesOverride`, `seesVideosOverride`) | The chat pipeline passes live capability flags; new providers register via the capability system, not here. |
| `MEDIA_IMAGE_MESSAGE_LIMIT` policy | Hardcoded env var; a plugin adding "per-persona media limit" would extend the resolution. |
| Image-attribution hint format | Hardcoded English; localization would extend. → plugin plan candidate. |
| Humanizer + uncensor integration | Shared with sample dialogues (stage 10). |
| Context-note injection depth | Tomori-state can override tomoriConfig — a plugin adding "per-channel context note" would extend the resolution. → plugin plan candidate. |
| `pushDialogueHistoryContextItem` (the only contributor that uses it) | The push utility wraps tag defaulting; if a plugin emits its own dialogue items it would use the same helper to stay consistent. |

**A plugin extension for "alternate history rendering"** (e.g.
collapse-tool-calls, anonymize-user-content, summarize-old-messages) would
most naturally take the form of a per-message pre-processor running before
the role mapping + text/media emission. → plugin plan candidate.

## Related docs

- History helpers (`history.ts`): covered in
  [native-assembly README](./README.md#shared-helpers-used-across-contributors).
- Message-ID map: → no dedicated doc; `messageIdMap.ts` helper only
- Image-analysis tool: tool registry (→ [tool-loop pipeline](../../../tool-loop/))
- `increase_media_context` tool: tool registry (same source)
- Memory-pressure media-window shrinking:
  → no dedicated doc; `src/utils/security/rateLimiter.ts` helper only
- Humanizer transform: → `src/utils/text/processors/formatters.ts` helper
- Uncensor transform: → `src/utils/text/uncensor.ts` helper
