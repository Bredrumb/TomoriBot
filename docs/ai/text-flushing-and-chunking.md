<!-- ARCH-ALIGNMENT: prereq-phase-5.5c -->

# 20. Text Flushing and Chunking (Current Behavior)

This document explains the *current* message flushing/chunking pipeline used by TomoriBot when streaming model output to Discord.

It focuses on:
- Buffer flush timing and boundaries
- Chunk splitting before Discord sends
- Humanizer Degree 3 behavior and execution order
- Emoji conversion/dedup interactions
- New overflow-safe flushing behavior

Primary implementation files:
- `src/utils/discord/streamOrchestrator.ts`
- `src/utils/discord/stream/bufferManager.ts`
- `src/utils/discord/stream/bufferFlusher.ts`
- `src/utils/discord/stream/segmentProcessor.ts`
- `src/utils/discord/stream/messageDelivery.ts`
- `src/utils/discord/stream/uiUpdater.ts`
- `src/utils/text/processors/chunkProcessor.ts`
- `src/utils/text/emojiPenalty.ts`
- `src/types/stream/types.ts`

## Why This Exists

`docs/ai/streaming.md` explains streaming at a high level. This doc covers the low-level implementation details and edge-case handling that affect real Discord output shape.

## End-to-End Pipeline

For each incoming provider text chunk:

1. Raw text is appended to stream buffer.
2. `drainThinkBlocksFromBuffer(...)` and `drainDetailsBlocksFromBuffer(...)` route hidden provider side-channel text out of the visible reply buffer.
3. `processBufferContent(...)` in `stream/bufferManager.ts` decides whether to flush part of buffer now.
4. `stream/bufferFlusher.ts` owns chunk deduplication, oversized-buffer loops, and pending/final flushes.
5. If a segment is flushed, `stream/segmentProcessor.ts` runs text preprocessing.
6. Registered-speaker guard truncates any known non-active `Name:` line before send, and also blocks reserved `Assistant:` lines, but ignores lines inside fenced or inline backtick code.
7. Complete markdown tables are split out and rendered to PNG attachments when possible.
8. Remaining text goes through `stream/messageDelivery.ts`.
9. Degree `0` queues the cleaned text into a pending visible buffer; degrees `1/2/3` chunk it into Discord-sized messages immediately.
10. Degree `0` only flushes that visible buffer at tool/attachment/final boundaries; degree `3` chunks are optionally humanized before send.
11. Discord payload delivery goes through `stream/uiUpdater.ts`, which chooses reply/channel/webhook sends and enforces send-limit stops.

Execution order for a flushed segment:

1. `filterDuplicateCustomEmojis(...)` (pre-conversion, `:name:` form)
2. `cleanLLMOutput(...)` (emoji normalization/conversion + text cleanup)
3. `resolveGuildMentions(...)`
4. Prefix stripping / output prefill handling
5. Registered-speaker guard truncation for known non-active `Name:` lines plus reserved `Assistant:` lines, excluding fenced and inline backtick code spans
6. Extract complete markdown table blocks and render them to PNG attachments
7. `chunkMessage(...)` for the remaining text
8. `humanizeString(...)` only when degree is `HEAVY` (3)
9. Send each final chunk to Discord

## Buffer Flush Triggers

Core logic: `processBufferContent(...)` in `src/utils/discord/stream/bufferManager.ts`.

Flush candidates (priority by earliest index in buffer):

1. Code block boundaries (` ``` ` open/close)
2. Newline boundaries (`\n`)
3. Sentence period boundaries (`.` / `。`) when Humanizer Degree = 3

Additional guards:
- No newline/period flush when semantic markers are incomplete.
- No flush on newline if newline is the current last buffered char (wait for more text).
- If sentence punctuation immediately follows newline, punctuation is carried into same flush.
  - Carried punctuation excludes `:` intentionally to avoid splitting `:emoji:` tokens.
- Immediately before send, when the server-wide speaker-pattern stop is enabled, the orchestrator truncates at any newline-prefixed speaker-like line (`Name:`) and requests a graceful stop so later flushes cannot leak that turn.
- Speaker-guard matches are ignored inside fenced code blocks and inline backtick code so literal examples like CSS properties do not terminate the stream.

## Semantic Marker Protection

Before newline/period flush, buffer is checked for incomplete structures:
- Unbalanced parentheses
- Unbalanced quotes (`"` and Japanese `「」`)
- Incomplete markdown link forms
- Incomplete URL protocol endings (`http:`, `https:/`, `https://`)
- Incomplete trailing markdown table blocks

If incomplete markers are detected, flush is deferred to avoid broken output.

At final flush/function-call flush, incomplete markers can be auto-closed to avoid text loss.

## Oversized Regular Buffer Flush (Fallback)

When no normal breakpoint is reached and buffer grows too large:

- Threshold: `DISCORD_STREAMING_CONSTANTS.FLUSH_BUFFER_SIZE_REGULAR`
- Current value: `1000` in `src/types/stream/types.ts`

Condition:
- Not inside a code block
- No incomplete semantic markers
- Buffer length >= threshold

Behavior:
- Uses `findRegularOverflowFlushIndex(...)` to flush at a natural boundary.
- Not a hard cut at exact 1000 unless no better boundary exists.

Boundary selection strategy:
1. Prefer nearby **forward** sentence/newline boundary
2. Else nearby **backward** sentence/newline boundary
3. Else whitespace boundary (backward, then forward)
4. Else hard fallback at target length

This is looped (`while`) so a very large buffer chunk can be drained in multiple safe slices.

## Chunking After Flush

Core logic: `chunkMessage(...)` in `chunkProcessor.ts`; final Discord sends are delegated through `StreamMessageDelivery` to `StreamUiUpdater`.

Key behavior:
- Treats code blocks, URLs, and custom Discord emoji tags as atomic blocks.
- Attempts semantic-aware splitting for quoted/parenthesized/markdown segments.
- For text blocks:
  - Degree `NONE` (0): preserve internal newlines and only split when Discord length limits require it
  - Degrees `LIGHT/MEDIUM` (1/2): split by newlines (`\n+`)
  - Degree `HEAVY` (3): split by newlines + sentence boundaries
- Consecutive emoji blocks are grouped into one emoji run.
- Final normalization merges punctuation-only chunks into adjacent chunks when possible.
  - Prevents standalone sends like `"."` or `","`.

Chunk length:
- `maxMessageLength` is provider-configured using `MAX_SINGLE_MESSAGE_LENGTH` (`1950`).
- This stays below Discord’s 2000-char hard limit.

## Humanizer Degree 3 Ordering

Important sequencing:

1. Buffer flush boundary is decided first.
2. Segment cleanup/conversion runs.
3. Segment is split by `chunkMessage(...)`.
4. Then each chunk is passed through `humanizeString(...)`.

So for Degree 3:
- Period-based flush in the buffer stage is active.
- `humanizeString(...)` is still *post-chunking*, not pre-flush.

## Emoji Dedup Interaction

Duplicate custom emoji filtering runs before `cleanLLMOutput(...)`.

Safety guard in `filterDuplicateCustomEmojis(...)`:
- If removing duplicate emojis would collapse output to punctuation-only/whitespace-only (or empty), filtering is skipped and original segment is kept.
- This prevents weird outputs like lone `","` and avoids dropping emoji-only lines entirely.

## Orphan Punctuation Hold-and-Prepend

`mergeStandalonePunctuationChunks(...)` only de-orphans punctuation **within a single flush**. When the model emits a deliberate punctuation expression on its own line (e.g. `prev\n...\nnext`), each segment flushes separately and the merge function never sees them together.

Cross-flush handling in `sendBufferSegment(...)`:
- If a flushed segment trims to pure sentence-ending punctuation **and** is length ≥ 3 OR contains the unicode horizontal ellipsis `…`, it is held in `state.pendingOrphanPunctuation` instead of sent.
- The held content is prepended to the next non-empty segment that passes the singleton-drop guards.
- On final flush (`flushFinalBuffer(...)`), any still-held punctuation is released as a standalone send so model output is never silently dropped.

Why the length/`…` threshold:
- Length 1 (`.`) and length 2 (`..`) remain handled by the existing singleton-drop guards in `sendBufferSegment(...)` — those are typically hallucination fragments and are intentionally discarded.
- Length ≥ 3 (`...`, `....`, `?!?!`) and `…` are deliberate expressive punctuation and should reach the user attached to the surrounding text.

Useful log lines:
- `Stream Orphan: Holding "..." (pending="...") for next segment`
- `Stream Orphan: Prepending held "..." to next segment`
- `Stream Orphan: Releasing held "..." as standalone on final flush (no following segment).`

## Typing and Send Mode

Degree `0` uses aggregated visible delivery:
- internal flushes still happen for coherence/tool boundaries
- newline-triggered joins between queued segments are normalized to exactly one blank line (`\n\n`)
- queued text is only sent when a phase ends or an attachment must be emitted separately

Typing simulation is enabled for degree `>= MEDIUM`:
- Config built by `createTypingSimulationConfig(...)`
- Sends first chunk immediately, then simulates typing for subsequent chunks.

Successful Discord sends count as stream progress for the outer SDK watchdog, so long generations that are still visibly flushing to Discord no longer hit the top-level timeout just because the overall turn exceeds the original wall-clock budget.

Immediate send mode is used for degree `1`, and for the final flushed chunks of degree `0`.

## Message Flood Guard

`STREAMING_LIMITS.MAX_FLUSH_COUNT` (from `rateLimiter.ts`) caps total sent messages per stream session in production.

If limit is hit:
- Stream requests graceful stop
- Warning embed is sent
- Extra flushes are suppressed to avoid duplicate limit embeds

## Debugging Checklist

Useful log lines:
- `Stream API: Raw chunk received: ...`
- `Stream Seg: Flushing oversized regular buffer at safe breakpoint (...)`
- `Stream Send: Humanized (D3) from ... to ...`
- `Stream Send: Sent message (N): ...`
- `[Unique Emoji] ...` logs from emoji dedup layer

When output looks odd:
1. Check whether weird split happened at buffer flush or chunking stage.
2. Check if `filterDuplicateCustomEmojis(...)` removed an emoji.
3. Check degree (`humanizer_degree`) because D3 enables period flush and post-chunk humanization.
4. Check whether output contained incomplete semantic markers delaying flush.

## Practical Test Prompts

Use exact-output prompts to isolate formatter behavior:

1. Newline punctuation case:
```text
Reply with EXACTLY this text. Preserve line breaks:
hello there
.
```

2. Emoji + punctuation line case:
```text
Reply with EXACTLY this text. Preserve line breaks:
:poggers:
,
:xdd:
,
```

3. Long overflow case (forces fallback flush):
```text
Write one paragraph over 1500 characters without code blocks. Keep punctuation natural.
```

4. Degree 3 boundary case:
```text
Write 6-8 short sentences, each ending with a period, with one newline in the middle.
```

Expected:
- No standalone punctuation-only Discord messages.
- No broken `:emoji:` token splitting due to newline carry.
- Large buffers split near natural boundaries, not abrupt hard cuts.
