---
title: "06.1: Build Context"
---

Assemble the LLM-visible prompt for one persona turn.

**File:** `src/utils/chat/contextPipeline.ts:49-193`

## Mission

Build the `ChatTurnContext` closure carried through the rest of the per-turn
loop. Fetch and simplify recent message history, hydrate per-message
annotations (reply/reaction/forward/media/embed), load emoji/sticker assets,
delegate to the **context-build pipeline** for the LLM-shaped prompt
assembly, then append tail directives. Returns the full `ChatTurnContext` —
the closure that stages 02–04 read and mutate.

This stage is the **thin chat-side wrapper** around a much larger inner
pipeline. The heavy lifting (mentions, memories, RAG, persona prompt,
participants, dialogue history) lives in [context-build](../../context-build/).

## Input

`ChatTurn` (one element from `ChatTurnPlan.turns`, produced by stage 05). See
`src/utils/chat/types.ts:141-171`.

## Output

`ChatTurnContext` — the per-turn closure. See `src/utils/chat/types.ts:173-212`.

Key fields populated here:

- `contextItems: StructuredContextItem[]` — the LLM-shaped prompt, including
  tail directives.
- `simplifiedMessages: SimplifiedMessageForContext[]` — the message-history
  digest used both for the LLM and for post-turn memory capture.
- `streamingContext: StreamingContext` — per-turn flags consumed by the
  stream orchestrator and tool layer.
- `messageIdMap: MessageIdMap` — translation table between Discord message
  IDs and LLM-visible compact IDs (used for reply targeting).
- `emojiStrings`, `loadedEmojis`, `loadedStickers` — persona assets.
- Carried trigger metadata (`triggererName`, channel name/description, etc.).

## Side effects

- **Message-history fetch** — `channel.messages.fetch({ limit })` retrieves up
  to `message_fetch_limit` recent messages from Discord.
- **Voice-transcript pre-hydration** — for historical audio messages not in
  chat mode, runs STT synchronously *before* the simplify loop so cache
  lookups inside `simplifyMessage` are non-async. Writes results to the
  voice-transcript cache.
- **Consecutive same-author merge** — after simplifying each message, the loop
  collapses it into the previous entry when (1) the effective `authorId`
  matches, (2) the debug (`$:`)/normal kind matches (a debug message never
  merges with a normal one even though they share an authorId), and (3)
  **neither side carries media** (media forces a separate turn so per-message
  media IDs stay unambiguous). Merged entries record `combinedMessageIds`,
  `individualContents`, and `combinedCreatedAts` so `reveal_message_metadata`
  can still surface one `ref_N` + timestamp per original message.
- **Persona-asset cache load** — `loadEmojiStickerCache(...)` may hit Discord
  if the cache is cold.
- **Reply-target fetch** — `channel.messages.fetch(referenceMessageId)` if
  the message references one that's not in cache.
- **Reset/compact-refresh detection** — scans message embeds for `"reset"` or
  `"compact_refresh"` markers and slices history at the marker.
- **Reminder injection** — if the incoming carries `reminderData`, injects a
  synthetic `[System: …]` message into `simplifiedMessages` so the LLM sees
  the reminder context.
- **Media descriptor capture** — this stage no longer decides whether the
  answering model can see images or videos. `buildContext` records
  capability-neutral `mediaDescriptors` on dialogue items, plus budget-only
  notices such as rendered-image-limit skips. The per-attempt generation stage
  resolves those descriptors against the routed attempt model, including
  personal-provider routing, OpenRouter live capability overrides, and fallback
  attempts.
- **Impersonation identity resolution** — if `isUserImpersonation`, fetches
  the impersonated user's nickname/avatar via `resolveImpersonatedIdentity`.

## Invariants

After this stage runs:

- `contextItems` has tail directives appended in the correct priority order:
  emoji penalty (lower priority, inserted before the latest dialogue pair),
  stop/reasoning/manual directives (combined into one user message at the
  tail), queued-reply directive, uncensor directive, and manual-prefill
  model message (last).
- `simplifiedMessages` excludes messages from privacy-FULL users.
- `simplifiedMessages` collapses runs of consecutive same-author pure-text
  messages into a single entry (see the merge rule above); media-bearing or
  debug-boundary messages remain their own entries.
- The `messageIdMap` is populated with every message ID the LLM will see.
- `streamingContext.explicitLongTermMemoryIntent` reflects whether the
  triggering message mentions long-term memory phrasing.
- `streamingContext.replyNoticeState` is initialized to
  `{ attempted: false, sent: false }` when `incoming.isFromQueue` is true
  and the turn's persona is an alter. This is the only place where
  `replyNoticeState` is set; without it the alter "Replying to…" embed in
  stage 07 is suppressed (the presence of the object is the enable-switch,
  not its field values).

## Extension points

This stage is **a coordinator over many extension-relevant helpers**:

| Helper | File | Plugin-relevance |
|---|---|---|
| `buildContext` | `utils/text/contextBuilder.ts` | The context-build pipeline's public API — the main extension surface for memories, RAG, persona prompt assembly |
| `simplifyMessage` + sub-helpers (`withReplyContext`, `withReactionContext`, `buildForwardContext`) | this file | Per-message annotation pipeline; new annotation types hook here |
| `processEmbedsFromMessage` | `contextEmbeds.ts` | Embed classification + content extraction; new embed type plugins hook here |
| `appendSupportedMediaFromMessage`, `appendStickersFromMessage`, etc. | `contextMedia.ts` | Media attachment extractors; new media kinds hook here |
| `buildReactionContextAnnotation`, `buildReplyReferenceContextAnnotation` | `contextAnnotations.ts` | Annotation builders; reaction/reply formatting hooks here |
| `appendTailDirectives` | this file | Tail-directive assembly; new directive kinds insert here |

**The stage itself is a thin coordinator.** Most plugin work for "show the
LLM something different" goes either into the inner context-build pipeline
(memories/RAG/persona) or into one of the per-message helpers above. The
appropriate seam depends on whether the change is per-message
(annotation/media) or per-prompt (directive/persona/memory).

## Related docs

- Inner pipeline: → [context-build](../../context-build/)
- Tail directive priorities: → folded into context-build docs
- Embed classification: → no dedicated doc; `embedClassifier.ts` helper only
- Voice transcripts: → no dedicated doc yet
