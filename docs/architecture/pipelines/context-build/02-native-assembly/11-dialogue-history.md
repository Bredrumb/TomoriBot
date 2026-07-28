---
title: "02.11: Dialogue History"
---

The actual recent message history as alternating user/model items. The
bottom of the prompt, immediately above the LLM's next response.

**File:** `src/utils/text/context/dialogueHistory.ts:25-157`

## Mission

Iterate `simplifiedMessageHistory` (built by the chat pipeline's
`buildSimplifiedHistory`, which has **already collapsed runs of consecutive
same-author pure-text messages within the same server-calendar day** into single
entries; Better Time Awareness keeps cross-day messages separate) and append one or more
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
   history. The default-off verbatim tool-calling workaround adds a separate
   depth-3 system note when enabled and the effective LLM has tools.
4. **Better Time Awareness** — when enabled, inject a reunion note at
   `TIME_AWARENESS_NOTE_DEPTH` for returning people (the triggerer and/or others
   present in the window) and date separators at server-calendar-day boundaries.

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
- `reunionNotes: string[]` — raw note bodies precomputed by the chat pipeline after
  the batched stats read; this stage wraps them in `[System: ...]` like every other note
- `dateSpacerTemplate` — pre-expanded once by `nativeBuilder`; `null` disables spacers

## Output

`Promise<void>` — appends to `contextItems` in place. Each appended item
is tagged `DIALOGUE_HISTORY` (default in `pushDialogueHistoryContextItem`)
or `CONTEXT_NOTE_INJECTION` for the injected note.

## Side effects

**Per message:**

- **Role mapping** computed from author type and impersonation flags.
- **Persona user block handling** happens before this stage in
  `buildSimplifiedHistory`: active `persona_user_blocks` with `block_type =
  'block'` replace that user's recent live dialogue turns/direct media with a
  single `[System: ...]` block notice for the active persona (consecutive
  messages from the same blocked user collapse into one notice) and suppress
  reply annotations quoting those messages. The blocked user is still excluded
  from tool-intent scanning, voice transcription, and sprite priming
  (`visibleRawMessages`). Memories, reminders, documents, and generic
  references from other users are not redacted.
- **Media-window calculation** — `effectiveMediaWindow = min(requested,
  message_fetch_limit)`; `mediaWindowCutoff = totalMessages - effectiveMediaWindow`.
- **Media descriptor emission**:
  - Filters `MEDIA_IMAGE_MESSAGE_LIMIT` (env, default 3) most-recent
    messages that carry "counted" images (non-emoji, non-sticker).
  - Drops duplicate images that recur in a later in-window message
    (`duplicateImageLastIndex` lookup).
  - Adds per-message `mediaDescriptors` carrying URI, MIME type,
    a source-aware registered media ID, media-window membership, and `extendBy` for older
    out-of-window media. Custom emoji images are not descriptors; they remain
    text via emoji normalization.
  - Media copied from a directly replied-to message registers that original
    message as its media ID owner. This lets image generation, image analysis,
    and image-to-video tools fetch the referenced bytes even though the
    descriptor appears on the text-only reply's dialogue entry. As a defensive
    fallback, the shared image resolver also follows one direct reply hop when
    a tool is given the wrapper message ID.
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
- **Media attribution hint** — `[System: These images (Media IDs: X, Y) were
  sent by Z]`, with dedicated wording for reply-referenced media ("included in
  the message being replied to") and forwarded media ("attached to the
  forwarded message described above"). Reply media registers the referenced
  message that owns the bytes, while forwarded media registers the forward
  *wrapper's* own message ID as its media ID: the original message lives in the
  source channel, so only the wrapper ID is resolvable by media-ID tools
  fetching from the current channel (the shared image extractor scans the
  wrapper's `messageSnapshots` to find the media).
- **Nested forwards (a forward of a forward)** — Discord's `message_snapshots`
  payload is non-recursive, so re-forwarding an already-forwarded message
  delivers an *empty* snapshot: no text, no attachments, no embeds. The wrapper's
  own `reference` survives and points at the intermediate forward, so
  `resolveForwardChain` (`utils/discord/forwardChain.ts`) re-fetches that message
  to reach the next snapshot level, repeating up to `FORWARD_CHAIN_MAX_DEPTH`
  hops (default 3, each hop costing one message fetch). An empty snapshot is a
  reliable nested-forward signal because Discord rejects genuinely empty
  messages. When the origin cannot be re-fetched — unreadable channel, deleted
  message, depth exhausted — the block degrades to an explicit "was itself a
  forward … contents cannot be seen" notice and registers no media ID, rather
  than emitting an empty forward block that would invite the model to invent one.
  Both `buildForwardContext` and the shared image extractor resolve the chain, so
  a registered media ID always re-resolves to the same bytes.
- **Text part assembly** — `${authorName}: ${content}` prefix, mention
  conversion, humanizer transform (model items at HEAVY+), uncensor
  input transforms.
- **Identity macros are preserved in message bodies** — this stage is the only
  `convertMentions` caller that handles raw prose it did not author, so it splits
  the conversion in two: the **author label** is converted with
  `identityMacroMode: "resolve"` (it names the turn's owner), and the **joined
  line** is then converted with `identityMacroMode: "preserve"`. Mentions,
  channel links, and roles still resolve in the body; only `{bot}` / `{char}` /
  `{user}` stay literal. Two reasons:
  - On a model-role line `authorName` *is* the persona label and `botName` *is*
    the persona nickname, so resolving would collapse **both** macros onto the
    same persona name — turning `{bot} greets {user}` into `Tomori greets Tomori`.
  - A message body legitimately contains macros whenever a user asks the persona
    to draft a preset or system prompt; rewriting them corrupts the draft the
    user is iterating on.

  Every other `convertMentions` caller (prompt items, server info/memories/
  emojis/stickers, participants, sample dialogues, preset nodes, and the
  memory/thread/cross-channel tools) authors its own text and keeps the default
  `"resolve"` mode.
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
- **Date spacers** — before a message whose server-calendar day differs from
  the preceding timestamped message, emits an absolute-date `[System: ...]`
  separator. Messages without `createdAt` neither create nor advance a boundary.
  The `{message_metadata_tool}` macro is expanded once before this loop, so the
  emitted hint names `reveal_message_metadata` without introducing async work per message.

**Context-note injection (once per build):**

- If `context_note` is set, computes `contextNoteTargetIndex = max(0,
  totalMessages - context_note_depth)`.
- Injects `[System: ${context_note}]` as a `user`-role item with tag
  `CONTEXT_NOTE_INJECTION` at the target index (or at the end if the
  history is shorter than the depth).
- If `tomoriConfig.verbatim_tool_calling_enabled` is true and
  `tomoriState.llm.has_tools` is true, injects one additional
  `CONTEXT_NOTE_INJECTION` at depth 3. This nudge tells Custom endpoint models
  how to emit the strict code-span/fenced verbatim tool-call syntax. The
  matching tool *schemas* are dumped earlier in the prompt by stage 07b
  ([`07b-verbatim-tool-definitions.md`](/architecture/pipelines/context-build/02-native-assembly/07b-verbatim-tool-definitions/)),
  gated by the same predicate.
- Producer-supplied reunion notes reuse the same `activeNotes` mechanism at
  `TIME_AWARENESS_NOTE_DEPTH` (default 3). Several returning people collapse into
  **one** system block joined by newlines rather than stacking blocks. The chat
  pipeline omits them for user impersonation and when no internal user id is
  available. First-time and returning-user variants include an "if you haven't
  already" social nudge, which encourages a warm question without repeating it
  throughout the grace window.

**Who gets a note.** `reunionPresence.resolveReunionNotes` resolves the triggerer
plus the distinct human authors of the last `TIME_AWARENESS_PRESENCE_WINDOW`
messages (bridged/synthetic authors are skipped — presence never registers a user
row), then emits at most `TIME_AWARENESS_MAX_REUNION_NOTES` notes, triggerer first.
Only the **triggerer** can receive the first-timer welcome; a bystander with no
history is a stranger, not someone to introduce yourself to. Bystanders get the
"around again" phrasing instead of "talking to you again".

**Presence is the clock, not message volume.** `presence_seen` is recorded once per
turn for every person in that candidate set — in DMs and on turns someone else
triggered. This is deliberately separate from the `message_sent` telemetry metric,
whose recording rules exist for leaderboard correctness (guild-only, successful turns,
triggerer only) and would otherwise silently drive persona behavior.

**The clock is a two-phase protocol**, both halves in `@/utils/chat/reunionPresence`:

1. `resolveReunionNotes` at **context build** reads the clocks and returns the notes
   plus a `ReunionPresenceScope` (server, lineage, user ids), carried on
   `ChatTurnContext.reunionPresence`.
2. `recordReunionPresence` at **post-turn** commits that scope as `presence_seen`.

The split is load-bearing in both directions. Writing during phase 1 would let the
read see the turn's own tick, so a turn would consume the grace window it just
opened. It would also tick turns that never answered — and a failed or silent turn
delivered no acknowledgment, so ticking it would burn today's grace and reset
tomorrow's day gap, permanently losing a reunion the user never received. Unlike
`recordUsageStats`, phase 2 does **not** skip DMs.

**Reunion grace is stateless.** `StatRepository.getUsersPersonaReunionInfo` reads,
per user, the last activity timestamp from buckets before `CURRENT_DATE` and today's
persisted `presence_seen` count for the `(user, persona lineage)` tuple across all
servers. The gap lookup spans `presence_seen` **and** `message_sent` so relationships
predating the presence metric keep their history. Today's writes cannot erase the
detected gap; the note expires when today's presence count reaches
`TIME_AWARENESS_GRACE_TRIGGERS`, and the next DB day resets it naturally. The read
happens in a different phase from the turn's own presence write, so a turn cannot
consume the grace window it just opened, and a turn that produced no response
records nothing at all. A failed read returns `null` and injects nothing, rather than
reading as "no history". With `STAT_TRACKING_ENABLED=false` the feature disables
itself for the same reason.

| Injection | Calendar timezone | Reason |
|---|---|---|
| Reunion note | Personal → server → UTC | Describes the returning user's lived days |
| Date spacer | Server → UTC | Represents a shared channel history boundary |

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
- Verbatim tool-calling nudge injection is opt-in and independent of
  persona/channel/global context notes; adding the workaround must not suppress
  the global context-note fallback.
- Capability OFF passes neither a reunion note nor a spacer template, preserving
  the pre-feature dialogue context for both injections. It also records no
  `presence_seen` ticks, so a disabled server writes nothing.
- Reunion notes inject at most once per build regardless of how many people are
  returning — the bodies are joined into a single `[System: ...]` block.
- `messageIdMap.register(...)` is called for every media reference the
  LLM might ask about after resolution (so `increase_media_context`,
  `image_analysis_tool`, and media-reference tools have stable IDs).

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `MEDIA_IMAGE_MESSAGE_LIMIT` | `3` | Max in-window messages that render counted images |
| `PERSONA_USER_BLOCK_CACHE_TTL_SECONDS` | `60` | TTL for active persona user block lookups |
| `TIME_AWARENESS_REUNION_DAYS` | `7` | Minimum personal-calendar-day reunion gap |
| `TIME_AWARENESS_GRACE_TRIGGERS` | `3` | Persisted same-day presence ticks that retain a reunion note |
| `TIME_AWARENESS_NOTE_DEPTH` | `3` | Messages from the end where reunion notes inject |
| `TIME_AWARENESS_PRESENCE_WINDOW` | `20` | Trailing messages that count as "present in the conversation" |
| `TIME_AWARENESS_MAX_REUNION_NOTES` | `2` | Cap on reunion notes injected in one turn |
| `STAT_TRACKING_ENABLED` | `true` | Write side of the presence clock; `false` disables reunion notes |

| Source | Field | Effect |
|---|---|---|
| `tomoriConfig` | `message_fetch_limit` | Caps media window |
| `tomoriConfig` | `humanizer_degree` | HEAVY+ applies humanizer to model items |
| `tomoriConfig` | `context_note`, `context_note_depth` | Context-note injection |
| `tomoriConfig` | `verbatim_tool_calling_enabled` | Enables the depth-3 verbatim tool-calling nudge when the effective LLM has tools |
| `tomoriConfig` | `time_awareness_enabled` | Opt-out gate for reunion notes and date spacers |
| `tomoriConfig` | `timezone_offset` | Server-calendar boundary for date spacers |
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
  [native-assembly README](/architecture/pipelines/context-build/02-native-assembly/#shared-helpers-used-across-contributors).
- Message-ID map: → no dedicated doc; `messageIdMap.ts` helper only
- Image-analysis tool: tool registry (→ [tool-loop pipeline](../../../tool-loop/))
- `increase_media_context` tool: tool registry (same source)
- Memory-pressure media-window shrinking:
  → no dedicated doc; `src/utils/security/rateLimiter.ts` helper only
- Humanizer transform: → `src/utils/text/processors/formatters.ts` helper
- Uncensor transform: → `src/utils/text/uncensor.ts` helper
