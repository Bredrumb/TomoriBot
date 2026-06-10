---
title: "07: Discord Delivery"
---

Delivers a normalized text segment to Discord, applying typing simulation and routing through webhooks for persona mode.

**Files:**
- `StreamMessageDelivery.sendSegment` — `src/utils/discord/stream/messageDelivery.ts:154-194`
- `StreamUiUpdater.sendSinglePayload` — `src/utils/discord/stream/uiUpdater.ts:51-~230`

## Mission

This is the final stage of the provider pipeline: text that has passed through stages 05 and 06
is delivered to Discord. Two classes share the responsibility:

**`StreamMessageDelivery.sendSegment()`** makes the delivery-mode decision:

- **Aggregated mode** (`HumanizerDegree.NONE`) — the segment is queued into
  `state.pendingAggregatedText` via `queueAggregatedSegment()`. Aggregated text is only sent to
  Discord when a flush boundary that forces output arrives: a tool call, a final flush, or a
  Markdown table attachment. This produces a single, uninterrupted Discord message from what would
  otherwise be many small streaming messages. A render-modifier identity override flushes any
  pending aggregate first and sends immediately through the webhook path, because webhook identity
  is line-scoped and cannot be mixed into the regular aggregate buffer.

- **Streaming mode** (degree 1–3) — the segment is split into Discord-safe chunks via
  `chunkMessage()`, then optionally humanized (degree 3 only: `humanizeString()`), and sent
  through one of two paths:
  - **With typing simulation** (degree 1–2) — `sendChunksWithTyping()` sends the first chunk
    immediately, then inserts an interruptible typing delay (`interruptibleDelay()`) between
    subsequent chunks scaled to `chunk.length × baseSpeedMsPerChar` (capped at `maxTypingTimeMs`,
    minimum `minVisibleDurationMs`). An optional random "thinking pause" (`thinkingPauseChance`)
    adds further natural variance. Each delay is interruptible — it polls `hasStopRequest()`
    every 250 ms and returns early if a stop is pending.
  - **Immediate** (no simulation) — `sendChunksImmediate()` sends all chunks back-to-back.

**`StreamUiUpdater.sendSinglePayload()`** executes the Discord API call for a single message
payload. It handles:

- **Send-message-limit enforcement** — if `state.messageSentCount >= config.send_message_limit`
  (server-configured cap), a stop is requested and the send is skipped. The absolute safety cap
  `STREAMING_LIMITS.MAX_FLUSH_COUNT` is also enforced here with a user-facing embed.
- **Webhook path** — when `context.webhook` and `context.personaUsername` are set (alter persona
  mode), the message is sent via `sendWebhookMessageWithIdentity()` with the persona's name and
  avatar. For the *first* message of an alter persona response that has a `replyToMessage`, a
  standalone reply notice is sent first via `sendWebhookReplyNotice()`.
- **Render-modifier identity override** — when stage 06 resolves `SourcePersona (modifier): text`,
  the payload carries `identityOverride`. The UI updater lazily creates or reuses the managed
  channel webhook even for the main persona. Sprite matches send with the clean username
  `SourcePersona` and the sprite avatar; copied-identity matches send with the flipped username
  `target (SourcePersona)` and the target's avatar (the model-facing context label stays
  `SourcePersona (target)`). Ordinary main-persona output
  remains a regular bot message; the managed webhook is used only for override payloads. Unknown,
  ambiguous, or unusable modifiers are stripped before this stage and therefore follow the regular
  path.
- **Sprite message persistence** — payloads carrying a `spriteRecord` write a
  `persona_sprite_messages` row fire-and-forget after a successful *webhook* send (bot-fallback
  sends are skipped — they cannot carry persona identity in context). Context rebuilding uses
  this mapping to recover the decorated `SourcePersona (sprite):` label; a lost row degrades the
  label to the plain persona name, never an error.
- **Regular path** — otherwise the message is sent via `context.channel.send()` or
  `context.replyToMessage.reply()` (first message only), with `allowedMentions` set to suppress
  `@everyone` / `@here` pings while allowing user and role mentions.
- **State tracking** — on a successful send: `state.messageSentCount++`, `state.accumulatedText`
  is appended, and `state.firstReplyUrl` is set on the first message sent (used in thought-log embeds).
  For render-modifier payloads, `state.accumulatedText` is prefixed with the model-facing
  source-first label (`SourcePersona (modifier): `) — which may differ from the visible webhook
  username (clean name for sprites, flipped name for copied identities) — so result capture,
  STM, and future prompt context remain reversible.
- **Invalid-webhook recovery** — if the webhook send fails with Discord error 10015 or 50027
  (unknown/invalid webhook), the webhook cache is invalidated and a fresh webhook is fetched for
  retry.
- **Progress notification** — `context.onStreamProgress?.()` is called after a successful send,
  resetting the rolling SDK timeout in the tool-loop pipeline.

## Chunking behavior (`chunkMessage`)

`chunkMessage()` (`src/utils/text/processors/chunkProcessor.ts`) is the function that converts a
single normalized text segment into one or more Discord-safe messages. It runs as a multi-pass
parser that classifies the input into typed blocks, then emits chunks.

### Preserved spans

The parser locates and protects regions whose internal structure must not be split mid-region.
A chunk break can only happen at the boundary *between* such regions, never inside:

- Fenced code blocks (``` ``` ```) — kept whole; split across multiple messages only if a single
  block exceeds the chunk limit, in which case the opening fence + language tag is repeated on
  each subsequent chunk so syntax highlighting survives.
- URLs (matched outside markdown link parens) — never split.
- Markdown spans: bold (`**` / `__`), italic (`*` / `_`), strikethrough (`~~`),
  inline code (`` ` ``), and links (`[text](url)`).
- Quoted strings: English `"..."` and Japanese `「...」`.
- Balanced parentheses `(...)`.
- Discord custom emoji tags `<:name:id>` and `<a:name:id>`.

### Emoji isolation and runs

By default, every custom emoji block is **isolated** — flushed into its own Discord message rather
than carried inline with surrounding text. Consecutive emojis are merged into a single
"emoji-run" message **iff** their normalized names share the same prefix (length controlled by
`EMOJI_RUN_PREFIX_LENGTH`, default 3; the regex `[^a-z0-9]` strips separators before slicing).
This produces Discord's large-emoji rendering for reaction-style messages, while keeping
unrelated emoji packs in separate messages.

Two carve-outs override the default isolation and fold the emoji inline with adjacent text:

1. **Mid-sentence** — non-emoji text exists on both sides of the emoji on the same `\n`-delimited
   line, AND the text immediately before does not end in sentence-terminating punctuation
   (`. ! ? 。 ！ ？`). Example: `"I really like :Soup:, don't you?"` → one chunk.
2. **List item** — the emoji's line begins with a list marker (`\d+[.)] ` or `- ` / `* ` / `• `).
   Example: `"1. :Soup:\n2. :Smile:"` → list numbering stays attached to each emoji.

Trailing emojis after a completed sentence (`"That was amazing! :Soup:"`) and leading emojis
(`":Soup: looks tasty"`) intentionally remain isolated — the carve-outs target structural
contexts, not stylistic prose.

### Humanizer interaction

`HumanizerDegree` (a `TomoriState.config` field) controls how the resulting blocks emit as
messages after parsing:

| Degree | Behavior |
|---|---|
| `NONE` (0) | Aggregated delivery — chunks join into one message at flush boundaries (see Mission §) |
| `LIGHT` / `MEDIUM` (1–2) | Each paragraph (`\n+`-separated) becomes its own Discord message |
| `HEAVY` (3) | Each sentence becomes its own message; sentence splitting uses an abbreviation-aware regex (`createSentenceSplitRegex`) to avoid breaking on "Mr.", "e.g.", numbered references, etc. |

Standalone-punctuation chunks (a chunk that is purely `.,!?;:。！？、，` after trimming) are
merged into the previous or next chunk by `mergeStandalonePunctuationChunks`, preventing orphan
punctuation messages.

## Input

- `segment: string` — normalized text from stage 06.
- `boundary: BufferedDeliveryBoundary | undefined` — forwarded from stage 06 for aggregated-mode
  newline joining logic.
- `textConfig: TextProcessingConfig` — `visibleDeliveryMode`, `humanizerDegree`, `maxMessageLength`.
- `typingConfig: TypingSimulationConfig` — speed, duration limits, random-pause config.
- `context: StreamContext` — channel, webhook, locale, tomoriState, progress callback.
- `state: StreamState` — `messageSentCount`, `accumulatedText`, `pendingAggregatedText`,
  `firstReplyUrl`.

## Output

No return value from `sendSegment()`. `sendSinglePayload()` returns `Promise<Message | null>` —
the sent Discord `Message` object (used by `sendRenderedMarkdownTable` to cache table content by
message ID), or `null` if the send was skipped (stop request, limit reached, empty content).

## Side effects

- **Discord message sent** — the primary side effect; one or more Discord messages are created in
  `context.channel` (or via `context.webhook`).
- **`state.messageSentCount`** — incremented per message sent.
- **`state.accumulatedText`** — appended with the text of each sent message (used for STM write
  at pipeline end). Render-modifier sends append the visible `SourcePersona (modifier): ` label once
  at the start of the modified line, even when the line is split across multiple Discord messages.
- **`state.firstReplyUrl`** — set to the URL of the first reply message (if not already set).
- **`state.hasRepliedToOriginalMessage`** — set to `true` after the first successful reply.
- **`state.pendingAggregatedText`** — cleared after an aggregated-mode flush.
- **`context.replyNoticeState`** — `attempted` and `sent` flags updated when the alter reply
  notice is sent.
- **Webhook cache invalidation** — on invalid-webhook error: `invalidateWebhookCache(channelId)`
  is called and a new webhook is fetched.
- **`context.onStreamProgress?.()` callback** — called on each successful send.

## Invariants

After this stage (per successful send):

- `state.accumulatedText` contains all text that has been delivered to Discord so far in this
  stream.
- `state.messageSentCount` reflects the total number of Discord messages sent.
- If a stop request was detected before or during a typing delay, no further sends occur and the
  method returns early.

## Extension points

| Surface | Plugin-relevance |
|---|---|
| `sendWebhookMessageWithIdentity()` | `src/utils/discord/webhook/personaDispatch.ts`. The webhook persona dispatch path is the extension seam for persona-specific message appearance. A plugin adding a new persona display mode (e.g., custom embed layout) would extend here. → plugin plan candidate |
| `chunkMessage()` | `src/utils/text/processors/chunkProcessor.ts`. Internal — message chunking is tightly coupled to Discord's 2000-character limit and the humanizer sentence-split regex. |
| `humanizeString()` | `src/utils/text/processors/formatters.ts`. Internal — degree-3 humanization is a character-level noise function; no plugin-relevant seam. |
| Typing simulation (`sendChunksWithTyping`, `interruptibleDelay`) | Internal — typing simulation timing constants are configurable via `DISCORD_STREAMING_CONSTANTS`; the `HumanizerDegree` DB field is the user-facing control. |
| `STREAMING_LIMITS.MAX_FLUSH_COUNT` | `src/utils/security/rateLimiter.ts`. Internal — an operational safety cap, not a plugin seam. The server-configured `send_message_limit` is the user-facing control. |
| Aggregated-mode buffer (`pendingAggregatedText`, `flushAggregatedTextBuffer`) | Internal — aggregated delivery is driven by `HumanizerDegree.NONE`; not designed for external control. |

## Configuration

| Source | Key / Env var | Default | Purpose |
|---|---|---|---|
| `TomoriState.config` | `humanizer_degree` | `MEDIUM` | Controls delivery mode (aggregated vs. streaming) and typing simulation |
| `TomoriState.config` | `send_message_limit` | `0` (no limit) | Per-stream Discord message cap; `0` means unlimited |
| `DISCORD_STREAMING_CONSTANTS` | `BASE_TYPE_SPEED_MS_PER_CHAR` | `10` ms | Typing speed multiplier per character |
| `DISCORD_STREAMING_CONSTANTS` | `MAX_TYPING_TIME_MS` | `4 000` ms | Cap on typing delay per chunk |
| `DISCORD_STREAMING_CONSTANTS` | `MIN_VISIBLE_TYPING_DURATION_MS` | `750` ms | Minimum typing delay shown |
| `DISCORD_STREAMING_CONSTANTS` | `THINKING_PAUSE_CHANCE` | `0.25` | Probability of an extra "thinking" pause between chunks |
| `DISCORD_STREAMING_CONSTANTS` | `MIN_RANDOM_PAUSE_MS` / `MAX_RANDOM_PAUSE_MS` | `250` / `1500` ms | Thinking pause duration range |
| `STREAMING_LIMITS.MAX_FLUSH_COUNT` | `src/utils/security/rateLimiter.ts` | (see file) | Absolute safety cap on messages per stream |

## Related docs

- Stage 06 (produces the segment delivered here): → [`06-segment-normalization.md`](06-segment-normalization.md)
- Webhook lifecycle: `src/utils/discord/webhook/lifecycle.ts`
- Webhook persona dispatch: `src/utils/discord/webhook/personaDispatch.ts`
- Reply notice: `src/utils/discord/webhookReply.ts`
- Message chunking: `src/utils/text/processors/chunkProcessor.ts`
- `HumanizerDegree` enum: `src/types/db/schema.ts`
- `DISCORD_STREAMING_CONSTANTS`: `src/types/stream/types.ts:15`
- Multi-persona webhook behavior: `docs/subsystems/multi-persona.md` (webhook-persona pipeline TBD)
