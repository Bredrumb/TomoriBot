/**
 * Shared character-based token estimator (the "Track A" fallback).
 *
 * These primitives are the single source of truth for "how many tokens is this
 * text, roughly?": used both by `/tool estimate cost` (when a provider exposes
 * no live token-counting API) and by the post-turn stat recorder
 * (`recordUsageStats`), so the two surfaces always agree on the same ratios.
 *
 * Important caveats (kept identical to the original cost.ts notes):
 * - Tokenization varies a lot by language (English vs Japanese), punctuation/JSON,
 *   and provider/model. These numbers are intentionally "ballpark".
 * - Japanese tokenizes denser than ~4 chars/token, so this over-counts JP-heavy
 *   text, so acceptable for rough statistics / cost estimates, never billing truth.
 * - Tool/function schemas (JSON) tokenize a bit denser than natural-language prose.
 */
import type { StructuredContextItem } from "@/types/misc/context";

/** Approximate characters per token for natural-language prose. */
const CHARS_PER_TOKEN_TEXT = 4;

/** Approximate characters per token for JSON-ish strings (tool/function schemas). */
const CHARS_PER_TOKEN_JSON = 3.5;

/**
 * Normalized, provider-agnostic token usage for a single provider response.
 *
 * The streaming orchestrator collapses every provider's native usage shape
 * (OpenAI `prompt_tokens`/`completion_tokens`, OpenRouter camelCase, Anthropic
 * flat `input_tokens`/`output_tokens`, Gemini `usageMetadata`) into this one
 * shape (see {@link normalizeProviderUsage}), so downstream consumers: the
 * post-turn stat recorder above all: never branch on provider.
 */
export interface TokenUsage {
  /** Total input processed, including cache reads and writes. */
  inputTokens: number;
  /** Reported cache-read subset of inputTokens; absent means unknown. */
  cacheReadTokens?: number;
  /** Reported cache-write subset of inputTokens; absent means unknown. */
  cacheWriteTokens?: number;
  /** Real completion/output tokens billed for this response (incl. reasoning). */
  outputTokens: number;
  /** Provider-reported charge in USD, when the provider returns one (OpenRouter `usage.cost`). */
  costUsd?: number;
}

/**
 * Normalize any provider's raw usage object into {@link TokenUsage}.
 *
 * Accepts the union of every shape the adapters surface in `metadata.usage`
 * (or, for Anthropic, flat on metadata): snake_case OpenAI, camelCase
 * OpenRouter, Anthropic `input_tokens`/`output_tokens`, and Gemini
 * `promptTokenCount`/`candidatesTokenCount` (+ `thoughtsTokenCount`, billed as
 * output). Returns null when no usable token counts are present, so callers can
 * cleanly fall back to the character estimate.
 *
 * @param raw - A provider usage object (or metadata that contains one), any shape.
 * @returns Normalized usage, or null if nothing parseable was found.
 */
export function normalizeProviderUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;

  if (u.usage && typeof u.usage === "object") {
    const nested = normalizeProviderUsage(u.usage);
    if (nested) return nested;
  }

  const num = (...keys: string[]): number => {
    for (const key of keys) {
      const value = u[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return 0;
  };

  // Input: OpenAI/OpenRouter prompt tokens, Anthropic input, Gemini prompt count.
  let inputTokens = num("prompt_tokens", "promptTokens", "input_tokens", "inputTokens", "promptTokenCount");
  const optionalCount = (...values: unknown[]): number | undefined =>
    values.find((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const details = u.prompt_tokens_details ?? u.promptTokensDetails;
  const promptDetails = details && typeof details === "object" ? (details as Record<string, unknown>) : {};
  const cacheReadTokens = optionalCount(
    u.cacheReadTokens,
    u.cache_read_input_tokens,
    promptDetails.cached_tokens,
    promptDetails.cachedTokens,
    u.cachedContentTokenCount,
    u.prompt_cache_hit_tokens,
  );
  const cacheWriteTokens = optionalCount(
    u.cacheWriteTokens,
    u.cache_creation_input_tokens,
    promptDetails.cache_write_tokens,
    promptDetails.cacheWriteTokens,
  );
  // Add cache counts only for Anthropic because its input_tokens excludes cached input.
  if (typeof u.input_tokens === "number") {
    inputTokens += (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0);
  }
  // Output: completion/output tokens, Gemini candidates count. Gemini bills
  //    thinking tokens separately (`thoughtsTokenCount`) at the output rate, so
  //    add them to avoid undercounting reasoning models.
  const outputTokens =
    num("completion_tokens", "completionTokens", "output_tokens", "outputTokens", "candidatesTokenCount") +
    num("thoughtsTokenCount");

  if (inputTokens <= 0 && outputTokens <= 0) return null;
  const usage: TokenUsage = { inputTokens, outputTokens };
  if (cacheReadTokens !== undefined) usage.cacheReadTokens = Math.min(cacheReadTokens, Math.max(0, inputTokens));
  if (cacheWriteTokens !== undefined) usage.cacheWriteTokens = Math.min(cacheWriteTokens, Math.max(0, inputTokens));
  const cost = optionalCount(u.costUsd, u.cost);
  if (cost !== undefined) usage.costUsd = cost;
  return usage;
}

/**
 * Sum the real per-response usage across all stream segments of one turn.
 *
 * A tool-using turn issues one provider request per tool-loop iteration, each
 * returning its own {@link TokenUsage}; the provider bills each request, so the
 * turn's true token cost is the sum across segments (both input and output).
 * Returns null when no segment surfaced real usage, signalling the caller to
 * fall back to the character estimate for the whole turn.
 *
 * Cache fields and cost are known only when every segment that reported usage reported that field.
 */
export function sumTurnUsage(streamResults: ReadonlyArray<{ usage?: TokenUsage }>): TokenUsage | null {
  let total: TokenUsage | null = null;
  for (const result of streamResults) {
    const usage = result.usage;
    if (!usage) continue;
    if (!total) {
      total = { ...usage };
      continue;
    }
    total.inputTokens += usage.inputTokens;
    total.outputTokens += usage.outputTokens;
    for (const field of ["cacheReadTokens", "cacheWriteTokens", "costUsd"] as const) {
      if (total[field] !== undefined && usage[field] !== undefined) total[field] += usage[field];
      else delete total[field];
    }
  }
  return total;
}

/**
 * Estimate token count from a prose character count.
 */
export function charsToTokensText(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN_TEXT);
}

/**
 * Estimate token count for JSON-ish strings (tools, schemas), which tokenize
 * slightly denser than prose.
 */
export function charsToTokensJson(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN_JSON);
}

/**
 * Approximate input tokens for an already-built context.
 *
 * Sums the character length of every text part across all context items and applies
 * the standard text ratio ({@link charsToTokensText}). Non-text parts (images/videos)
 * are intentionally not counted, so this is a deliberately rough estimate.
 * @param contextItems - The assembled runtime-parity context
 * @returns Estimated input token count
 */
export function estimateContextItemsTokens(contextItems: StructuredContextItem[]): number {
  let totalChars = 0;
  for (const item of contextItems) {
    for (const part of item.parts) {
      if (part.type === "text") {
        totalChars += part.text.length;
      }
    }
  }
  return charsToTokensText(totalChars);
}
