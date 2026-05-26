<!-- ARCH-ALIGNMENT: prereq-phase-5.5d -->

# Stage 05 — `processTextChunk`

Accumulates streamed text into semantic buffers and flushes discrete segments to stage 06 when a delivery boundary is detected.

**File:** `src/utils/discord/stream/bufferFlusher.ts:35-342`

## Mission

`StreamBufferFlusher.processTextChunk()` is called by the stage 04 orchestrator for every
`ProcessedChunk` with `type === "text"`. It maintains the primary streaming buffer
(`state.buffer`) and two capture buffers (`state.thinkBlockBuffer`,
`state.detailsBlockBuffer`), routing incoming text to whichever buffer is currently active
based on semantic block markers in the stream.

After routing, it calls `processStreamBufferContent()` (from `bufferManager.ts`) in a loop to
detect flush boundaries within `state.buffer` and emit discrete segments to stage 06 via
`StreamSegmentProcessor.sendBufferSegment()`. The loop runs until no more boundaries are
detected or a stop request arrives.

Three flush paths exist beyond the main `processTextChunk` loop:

- **`flushFinalBuffer()`** — called by the stage 04 orchestrator after the generator exhausts.
  Sends any remaining `state.buffer` content, releases held orphan punctuation, drains unterminated
  think/details blocks to their respective stores, and triggers the aggregated-mode batch send.

- **`flushPendingBuffer()`** — called when a `function_call` chunk or a stop request arrives mid-
  stream. Sends the buffer *up to* a clean clause boundary (trailing incomplete clause trimmed when
  called with `trimTrailingIncompleteClause: true`), then releases the aggregated-mode buffer.

- **Overflow flush** — when `state.buffer` grows beyond `FLUSH_BUFFER_SIZE_REGULAR` without
  hitting a sentence boundary, a safe word-break index is found via `findRegularOverflowFlushIndex`
  and the buffer is flushed in segments until it is back under the limit.

### Semantic block detection

`drainThinkBlocksFromBuffer(state)` and `drainDetailsBlocksFromBuffer(state)` scan `state.buffer`
for `<think>` / `</think>` and `<details>` / `</details>` boundaries after each chunk is appended.
While `state.isInsideThinkBlock` is `true`, incoming text is routed to `state.thinkBlockBuffer`
instead of `state.buffer`. The completed block content is stored in `state.thoughtRawSegments`
on close; it never reaches Discord. Similarly, `state.isInsideDetailsBlock` routes to
`state.detailsBlockBuffer`; on close the content goes to `state.detailsSegments` for STM write.

### Deduplication

`deduplicateIncomingTextChunk()` checks the incoming text against a rolling tail of recently
accumulated text (last `STREAM_CHUNK_DEDUP_TAIL_CHARS` characters of `accumulatedText +
pendingAggregatedText + buffer`). This guards against providers that occasionally re-emit the
last few tokens of the previous chunk in the next delivery.

## Input

- `textContent: string` — raw text content from the `ProcessedChunk`.
- `config: StreamConfig` — provides `flushBufferSize`, `flushBufferSizeCodeBlock`, and timing.
- `context: StreamContext` — channel ID (stop checks), `currentTurnModelParts` (accumulation),
  `suppressTextOutput` flag.
- `textConfig: TextProcessingConfig` — humanizer degree and delivery mode (aggregated vs. streaming).
- `typingConfig: TypingSimulationConfig` — typing speed parameters forwarded to stage 06.
- `state: StreamState` — the mutable per-stream state object (buffer, block flags, counters).
- `metrics: StreamMetrics` — `totalCharacters` is incremented here.

## Output

No return value. All output is produced as side effects on `state` and via calls to stage 06
(`sendBufferSegment`).

## Side effects

- **`state.buffer`** — mutated: text appended, segments flushed (string truncated).
- **`state.isInsideCodeBlock`** / **`state.isInsideThinkBlock`** / **`state.isInsideDetailsBlock`** —
  toggled when block boundaries are detected.
- **`state.thinkBlockBuffer`** / **`state.detailsBlockBuffer`** — accumulated while inside their
  respective blocks; drained when the block closes.
- **`state.thoughtRawSegments`** / **`state.detailsSegments`** — appended to when a think/details
  block closes or when `flushFinalBuffer()` captures an unclosed block.
- **`context.currentTurnModelParts`** — non-empty, non-whitespace text is pushed as
  `{ text: content }` parts so the provider adapter can replay accumulated output when
  constructing function-interaction history.
- **`metrics.totalCharacters`** — incremented by the length of the deduplicated chunk.
- **`state.hasSemanticMarkers`** — set when `state.buffer` contains an open semantic marker;
  cleared on buffer flush or `autoCloseStreamBufferMarkers()` in the final flush.

## Invariants

After `processTextChunk` returns for any given chunk:

- If `context.suppressTextOutput` was true, no segment was forwarded to stage 06.
- If a stop request was detected mid-loop, the method returned early without sending further
  segments; the caller (stage 04) handles the stop.
- `state.buffer` contains only the unflushed tail (text after the last flush boundary).
- Code block state (`isInsideCodeBlock`) accurately reflects the most recent open/close event seen
  in `state.buffer`.

After `flushFinalBuffer()`:

- `state.buffer` is empty.
- `state.thinkBlockBuffer` and `state.detailsBlockBuffer` are empty (captured to segments).
- Aggregated-mode pending text has been sent to Discord.
- `state.isInsideCodeBlock` and `state.hasSemanticMarkers` are `false`.

## Extension points

| Surface | Plugin-relevance |
|---|---|
| `processStreamBufferContent()` (in `bufferManager.ts`) | Internal — boundary detection (sentence, code block, newline) is tightly coupled to Discord message formatting constraints. The `flushBufferSize` configuration (`StreamConfig`) is the operational surface. |
| `drainThinkBlocksFromBuffer()` / `drainDetailsBlocksFromBuffer()` | Internal — semantic block capture routes are tightly coupled to the think/details tag conventions used by TomoriBot's prompts. |
| `findRegularOverflowFlushIndex()` | Internal — overflow flush breakpoint logic; coupled to Discord's 2000-character message limit. |
| Chunk deduplication (`STREAM_CHUNK_DEDUP_MIN_CHARS`, `STREAM_CHUNK_DEDUP_TAIL_CHARS`) | `src/utils/discord/stream/constants.ts`. Internal — a workaround for overlapping chunk delivery; no plugin-relevant seam. |

## Configuration

| Source | Key / Env var | Default | Purpose |
|---|---|---|---|
| `DISCORD_STREAMING_CONSTANTS` | `FLUSH_BUFFER_SIZE_REGULAR` | `1000` chars | Overflow flush threshold for non-code-block text |
| `DISCORD_STREAMING_CONSTANTS` | `FLUSH_BUFFER_SIZE_CODE_BLOCK` | `15 000` chars | Overflow flush threshold while inside a code block |
| `DISCORD_STREAMING_CONSTANTS` | `MAX_SINGLE_MESSAGE_LENGTH` | `1950` chars | Message length cap forwarded to stage 07 via `config.maxMessageLength` |
| `StreamConfig` | `flushBufferSize` / `flushBufferSizeCodeBlock` | From constants above | Configurable per-provider override (currently matches constants) |
| `TomoriState.config` | `uncensor_unicode_space_enabled` | `false` | Passed to `TextProcessingConfig`; used in stage 06 cleaning |

## Related docs

- Buffer boundary logic: `src/utils/discord/stream/bufferManager.ts`
- Stage 04 (calls this stage): → [`04-orchestrator-state-machine.md`](04-orchestrator-state-machine.md)
- Stage 06 (receives flushed segments from this stage): → [`06-segment-normalization.md`](06-segment-normalization.md)
- `StreamState` type: `src/types/stream/types.ts:46`
- Constants: `src/utils/discord/stream/constants.ts` and `src/types/stream/types.ts:15`
