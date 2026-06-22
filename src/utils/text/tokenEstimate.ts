/**
 * Shared character-based token estimator (the "Track A" fallback).
 *
 * These primitives are the single source of truth for "how many tokens is this
 * text, roughly?" — used both by `/tool estimate cost` (when a provider exposes
 * no live token-counting API) and by the post-turn stat recorder
 * (`recordUsageStats`), so the two surfaces always agree on the same ratios.
 *
 * Important caveats (kept identical to the original cost.ts notes):
 * - Tokenization varies a lot by language (English vs Japanese), punctuation/JSON,
 *   and provider/model. These numbers are intentionally "ballpark".
 * - Japanese tokenizes denser than ~4 chars/token, so this over-counts JP-heavy
 *   text — acceptable for rough statistics / cost estimates, never billing truth.
 * - Tool/function schemas (JSON) tokenize a bit denser than natural-language prose.
 */
import type { StructuredContextItem } from "@/types/misc/context";

/** Approximate characters per token for natural-language prose. */
export const CHARS_PER_TOKEN_TEXT = 4;

/** Approximate characters per token for JSON-ish strings (tool/function schemas). */
export const CHARS_PER_TOKEN_JSON = 3.5;

/**
 * Estimate token count from a prose character count.
 * @param chars - Number of characters
 * @returns Estimated token count
 */
export function charsToTokensText(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN_TEXT);
}

/**
 * Estimate token count for JSON-ish strings (tools, schemas), which tokenize
 * slightly denser than prose.
 * @param chars - Number of characters
 * @returns Estimated token count
 */
export function charsToTokensJson(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN_JSON);
}

/**
 * Approximate input tokens for an already-built context.
 *
 * Sums the character length of every text part across all context items and applies
 * the standard text ratio ({@link charsToTokensText}). Non-text parts (images/videos)
 * are intentionally not counted — this is a deliberately rough estimate.
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
