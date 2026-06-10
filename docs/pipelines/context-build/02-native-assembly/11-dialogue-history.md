---
title: "02.11: Dialogue History"
---

The actual recent message history as alternating user/model items. The
bottom of the prompt, immediately above the LLM's next response.

**File:** `src/utils/text/context/dialogueHistory.ts:25-157`

## Mission

Iterate `simplifiedMessageHistory` (built by the chat pipeline's
`buildSimplifiedHistory`, which has **already collapsed runs of consecutive
same-author pure-text messages** into single entries) and append one or more
context items per message with three orthogonal concerns interleaved:

1. **Role mapping** — persona-authored → `model`; user impersonation flips
   the impersonated user → `model`; everyone else → `user`.
2. **Media descriptor emission** — decide only context budget: whether media
   is inside the media window, whether counted images fit
   `MEDIA_IMAGE_MESSAGE_LIMIT`, and whether duplicate images should be dropped.
   The builder records capability-neutral `mediaDescriptors` instead of
   deciding whether an image/video becomes a provider media part. The
   per-attempt resolver (`mediaResolver.ts`) later turns descriptors into
   final image/video parts, `{image_analysis_tool}` notices, plain blind-model
   notices, or `increase_media_context` hints.
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
- `tomoriState` (provides `context_note` and `context_note_depth`; media
  capability is intentionally not read here)
- `mediaContextWindow: number | undefined` — override; falls back to
  `memoryGuard.getMediaWindow()`
- `isUserImpersonation`, `impersonatedUserId`
- `messageIdMap` — compact ID ↔ Discord message ID, populated as media
  hints emit
- `uncensorInputOptions`, `convertMentions`

## Output

`Promise<void>` — appends to `contextItems` in place. Each appended item
is tagged `DIALOGUE_HISTORY` (default in `pushDialogueHistoryContextItem`)
or `CONTEXT_NOTE_INJECTION` for the injected note.

## Side effects

**Per message:**

- **Role mapping** computed from author type and impersonation flags.
- **Persona user block filtering** happens before this stage in
  `buildSimplifiedHistory`: active `persona_user_blocks` with `block_type =
  'block'` remove that user's recent live dialogue turns/direct media for the
  active persona and suppress reply annotations quoting those filtered
  messages. Memories, reminders, documents, and generic references from other
  users are not redacted.
- **Media-window calculation** — `effectiveMediaWindow = min(requested,
  message_fetch_limit)`; `mediaWindowCutoff = totalMessages - effectiveMediaWindow`.
- **Media descriptor emission**:
  - Filters `MEDIA_IMAGE_MESSAGE_LIMIT` (env, default 3) most-recent
    messages that carry "counted" images (non-emoji, non-sticker).
  - Drops duplicate images that recur in a later in-window message
    (`duplicateImageLastIndex` lookup).
  - Adds per-message `mediaDescriptors` carrying URI, MIME type,
    registered media ID, media-window membership, and `extendBy` for older
    out-of-window media. Custom emoji images are not descriptors; they remain
    text via emoji normalization.
- **Budget-only media notes**:
  - Rendered-image-limit skips emit a capability-neutral
    `[System: N image(s) omitted due to rendered-image limit]` note.
  - Duplicate images are dropped with logging only.
  - Capability-specific notices are not emitted here. `resolveMediaForModel`
    emits `{image_analysis_tool}` guidance, plain blind-model notices, and
    `increase_media_context` hints per generation attempt.
  - Intentional deviation from the pre-refactor behavior: out-of-window media
    now produces a plain "outside the current media context window and cannot
    be viewed" notice even for blind models. Blind notices still include the
    `media_N` handle so non-vision tools that accept media references (for
    example img2img/inpaint/image-to-video) can target the source message.
    Previously that blind + out-of-window combination emitted no line, which
    hid the fact that media existed at all.
- **Media attribution hint** — when media is referenced from a reply or
  forward, `[System: These images (Media IDs: X, Y) were sent by Z]`.
- **Text part assembly** — `${authorName}: ${content}` prefix, mention
  conversion, humanizer transform (model items at HEAVY+), uncensor
  input transforms.
- **Copied-render webhook reconstruction** — webhook usernames formatted as
  `SourcePersona (target)` are attributed to `SourcePersona` for role mapping,
  self-reply ownership, and reply routing, while `authorName` preserves the full
  visible label. The resulting dialogue line stays reversible as
  `SourcePersona (target): content`, so the model can repeat the same syntax.
- **Sender metadata** — dialogue items carry hidden `sender` metadata
  (`personaName` when available, otherwise `authorName`) so strict-chat
  media relocation can attribute model-role images without parsing the
  visible `{Name}:` text prefix.
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
  images get a budget note instead of descriptors.
- Duplicate images don't appear twice; the *last* occurrence in the
  window is the one that renders.
- `mediaDescriptors` remain capability-neutral. They are not provider-ready
  image/video parts until `resolveMediaForModel(...)` runs for a concrete
  attempt model.
- Context note injects exactly once per build — either at the depth
  target or at the very end if history is shorter.
- `messageIdMap.register(...)` is called for every media reference the
  LLM might ask about after resolution (so `increase_media_context`,
  `image_analysis_tool`, and media-reference tools have stable IDs).

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `MEDIA_IMAGE_MESSAGE_LIMIT` | `3` | Max in-window messages that render counted images |
| `PERSONA_USER_BLOCK_CACHE_TTL_SECONDS` | `60` | TTL for active persona user block lookups |

| Source | Field | Effect |
|---|---|---|
| `tomoriConfig` | `message_fetch_limit` | Caps media window |
| `tomoriConfig` | `humanizer_degree` | HEAVY+ applies humanizer to model items |
| `tomoriConfig` | `context_note`, `context_note_depth` | Context-note injection |
| `tomoriConfig` | `uncensor_unicode_space_enabled`, `uncensor_sanitize_enabled` | Drives uncensor transforms |
| `tomoriState` | `context_note`, `context_note_depth` | Persona-level override of tomoriConfig values |
| Memory pressure | `memoryGuard.getMediaWindow()` | Dynamic media-window shrink under load |

## Extension points

This is the **biggest contributor by complexity**, with multiple
plugin-relevant seams:

| Surface | Plugin-relevance |
|---|---|
| Media-window policy (`effectiveMediaWindow`, `maxExtendBy`) | Coupled to `memoryGuard` + `message_fetch_limit`. A plugin adding "always include all media" or "per-channel media budget" would extend the window calculation. |
| Media descriptor shape | New media kinds should add descriptor fields here and resolution behavior in `mediaResolver.ts`. |
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
