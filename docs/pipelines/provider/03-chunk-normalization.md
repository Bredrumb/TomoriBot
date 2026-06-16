---
title: "03: Chunk Normalization"
---

Converts a provider-native `RawStreamChunk` into the uniform `ProcessedChunk` shape the orchestrator routes.

**Contract:** `BaseStreamAdapter.processChunk` — `src/types/stream/interfaces.ts:247`
**Canonical implementation:** `GoogleStreamAdapter.processChunk` — `src/providers/google/googleStreamAdapter.ts:649-760`

## Mission

Each `RawStreamChunk` yielded by stage 02 is immediately passed to `processChunk()` inside the
stage 04 orchestrator loop. This method is the boundary at which all provider-specific chunk
formats collapse into the single `ProcessedChunk` union that the orchestrator understands:

```ts
interface ProcessedChunk {
  type: "text" | "function_call" | "error" | "done";
  content?: string;           // type="text"
  functionCall?: FunctionCall; // type="function_call"
  error?: ProviderError;       // type="error"
  thoughts?: ThoughtLogEntry[]; // any type — thought log capture
  metadata?: Record<string, unknown>; // terminal metadata (finish reason, thought signature)
}
```

The method also handles two additional responsibilities:

- **Error normalisation** — raw SDK errors (HTTP status codes, provider-specific error objects)
  are converted to the shared `ProviderError` shape via `handleProviderError()`. This includes
  classifying the error type (`api_error`, `rate_limit`, `content_blocked`, `timeout`,
  `provider_overloaded`) and setting `retryable` so the stage 04 orchestrator and the upstream
  key-rotation logic in `runGenerationTurn` can make retry decisions without inspecting
  provider-specific error objects.

- **Thought log extraction** — for providers that emit reasoning fields, thought summaries, or
  thought signatures (for example Google/Gemini `part.thought`, `thoughtSummary`, and
  `thoughtSignature` fields), these are extracted into `ThoughtLogEntry[]` on the returned chunk
  so the orchestrator can accumulate them into `state.thoughtSummarySegments` /
  `state.thoughtRawSegments` independently of visible text. For OpenRouter, the upstream serving
  backend (the chunk-level `provider` field, e.g. `minimax-cn`) is also carried on
  `ProcessedChunk.servingProvider`, recorded into `state.servingProvider` (first non-empty wins), and
  rendered in the thought-log footer as `Provider: openrouter via <backend>` — so a backend that
  bleeds reasoning into content can be identified and pinned/avoided.

- **Leaked reasoning-tag guardrails** — the clean path is the provider (or OpenRouter) returning
  reasoning in a dedicated field. When a backend instead leaks reasoning into `delta.content`,
  OpenAI-compatible adapters (`openrouter`, `openaiCompatible`) run two worst-case guards over the
  text delta: `ThinkBlockContentStripper` (reroutes `<think>…</think>` blocks — including stray
  closers split across chunks — into `delta.reasoning`) and `ReasoningContentSpillGuard` (catches a
  *tagless* reasoning tail glued to the first visible delta — e.g. `must do.Hello!`). The spill guard
  only fires on the first visible content after reasoning, when that content starts lowercase and a
  sentence boundary is **glued** (no following whitespace) onto an answer-start char (uppercase /
  caseless letter, emoji, or quote/bracket). A *spaced* boundary is treated as the model's own prose
  and emitted untouched; the missing space is the fingerprint of a backend concatenating its
  reasoning buffer onto content with no separator (so `wait. Actually` is two real sentences, but
  `wait.Actually` is a seam — word count is irrelevant, only the missing space). Dotted code
  identifiers are protected by an inline-code guard: a boundary preceded by an odd number of
  backticks (inside a `` `obj.Method` `` span, or a still-open one mid-stream) is left intact, as is
  code at the very start of content (a leading backtick is not lowercase). Bare, non-backticked
  identifiers in prose are accepted collateral of the aggressiveness. The **shape** of a think tag is
  defined once in
  `src/providers/utils/reasoningTags.ts` and is namespace-aware (`<think>`, `<mm:think>`,
  `<ns:think>`); the stripper, the Discord-layer `bufferManager`, and the final `cleanLLMOutput`
  sweep all consume it. Adding a new vendor namespace is a one-line change there. Note: API stop
  strings (`stopStrings.ts`) are matched literally by the provider, so namespaced close tags must be
  added per model rule explicitly rather than via the shared pattern.

## Input

`chunk: RawStreamChunk` — the provider-native envelope yielded by stage 02.

## Output

`ProcessedChunk` — one of four variants:

| `type` | Carries | Orchestrator action |
|---|---|---|
| `"text"` | `content: string` | Route to stage 05 buffer flusher |
| `"function_call"` | `functionCall: FunctionCall` | Flush pending buffer → return `{ status: "function_call" }` |
| `"error"` | `error: ProviderError` | Flush pending buffer → show error embed → return `{ status: "error" }` |
| `"done"` | `metadata?: { finishReason }` | Record terminal metadata; continue loop (generator will exhaust next) |

Any variant may additionally carry `thoughts?: ThoughtLogEntry[]` when the provider emits
reasoning content in-band.

## Side effects

- None. `processChunk` is a pure transformation — it does not mutate `StreamState`, call Discord
  APIs, or trigger any timer. All side effects are owned by the orchestrator and downstream stages.

## Invariants

After this stage:

- The returned chunk's `type` is one of exactly `"text"`, `"function_call"`, `"error"`, `"done"`.
- If `type === "error"`, `chunk.error` is a fully-formed `ProviderError` with `type`, `message`,
  `retryable`, and `code` set. `originalError` preserves the raw SDK error for logging.
- If `type === "function_call"`, `chunk.functionCall` is a provider-agnostic `FunctionCall`
  `{ name, args, thoughtSignature? }`.
- Content-blocked responses (e.g., Gemini `promptFeedback.blockReason`, safety
  `finishReason`) are normalised to `type: "error"` with `error.type === "content_blocked"` and
  `retryable: false`.

## Extension points

| Surface | Plugin-relevance |
|---|---|
| `BaseStreamAdapter.processChunk()` abstract method | **A new provider adapter implements this to map its SDK chunk shapes to `ProcessedChunk`.** The contract is at `src/types/stream/interfaces.ts:184`. The implementation must be synchronous. |
| `BaseStreamAdapter.handleProviderError()` abstract method | **A new provider adapter implements this to classify its SDK errors.** The `ProviderError.retryable` flag is consumed by the key-rotation loop in `runGenerationTurn`; the `type` field drives user-facing error embed formatting. Contract at `src/types/stream/interfaces.ts:201`. |
| `BaseStreamAdapter.createErrorDescription()` abstract method | **A new provider adapter implements this to produce localized, provider-specific error text** for the error embed shown in Discord when `retryable: false` and user errors are not suppressed. Contract at `src/types/stream/interfaces.ts:207`. |
| `FunctionCall` shape (`name`, `args`, `thoughtSignature`) | The provider-agnostic function call format — `src/types/provider/interfaces.ts:145`. Fields like `thoughtSignature`, `reasoning_details`, and `deepseekReasoningContent` are provider-specific optional fields that must be preserved when passing tool results back to the provider in stage 01. |

## Related docs

- Stage 02 (produces `RawStreamChunk` consumed here): → [`02-raw-chunk-generation.md`](02-raw-chunk-generation.md)
- Stage 04 (routes the `ProcessedChunk` produced here): → [`04-orchestrator-state-machine.md`](04-orchestrator-state-machine.md)
- `ProcessedChunk` type: `src/types/stream/interfaces.ts:36`
- `ProviderError` type: `src/types/stream/interfaces.ts:47`
- `FunctionCall` type: `src/types/provider/interfaces.ts:145`
- Error embed formatting: `src/utils/discord/stream/errorUi.ts`
