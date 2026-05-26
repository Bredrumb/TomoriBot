<!-- ARCH-ALIGNMENT: prereq-phase-5.5d -->

# Stage 06 — `sendBufferSegment`

Normalizes a flushed text segment — cleaning LLM output artifacts, resolving Discord mentions, enforcing the speaker guard, and managing output prefill — before handing it to stage 07 for Discord delivery.

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

2. **Custom emoji deduplication** (`filterDuplicateCustomEmojis`) — removes duplicate server
   custom emoji uses within a single segment to prevent the LLM from spamming a single emoji.

3. **LLM output cleaning** (`cleanLLMOutput`) — strips the bot's own name-prefix if the model
   writes it (e.g., `"Tomori: hello"` → `"hello"`), enforces emoji usage rules (removes or
   preserves emoji based on `emojiUsageEnabled`), and optionally uncensors Unicode space
   characters and sanitizes encoded content.

4. **Guild mention resolution** (`resolveGuildMentions`) — converts name-based handle references
   in the text (e.g., `@alice`) to Discord snowflake mentions (`<@1234567890>`) using the mention
   map built at stream init from `ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION` items.

5. **Output prefill strip/inject** (`stripPrefillFromSegment` / `applyPrefillToSegment`) — when
   `context.outputPrefill` is set (hybrid prefix streaming for NAI), the first segment strips the
   model-echoed prefill from its start and the cleaned prefill is prepended to the outgoing
   segment (injected exactly once; subsequent segments are unmodified).

6. **Speaker guard** (`truncateBeforeGenericSpeakerLine`) — if `llm_stop_speaker_pattern_enabled`
   is true and a speaker-label line (e.g., `User:`) appears in the segment, the text is truncated
   before it and `requestStop(channelId, "speaker_guard")` is queued. The segment is sent with
   the truncated content; the stop is processed by the stage 04 orchestrator on the next
   iteration.

7. **Markdown table detection** (`extractMarkdownTableSegments`) — if the segment contains a
   rendered Markdown table, the segment is split into text parts and table parts. Table parts are
   routed to `StreamMessageDelivery.sendRenderedMarkdownTable()` which renders the table to a PNG
   via `renderMarkdownTableToPng()` and sends it as a Discord file attachment.

## Input

- `segment: string` — raw text segment flushed from `state.buffer` by stage 05.
- `boundary: BufferedDeliveryBoundary | undefined` — flush reason: `"code_open"`, `"code_close"`,
  `"newline"`, `"period"`, `"overflow"`, `"attachment"`, `"final"`, `"tool_call"`.
- `textConfig: TextProcessingConfig` — mention map, emoji config, speaker name set, delivery mode.
- `typingConfig: TypingSimulationConfig` — forwarded to stage 07.
- `context: StreamContext` — channel ID (stop requests), `tomoriState.config`, prefill state.
- `state: StreamState` — orphan punctuation state, prefill matching state, accumulated text.

## Output

No return value. The normalized segment (or its table-split parts) is forwarded to stage 07.

## Side effects

- **`state.pendingOrphanPunctuation`** — may be set (hold) or cleared (prepend to segment).
- **`state.prefillMatched`** / **`state.prefillInjected`** / **`state.prefillMatchFailed`** —
  updated as prefill stripping/injection progresses.
- **`requestStop(channelId, "speaker_guard")`** — queued if the speaker guard fires; the stop
  is consumed by the stage 04 orchestrator on the next loop iteration.
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
- Custom emoji deduplication was applied — no custom emoji appears more than once within the
  segment as delivered.

## Extension points

| Surface | Plugin-relevance |
|---|---|
| `cleanLLMOutput()` | `src/utils/text/processors/llmOutputProcessor.ts`. Internal — LLM output normalization is tightly coupled to TomoriBot's persona-name conventions and Discord formatting rules. The `emojiUsageEnabled` and `uncensor_*` DB config flags are the configuration surfaces. |
| `resolveGuildMentions()` | `src/utils/discord/stream/mentionResolver.ts`. Internal — mention resolution uses the static mention map built at stream-init from conversation context. A plugin adding custom handle → user-ID mappings would modify the `KNOWLEDGE_USERS_IN_CONVERSATION` contributor in the context-build pipeline, not this stage. |
| `filterDuplicateCustomEmojis()` | `src/utils/text/emojiPenalty.ts`. Internal — emoji deduplication heuristic; no plugin-relevant seam. |
| `extractMarkdownTableSegments()` + `renderMarkdownTableToPng()` | `src/utils/text/markdownTable.ts` + `src/utils/image/markdownTableRenderer.ts`. The table renderer path is the only place in the stream pipeline where image attachments are sent during streaming (as opposed to tool results). **A plugin adding other attachment types mid-stream would extend here.** → plugin plan candidate |
| Speaker guard (`truncateBeforeGenericSpeakerLine`) | `src/utils/text/processors/llmOutputProcessor.ts`. Internal — speaker-label detection runs in both the adapter (stage 02) and the segment processor. The `llm_stop_speaker_pattern_enabled` DB flag is the configuration surface. |
| Output prefill (`context.outputPrefill`) | Internal — NAI-specific hybrid prefix streaming mechanism; not a general extension point. |

## Configuration

| Source | Key / Env var | Default | Purpose |
|---|---|---|---|
| `TomoriState.config` | `llm_stop_speaker_pattern_enabled` | `false` | Activates speaker-guard truncation in this stage |
| `TomoriState.config` | `uncensor_unicode_space_enabled` | `false` | Replaces Unicode 0x2800 braille blank with regular space in output |
| `TomoriState.config` | `uncensor_sanitize_enabled` | `false` | Strips encoded characters that bypass content filters |
| `StreamConfig` | `emojiUsageEnabled` | from `TomoriState` | Passed through to `cleanLLMOutput`; controls custom emoji presence |

## Related docs

- Stage 05 (produces the segment consumed here): → [`05-buffer-management.md`](05-buffer-management.md)
- Stage 07 (receives the normalized segment from here): → [`07-discord-delivery.md`](07-discord-delivery.md)
- Mention resolution: `src/utils/discord/stream/mentionResolver.ts`
- LLM output processor: `src/utils/text/processors/llmOutputProcessor.ts`
- Markdown table renderer: `src/utils/image/markdownTableRenderer.ts`
- Emoji penalty: `src/utils/text/emojiPenalty.ts`
- `TextProcessingConfig` type: `src/types/stream/types.ts:98`
- `BufferedDeliveryBoundary` type: `src/utils/discord/stream/messageDelivery.ts:15`
