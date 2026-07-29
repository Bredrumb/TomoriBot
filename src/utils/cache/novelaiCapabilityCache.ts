import type { ModelTokenLimits } from "./openrouterCapabilityCache";

/**
 * Kayra's actual output token cap (max_length sent to the API).
 * Matches getKayraParameters() in novelaiService.ts.
 */
const KAYRA_MAX_COMPLETION = 150;

/**
 * Fallback Kayra context limit used when the subscription API is unavailable.
 *
 * Set NAI_KAYRA_CONTEXT_LIMIT to your subscription tier's actual limit:
 *   Tablet: 4_096 tokens
 *   Scroll: 8_192 tokens (default)
 *   Opus:   varies (8_192–12_288+)
 */
const NAI_KAYRA_CONTEXT_LIMIT_FALLBACK = Number.parseInt(process.env.NAI_KAYRA_CONTEXT_LIMIT ?? "8192", 10);

/**
 * Kayra's actual characters-per-token ratio.
 *
 * Kayra tokenizes at roughly 3.0–3.5 chars/token depending on content.
 * The contextTruncator assumes 4 chars/token, and its 10% safety margin
 * alone is insufficient to cover this ~14% gap. The virtual contextLength
 * computed by getKayraVirtualContextLength() compensates for this.
 *
 * Configured via NAI_KAYRA_CHARS_PER_TOKEN env var (default: "3.5").
 */
const NAI_KAYRA_CHARS_PER_TOKEN = Number.parseFloat(process.env.NAI_KAYRA_CHARS_PER_TOKEN ?? "3.5");

/**
 * Derives the virtual contextLength to pass to contextTruncator for Kayra.
 *
 * contextTruncator estimates tokens at 4 chars/token. Kayra actually tokenizes
 * at NAI_KAYRA_CHARS_PER_TOKEN (~3.5 chars/token), so the truncator's budget
 * needs to be scaled down to prevent overshoot. The formula:
 *
 *   virtual = floor((realLimit - maxCompletion) * (actualCPT / 4) / 0.9) + maxCompletion
 *
 * Example with Scroll tier (8192 real, 3.5 chars/token):
 *   = floor(8042 * 0.875 / 0.9) + 150 ≈ 7_969
 *
 * @param realContextLimit - The actual tier context limit (resolved from tier number)
 * @returns Virtual contextLength for contextTruncator
 */
export function getKayraVirtualContextLength(realContextLimit: number): number {
  return (
    Math.floor(((realContextLimit - KAYRA_MAX_COMPLETION) * (NAI_KAYRA_CHARS_PER_TOKEN / 4)) / 0.9) +
    KAYRA_MAX_COMPLETION
  );
}

/**
 * Static map for non-Kayra NovelAI models.
 * Kayra is resolved dynamically via subscriptionContextTokens in getNovelAITokenLimits().
 */
const STATIC_NOVELAI_TOKEN_LIMITS: Readonly<Record<string, ModelTokenLimits>> = {
  /**
   * GLM-4.6 via OpenAI-compatible endpoint — generous output cap, intentionally reduced
   * contextLength to compensate for the contextTruncator's 4 chars/token assumption.
   *
   * GLM-4.6 actual tokenization: ~2.2–2.5 chars/token (vs 4 assumed).
   * Lowering to 8_192 makes safeInputBudget = floor((8192 - 4096) * 0.9) = 3_686
   * estimated tokens — truncation fires correctly before hitting the real 12_288 ceiling.
   *
   * The hard 12_288 ceiling is enforced separately by the dynamic max_length cap
   * in novelaiStreamAdapter.ts (NAI_GLM_CONTEXT_LIMIT env var).
   */
  "glm-4-6": { contextLength: 8_192, maxCompletionTokens: 4096 },
};

/**
 * Gets the token limits for a known NovelAI model.
 *
 * For Kayra (kayra-v1): uses subscriptionContextTokens (from GET /user/subscription)
 * to compute a correct virtual contextLength. Falls back to NAI_KAYRA_CONTEXT_LIMIT
 * env var (default: 8192) if no subscription data is available.
 *
 * For all other models: returns static limits from the compile-time map.
 *
 * Returns undefined for unknown models so truncation is skipped safely.
 *
 * @param modelCodename - Model codename (e.g., "glm-4-6", "kayra-v1")
 * @param subscriptionContextTokens - Resolved Kayra context limit from the subscription cache (optional)
 * @returns ModelTokenLimits if the model is known, undefined otherwise
 */
export function getNovelAITokenLimits(
  modelCodename: string,
  subscriptionContextTokens?: number,
): ModelTokenLimits | undefined {
  if (modelCodename === "kayra-v1") {
    // Prefer live subscription data; fall back to env var
    const realLimit = subscriptionContextTokens ?? NAI_KAYRA_CONTEXT_LIMIT_FALLBACK;
    return {
      contextLength: getKayraVirtualContextLength(realLimit),
      maxCompletionTokens: KAYRA_MAX_COMPLETION,
    };
  }

  return STATIC_NOVELAI_TOKEN_LIMITS[modelCodename];
}
