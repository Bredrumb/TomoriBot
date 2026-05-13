<!-- ARCH-ALIGNMENT: prereq-phase-3 -->

# 10. Streaming & Response System

This document explains the current streaming architecture for TomoriBot and how model output is transformed into Discord messages.

> This file is the high-level guide.  
> For low-level flush/chunk edge cases and exact boundary rules, see [`text-flushing-and-chunking.md`](./text-flushing-and-chunking.md).

## Overview

TomoriBot uses a modular streaming pipeline:

1. Provider stream adapters normalize raw provider chunks.
2. `StreamOrchestrator` manages buffering, boundaries, tool-call interruption, and Discord sending.
3. Text utilities clean, chunk, and optionally humanize content before sending.

Important: TomoriBot now sends **discrete messages**, not "edit the same message every 500ms".

## Main Components

| Component | File | Responsibility |
|---|---|---|
| Universal orchestrator | `src/utils/discord/streamOrchestrator.ts` | Buffering, flush decisions, send pipeline, timeout/stop handling |
| Stream interfaces | `src/types/stream/interfaces.ts` | Provider/orchestrator contracts, `BaseStreamAdapter`, and stream context |
| Stream constants/types | `src/types/stream/types.ts` | Message length, flush thresholds, typing settings |
| Provider stream adapters | `src/providers/*/*StreamAdapter.ts` | Extend `BaseStreamAdapter` and convert provider-native events into normalized chunks |
| Text processing | `src/utils/text/stringHelper.ts` | `cleanLLMOutput`, `chunkMessage`, `humanizeString` |
| Markdown table detection | `src/utils/text/markdownTable.ts` | Detect complete pipe tables, hold incomplete tails, and split renderable table blocks from plain text |
| Markdown table rendering | `src/utils/image/markdownTableRenderer.ts` | Render detected markdown tables to PNG attachments without a browser dependency |
| Emoji dedup controls | `src/utils/text/emojiPenalty.ts` | Duplicate custom-emoji filtering with safety guards |

## Runtime Flow

### 1) Provider entry

`tomoriChat` calls provider `streamToDiscord(...)`.  
Before heavy response work starts, `tomoriChat` also starts a lock-scoped Discord typing keepalive.  
Provider builds `StreamConfig` and delegates to `StreamOrchestrator.streamToDiscord(...)`.

### Base Adapter Contract

All provider stream adapters extend `BaseStreamAdapter` from `src/types/stream/interfaces.ts`.

The base class owns shared adapter identity and raw-chunk lifecycle hooks/wrappers:

- `getProviderInfo()` returns consistent adapter metadata for logging and diagnostics.
- `createRawChunk(...)` wraps provider-native data with provider name and timestamp metadata.
- `createProviderErrorChunk(...)` wraps provider errors after provider-specific normalization.
- `onRawChunk(...)` and `onProviderError(...)` are protected no-op hooks for provider subclasses that need adapter-local lifecycle side effects.

Provider subclasses still own request construction, context conversion, provider-native chunk parsing, tool-call extraction, and user-facing error descriptions. The shared OpenAI-compatible family adapter (`src/providers/openaiCompatible/openaiCompatibleStreamAdapter.ts`) also extends the base class, so `custom`, `deepseek`, `nvidia`, `zai`, and `zaicoding` inherit the same contract through that family layer.

Normal provider event chunks may still be assembled in provider subclasses when the native stream shape needs provider-local metadata or split-event ordering. The base raw/error wrappers are the preferred path for generic chunks, not a requirement to flatten every provider-specific yield site.

### 2) Stream initialization

`tomoriChat`:
- refreshes Discord typing for the active channel lock until the lock is released

`StreamOrchestrator`:
- creates stream state/metrics
- builds `TextProcessingConfig`
- builds typing config from `humanizerDegree`
- prepares optional output prefill

### 3) Per-chunk loop

For each provider raw chunk:
- stop-request check
- inactivity timeout check
- reset inactivity timer
- provider `processChunk(...)` to normalized type
- handle normalized chunk (`text`, `function_call`, `error`, `done`)

### 4) Text chunk handling

For `text` chunks:
- append to buffer
- run boundary detection
- flush eligible segment(s)
- apply regular overflow fallback when needed

### 5) Segment pipeline before send

Each flushed segment goes through:
1. `filterDuplicateCustomEmojis(...)`
2. `cleanLLMOutput(...)`
3. mention resolution
4. prefix strip/prefill handling
5. registered-speaker guard truncation (`Name:` lines for known non-active speakers, plus reserved `Assistant:` lines, excluding fenced and inline backtick code)
6. complete markdown tables are split out and rendered to PNG attachments when possible
7. remaining text goes through `sendSegment(...)` for either live delivery or degree-0 phase aggregation

### 6) Message chunking and sending

`sendSegment(...)`:
- degree `0` queues cleaned text into a pending visible buffer instead of sending immediately
- degree `0` flushes that queue at tool-call, attachment, error-preservation, and final boundaries
- degrees `1/2/3` split text with `chunkMessage(...)` (Discord-safe lengths)
- applies `humanizeString(...)` only for degree `3` (`HEAVY`)
- degree `1` sends immediately; degrees `2/3` use typing simulation

### 7) Completion

When stream ends:
- final buffer flush
- metrics finalization
- accumulated output returned for short-term memory storage

## Reasoning / Thought Logging

Providers may emit displayable reasoning separately from visible reply text.

- Stream adapters attach reasoning to normalized chunks via `ProcessedChunk.thoughts`
- reasoning is classified as either `summary` or `raw`
- `StreamOrchestrator` accumulates those thought segments separately from the visible reply buffer
- thought text is not appended to `currentTurnModelParts`
- thought text is not flushed to Discord as part of the normal reply
- thought text is not stored in short-term memory

On successful streamed turns, `StreamOrchestrator` returns the merged reasoning payload in `StreamResult.thoughtLog`, along with the first visible reply URL when one exists. Thought-log payloads also carry provider streaming duration, which is summed across tool-call iterations and shown in the final thought-log embed footer only when actual thought-log content is emitted.

`tomoriChat` merges thought logs across successful tool-call iterations and posts one final embed to the configured `tomori_configs.thought_log_channel_disc_id` channel after the full turn completes. Thought-log embeds are sent with suppressed notifications so they do not ping channel subscribers. If the configured channel is missing, inaccessible, or deleted, the main reply still succeeds and the thought-log post is skipped with a warning.

Normal message triggers are disabled inside the configured thought-log channel so provider reasoning echoes cannot recursively trigger new chats there. Slash commands still work because they do not use `messageCreate`.

When tool notices are hidden through `/config notice-embeds visibility`, those notices reuse the same thought-log channel as a fallback destination. Routed notices include the original source message URL when available, or the source channel mention otherwise. Private channels remain isolated: hidden notices from configured private channels are suppressed instead of being reposted to thoughtlogs. The fallback-model usage notice follows the same reroute behavior when hidden, but when visible it posts only a `Fallback Used` button in the source channel and exposes the verbose failure chain through a button-triggered ephemeral embed instead of a public details embed.

Thought-log sender identity is explicit:
- main persona turns post as the normal bot sender
- alter persona turns post through the shared webhook using the alter nickname/avatar
- user-impersonation turns post through the shared webhook using the impersonated user's display name/avatar

The merged thought log is still one logical turn. In normal multi-persona auto-trigger flows, only one persona owns a given invocation because additional personas are re-queued into separate follow-up jobs.

## Buffering and Flush Boundaries

Primary flush triggers:
- code block open/close boundaries
- newline boundaries
- period-based sentence boundaries when humanizer degree is `HEAVY` (3)

Safety guards:
- newline/period flush blocked when semantic markers are incomplete
- newline at end-of-buffer waits for more input
- punctuation carry after newline keeps sentence punctuation attached
- colon (`:`) is intentionally excluded from newline punctuation carry to avoid splitting `:emoji:` tokens

Overflow fallback:
- if regular buffer becomes too large, orchestrator flushes at a **safe breakpoint**
- prefers nearby sentence/newline boundaries, then whitespace, then hard fallback
- loops until oversized buffer is drained
- degree `0` still uses the same internal flush logic; it only delays visible Discord sends until a phase boundary

## Message Sending Behavior

### Main persona
- first send may reply to the source message
- subsequent sends use `channel.send(...)`

### Alter persona
- sends via webhook with persona username/avatar
- when the turn is a reply, Tomori sends one standalone reply-context embed immediately before the first visible alter message of that turn
- attempts webhook recovery on invalid webhook errors
- in non-production, avatar identity comes from either a public URL built from local storage or a webhook-avatar mutation fallback guarded by a per-target-channel lock
- falls back to regular bot message if webhook path fails

### User impersonation
- sends through a temporary webhook created with the impersonated user's display name/avatar
- if the impersonated user has set `/personal impersonate prompt`, that prompt is injected as a user-owned persona prompt before the final imitation directive
- if webhook creation, webhook sending, or stream completion fails, the impersonation attempt fails closed
- TomoriBot does not fall back to a normal bot-authored channel message for user impersonation replies or timeout/error notices

### Flood protection
- `STREAMING_LIMITS.MAX_FLUSH_COUNT` caps messages per stream session in production
- if limit is reached, stream requests a graceful stop and warns user

## Humanizer Behavior

Humanizer degree controls both pacing and text treatment:

| Degree | Behavior |
|---|---|
| `0` (`NONE`) | Uses the active system prompt source, but buffers visible text into one reply per tool-free phase |
| `1` (`LIGHT`) | Uses the active system prompt source and streams discrete messages immediately |
| `2` (`MEDIUM`) | Degree `1` + typing simulation and random pauses |
| `3` (`HEAVY`) | Degree `2` + period flush boundary + post-chunk humanization |

System prompt behavior:
- degrees `0-3` all use the same active system prompt source
- that means custom `/config system-prompt` when set, otherwise `DEFAULT_SYSTEM_PROMPT`
- when a SillyTavern preset owns the system prompt path, that preset behavior still wins
- user impersonation still skips bot-owned system prompt injection

Key order for degree 3:
1. Flush boundary decision
2. Segment cleanup
3. `chunkMessage(...)`
4. `humanizeString(...)` on each chunk

## Tool Call Integration

When model emits `function_call`:
- orchestrator flushes pending visible text first
- degree `0` finalizes its queued phase buffer before returning `function_call`
- returns status `function_call`
- caller executes tool and continues next stream iteration with updated context

If the active user sends follow-up messages while a tool-call chain is running, TomoriBot preserves the tool progress and keeps only the latest same-user follow-up queued for the channel. That queued follow-up is answered as a direct Discord reply, so tool-sent recent-message replies are disabled for that follow-up turn to prevent duplicate replies to the same message.

Provider adapter safeguards:
- Google/OpenRouter/Custom adapters split mixed chunks (`text` + tool-call signal) into two raw chunks so text is processed first, then `function_call`.
- Speaker-boundary holdback tails are force-flushed before non-text chunks (tool call/error/finish) to prevent truncated text when a stream exits early on tool execution.
- Adapter-level speaker fallback only runs when `/config stop-strings manage` enables the server-wide `\n{Name}:` speaker-pattern checkbox. When enabled, it stops on newline-prefixed speaker-like labels such as `\nName:` while ignoring speaker-like lines inside fenced or inline backtick code.
- Shared stop-string rules live in `src/providers/utils/stopStrings.ts`. That registry handles universal stop strings, provider/model-specific stop strings, server-configured stop strings, and the opt-in persona speaker stop.

Stream-level safeguard:
- When the server's speaker-pattern checkbox is enabled, `StreamOrchestrator` truncates any flushed segment at the first newline-prefixed speaker-like label (`Name:`), then stops the stream. The same guard is skipped by default.

Loop control and max iterations are managed by `tomoriChat` (function-call safety loop). Two distinct guards protect the turn:

- `BOT_MAX_FUNCTION_CALL_ITERATIONS` (default 100) — hard ceiling on total tool-call round-trips, fires the "Thinking Loop" embed.
- `BOT_MAX_CONSECUTIVE_TOOL_ERRORS` (default 5) — provider-agnostic flail guard. Counts consecutive tool-execution failures (any `success:false`, including recoverable sticker misses), resets on any successful tool call, and fires the "Tool Error Loop" embed when the threshold is hit. Aborts the turn well before the iteration ceiling so a model stuck repeating the same failing call stops burning API credits.

## Error, Timeout, and Stop Handling

### Provider errors
- pending text is flushed first (when available)
- provider-specific error messaging is used when possible
- fallback embed path handles generic errors

### Inactivity timeout
- orchestrator inactivity timer resets on each provider chunk
- successful Discord sends also count as progress and refresh the outer SDK timeout watchdog
- timeout threshold defaults from stream constants
- `tomoriChat` also wraps the full `streamToDiscord(...)` call in a refreshable SDK watchdog
- the SDK watchdog now refreshes on orchestrator progress instead of acting as a fixed wall-clock cutoff
- timeout state is tracked explicitly, so cleanup at normal stream end no longer looks like a timeout

### Stop requests
- stop requests are tracked by channel
- checked before processing/sending to avoid duplicate or late sends
- special handling avoids duplicate flush-limit embeds
- internal speaker-boundary stops that send no visible text are promoted into the empty-response retry path instead of silently ending as a normal user stop
- speaker-guard-triggered empty-response retries append an in-band `[System: ...]` reminder telling the model to continue only as the active persona and, if it emits a speaker label, to start with that persona's name

### Final flush auto-close
- if final buffer still has incomplete semantic markers, orchestrator auto-closes markers before sending to avoid text loss

## Key Tuning Knobs

| Setting | Location | Current Role |
|---|---|---|
| `MAX_SINGLE_MESSAGE_LENGTH` | `src/types/stream/types.ts` | Per-message chunk cap (below Discord hard limit) |
| `FLUSH_BUFFER_SIZE_REGULAR` | `src/types/stream/types.ts` | Regular overflow threshold |
| `FLUSH_BUFFER_SIZE_CODE_BLOCK` | `src/types/stream/types.ts` | Code-block overflow threshold |
| `INACTIVITY_TIMEOUT_MS` | `src/types/stream/types.ts` | Stream inactivity timeout |
| `MAX_FLUSH_COUNT` | `src/utils/security/rateLimiter.ts` | Max messages sent per stream session |
| `DISCORD_TYPING_KEEPALIVE_INTERVAL_MS` | `.env` | Channel-lock typing refresh cadence while work is still active |
| `MARKDOWN_TABLE_RENDER_MAX_WIDTH` | `.env` | Width cap for rendered markdown table PNGs |
| `MARKDOWN_TABLE_RENDER_MAX_HEIGHT` | `.env` | Height cap before table rendering falls back to raw text |
| `MARKDOWN_TABLE_CACHE_TTL_MINUTES` | `.env` | How long rendered-table source text stays available for history/context reuse |
| `humanizer_degree` | `tomori_configs` | Controls pacing and degree-dependent flush/humanization |

## Debugging Checklist

Useful logs when diagnosing output shape:
- `Stream API: Raw chunk received: ...`
- `Stream Seg: Flushing oversized regular buffer at safe breakpoint ...`
- `Stream Send: Humanized (D3) from ... to ...`
- `Stream Send: Sent message (N): ...`
- `[Unique Emoji] ...` lines from emoji dedup

If output looks wrong:
1. Confirm where the split happened (buffer flush vs `chunkMessage`).
2. Check emoji dedup logs for removals.
3. Verify active humanizer degree.
4. Check for incomplete semantic markers delaying flush.

## Related Docs

- `docs/ai/text-flushing-and-chunking.md` (low-level flush/chunk internals)
- `docs/ai/expression-handling.md` (emoji/sticker conversion and metadata)
- `docs/ai/providers.md` (provider architecture)
