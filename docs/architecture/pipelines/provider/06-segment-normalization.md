---
title: "06: Segment Normalization"
---

Normalizes a flushed text segment — capturing render modifiers, cleaning LLM output artifacts, resolving Discord mentions, enforcing the speaker guard, and managing output prefill — before handing it to stage 07 for Discord delivery.

**File:** `src/utils/discord/stream/segmentProcessor.ts:21-233`

## Mission

`StreamSegmentProcessor.sendBufferSegment()` receives a raw, flushed text segment from stage 05
and a `BufferedDeliveryBoundary` label describing why the flush occurred. It applies a pipeline
of transformations to produce clean, Discord-safe text, then delegates to
`StreamMessageDelivery.sendSegment()` (stage 07).

The transformation pipeline runs in this order:

1. **Orphan-punctuation guard** — segments consisting entirely of punctuation (e.g., a lone `…`
   or `...`) are held in `state.pendingOrphanPunctuation` and prepended to the next non-empty
   segment instead of being sent standalone, preventing jarring single-character messages.

2. **Render-modifier capture** — before normal own-name cleanup runs, an active persona line
   that starts as `SourcePersona (modifier): text` is parsed. The modifier resolves against the
   active persona's `persona_sprites` first; a sprite match sends stage 07 an identity override
   and the sprite avatar, plus a `spriteRecord` so the message → sprite-label mapping is persisted
   after the send (`persona_sprite_messages`). Ordinary sprites use the **clean username
   `SourcePersona`** (no `(sprite)` suffix in Discord); identity sprites (`is_identity = true`)
   use the **flipped username `sprite (SourcePersona)`** shown directly in Discord, DID-alter
   style. The accumulated-text prefix keeps the decorated
   `SourcePersona (sprite): ` label so the model still sees its own sprite usage. If the sprite
   row matches but its image cannot be loaded, the parenthetical modifier is stripped and the
   line is delivered as normal source-persona output without trying copied identity. If no
   sprite matches, the modifier falls back to copied-render resolution against known personas
   and users in current context; copied matches use the **flipped** webhook username
   `target (SourcePersona)` (impersonated name first for the in-chat disguise) while the
   accumulated-text prefix stays source-first (`SourcePersona (target): `) for the model.
   Unknown or ambiguous copied targets are stripped and delivered as
   normal output. This path is line-scoped across stream splits and ignored inside code blocks
   and list-like starts.

3. **Opening-label leak guard** (`matchLeadingSpeakerLeak` + `parseLeadingGenericSpeakerLabel`) —
   runs only at response start (nothing accumulated or sent yet) on segments the render-modifier
   capture refused, and **regardless of `llm_stop_speaker_pattern_enabled`**. It catches the model
   cross-breeding history label formats into a foreign speaker label the other guards all miss:
   the decorated grammar with a non-persona name (`Chris (smug): …` — any name outside the active
   persona/aliases using the parenthetical form is unambiguously a leak), or a plain
   `Name:` opening where `Name` is a known conversation participant (another persona, or a user
   from `KNOWLEDGE_USERS_IN_CONVERSATION` via `collectKnownSpeakerNames`). Prose openings
   (`Note:`, `TL;DR:`), list items, blockquotes, headings, code fences, and bracketed starts
   (links/mentions/timestamps) never fire. On detection:
   - **Retry budget remaining** (`context.emptyResponseRetryCount < MAX_EMPTY_RESPONSE_RETRIES`,
     threaded from `incoming.retryCount` through `StreamingContext` → `buildStreamContext`): the
     attempt is discarded via `requestStop(channelId, "speaker_guard")` with nothing sent, which
     classifies the turn as `empty_response` so `maybeScheduleEmptyResponseRetry` regenerates it
     with the "reply only as {persona}" directive injected.
   - **Budget exhausted**: the leaked label is stripped and the body delivered as the active
     persona — a stripped reply beats silence.
   Deliberate impersonation (`Tomori (Chris): …`) is unaffected: the render-modifier capture
   consumes it before this guard runs.

4. **Custom emoji deduplication** (`filterDuplicateCustomEmojis`) — strips any custom emoji
   shortcode (`:name:`) from the segment if the same emoji was already used in a recent bot
   message (lookback window controlled by `EMOJI_UNIQUE_LOOKBACK`, default 5). History is stored
   in converted Discord format (`<:name:id>`), so the filter normalises that form to shortcodes
   before comparison.

5. **LLM output cleaning** (`cleanLLMOutput`) — strips the bot's own name-prefix if the model
   writes it (e.g., `"Tomori: hello"` → `"hello"`), converts `:name:` shortcodes to full Discord
   custom emoji syntax (`<:name:id>`) using the server emoji list, strips unresolved shortcodes by
   default, optionally preserves unresolved shortcodes when
   `EMOJI_PRESERVE_UNRESOLVED_SHORTCODES=true`, removes all emoji attempts when
   `emojiUsageEnabled` is `false`, and optionally uncensors Unicode space characters and sanitizes
   encoded content. The own-name strip also peels a leaked *multi-name* opening label chain when a
   persona answers to more than one name — e.g. the bundled "Shy Tomori (Lilya)" persona prefixes
   `"Tomori: Lilya: …"` (lore/default name + webhook nickname). `textConfig.botNameAliases`
   (`collectPersonaNameAliases`: `DEFAULT_BOTNAME` + the persona's `trigger_words`) supplies those
   extra names; the leaked-preamble and later-boundary passes stay scoped to the active name so
   mid-prose `"Name:"` usages are preserved.

   The opening chain also matches **identity-macro labels** — `{bot}:`, `{{char}}:`, `{user}:` and
   their bold forms — because the model sometimes labels its turn with the template syntax instead
   of the resolved name. Like aliases, macros widen the *opening-chain* match only. Identity macros
   elsewhere in the response are deliberately delivered to Discord verbatim: a persona asked to
   draft a preset or system prompt is *supposed* to emit `{{char}}: …` sample dialogue, and that
   draft must survive both the send and its round-trip back through dialogue history (see
   [`11-dialogue-history.md`](/architecture/pipelines/context-build/02-native-assembly/11-dialogue-history/)).
   A response opening with a code fence never matches the leading pattern, so fenced drafts are
   safe regardless.

6. **Guild mention resolution** (`resolveGuildMentions`) — converts name-based handle references
   in the text (e.g., `@alice`) to Discord snowflake mentions (`<@1234567890>`) using the mention
   map built at stream init from `ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION` items.

7. **Output prefill strip/inject** (`stripPrefillFromSegment` / `applyPrefillToSegment`) — when
   `context.outputPrefill` is set (hybrid prefix streaming for NAI), the first segment strips the
   model-echoed prefill from its start and the cleaned prefill is prepended to the outgoing
   segment (injected exactly once; subsequent segments are unmodified).

8. **Speaker guard** (`truncateBeforeGenericSpeakerLine`) — if `llm_stop_speaker_pattern_enabled`
   is true and a speaker-label line (e.g., `User:`) appears in the segment, the text is truncated
   before it and `requestStop(channelId, "speaker_guard")` is queued. The segment is sent with
   the truncated content; the stop is processed by the stage 04 orchestrator on the next
   iteration. Active render-modifier labels such as `Ren (mad):` or `Ren (target):` are explicitly
   allowed through both the provider-level fallback guard and this segment-level guard so they can
   be resolved instead of treated as foreign speaker turns. This guard skips the response's opening
   line (`includeStart` only turns on once text has accumulated) — that position is covered by the
   always-on opening-label leak guard in step 3.

9. **Markdown table detection** (`extractMarkdownTableSegments`) — if the segment contains a
   rendered Markdown table, the segment is split into text parts and table parts. Table parts are
   routed to `StreamMessageDelivery.sendRenderedMarkdownTable()` which renders the table to a PNG
   via `renderMarkdownTableToPng()` and sends it as a Discord file attachment.

## Input

- `segment: string` — raw text segment flushed from `state.buffer` by stage 05.
- `boundary: BufferedDeliveryBoundary | undefined` — flush reason: `"code_open"`, `"code_close"`,
  `"newline"`, `"period"`, `"overflow"`, `"attachment"`, `"final"`, `"tool_call"`.
- `textConfig: TextProcessingConfig` — mention map, emoji config, speaker name set, persona name
  aliases (`botNameAliases`), delivery mode.
- `typingConfig: TypingSimulationConfig` — forwarded to stage 07.
- `context: StreamContext` — channel ID (stop requests), `tomoriState.config`, prefill state.
- `state: StreamState` — orphan punctuation state, prefill matching state, accumulated text.

## Output

No return value. The normalized segment (or its table-split parts) is forwarded to stage 07.

## Side effects

- **`state.pendingOrphanPunctuation`** — may be set (hold) or cleared (prepend to segment).
- **`state.prefillMatched`** / **`state.prefillInjected`** / **`state.prefillMatchFailed`** —
  updated as prefill stripping/injection progresses.
- **`state.activeRenderModifier`** — tracks the active render-modifier identity override so period
  or chunk splits keep using the sprite/copied identity. Expiry differs by modifier kind:
  - **Copied identities** (impersonating a user / another persona — no `spriteRecord`) expire at the
    end of their line (a newline boundary or an embedded `\n`), so the bot reverts to itself on the
    next line unless it re-declares the label.
  - **Persona sprites** (regular and `is_identity`, carrying a `spriteRecord`) persist across
    newlines and only switch when a *different* `SourcePersona (sprite):` label appears — an
    expression is a sustained visual state, e.g. `"Touko (mad): ARGGHHH!\nFine... I'll do it"` keeps
    the `mad` sprite for the second line.
- **`state.lastDeliveredSpriteKey`** / **`state.spriteGroupParity`** — track the last non-identity
  sprite delivered and a toggle flipped on each sprite change. The toggle decides whether the sprite
  uses the clean persona name (`false`) or the decorated `Persona (sprite)` name (`true`). Discord
  groups consecutive webhook messages by `webhook_id` + `username` (ignoring the avatar) and strips
  zero-width/blank chars from usernames, so a visibly distinct name is the only reliable break:
  adjacent different-sprite messages alternate clean/decorated and never match, forcing Discord to
  render each avatar instead of grouping them under the first one, while same-sprite runs keep an
  identical username and still group. Identity sprites are excluded (their decorated name is already
  distinct).
- **`requestStop(channelId, "speaker_guard")`** — queued if the speaker guard fires; the stop
  is consumed by the stage 04 orchestrator on the next loop iteration. The opening-label leak
  guard (step 3) queues the same stop with nothing sent, which the state machine classifies as
  `empty_response` / `speaker_guard` so post-turn effects schedule a regeneration.
- **PNG attachment** — when a Markdown table is detected and rendered successfully, a Discord file
  attachment is sent and the table's raw Markdown is cached in `markdownTableCache` (keyed by
  message ID) for subsequent reference.
- **`prepareOutputPrefill()`** (companion method) — called once before stage 02 begins (from
  `executeStream` setup). Resolves the prefill string through the same mention/cleaning pipeline
  and stores it on `state.prefillTarget`.

## Invariants

After this stage (per segment):

- If the cleaned segment is empty (e.g., contained only the bot's name prefix), stage 07 is not
  called — no empty Discord messages are sent.
- If the speaker guard fired, `state` contains the queued stop and the segment sent to Discord is
  the truncated pre-guard portion only.
- Custom emoji deduplication was applied — no custom emoji that appeared in a recent bot message
  (within the lookback window) is present in the segment as delivered.

## Extension points

| Surface | Plugin-relevance |
|---|---|
| `cleanLLMOutput()` | `src/utils/text/processors/llmOutputProcessor.ts`. Internal — LLM output normalization is tightly coupled to TomoriBot's persona-name conventions and Discord formatting rules. The `emojiUsageEnabled` and `uncensor_*` DB config flags are the configuration surfaces. |
| `resolveGuildMentions()` | `src/utils/discord/stream/mentionResolver.ts`. Internal — mention resolution uses the static mention map built at stream-init from conversation context. A plugin adding custom handle → user-ID mappings would modify the `KNOWLEDGE_USERS_IN_CONVERSATION` contributor in the context-build pipeline, not this stage. Takes `(text, channel, mentionMap, mentionIdSet, personaMentionMap?)` so it can be shared by non-stream callers (see `cleanToolReplyText`, below). Known persona handles stay as bare `@trigger` text after Discord user mentions are resolved. |
| `cleanToolReplyText()` | `src/utils/discord/toolReplyText.ts`. Internal — applies this stage's `filterDuplicateCustomEmojis` → `cleanLLMOutput` → `resolveGuildMentions` chain to tool-authored reply text (e.g. the `reply` action of `interact_with_recent_message`), which bypasses the streaming segment path. Keeps tool replies and normal replies rendering identically (emoji, Discord `@mention` resolution, and persona `@trigger` preservation). A plugin adding another tool that sends Tomori-authored Discord text should route it through this helper. |
| `filterDuplicateCustomEmojis()` | `src/utils/text/emojiPenalty.ts`. Internal — emoji deduplication heuristic; no plugin-relevant seam. |
| `extractMarkdownTableSegments()` + `renderMarkdownTableToPng()` | `src/utils/text/markdownTable.ts` + `src/utils/image/markdownTableRenderer.ts`. The table renderer path is the only place in the stream pipeline where image attachments are sent during streaming (as opposed to tool results). **A plugin adding other attachment types mid-stream would extend here.** → plugin plan candidate |
| Speaker guard (`truncateBeforeGenericSpeakerLine`) | `src/utils/text/processors/llmOutputProcessor.ts`. Internal — speaker-label detection runs in both the adapter (stage 02) and the segment processor. The `llm_stop_speaker_pattern_enabled` DB flag is the configuration surface. |
| Opening-label leak guard (`parseLeadingGenericSpeakerLabel` + `collectKnownSpeakerNames`) | `src/utils/discord/renderModifierParser.ts` + `src/utils/discord/renderModifierResolver.ts`. Internal — always-on response-start companion to the speaker guard; no configuration surface by design (the shapes it fires on are unambiguous leaks). |
| Output prefill (`context.outputPrefill`) | Internal — NAI-specific hybrid prefix streaming mechanism; not a general extension point. |

## Configuration

| Source | Key / Env var | Default | Purpose |
|---|---|---|---|
| `TomoriState.config` | `llm_stop_speaker_pattern_enabled` | `false` | Activates speaker-guard truncation in this stage |
| `TomoriState.config` | `uncensor_unicode_space_enabled` | `false` | Replaces Unicode 0x2800 braille blank with regular space in output |
| `TomoriState.config` | `uncensor_sanitize_enabled` | `false` | Strips encoded characters that bypass content filters |
| `StreamConfig` | `emojiUsageEnabled` | from `TomoriState` | Passed through to `cleanLLMOutput`; controls custom emoji presence |
| Env var | `EMOJI_PRESERVE_UNRESOLVED_SHORTCODES` | `false` | When true, unresolved `:name:` emoji shortcodes are sent as literal text instead of being stripped |

## Related docs

- Stage 05 (produces the segment consumed here): → [`05-buffer-management.md`](05-buffer-management.md)
- Stage 07 (receives the normalized segment from here): → [`07-discord-delivery.md`](07-discord-delivery.md)
- Mention resolution: `src/utils/discord/stream/mentionResolver.ts`
- LLM output processor: `src/utils/text/processors/llmOutputProcessor.ts`
- Markdown table renderer: `src/utils/image/markdownTableRenderer.ts`
- Emoji penalty: `src/utils/text/emojiPenalty.ts`
- `TextProcessingConfig` type: `src/types/stream/types.ts:98`
- `BufferedDeliveryBoundary` type: `src/utils/discord/stream/messageDelivery.ts:15`
