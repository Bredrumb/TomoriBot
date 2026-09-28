import type { ModelTokenLimits } from "./openrouterCapabilityCache";

/**
 * Kayra's actual output token cap (max_length sent to the API).
 * Matches getKayraParameters() in novelaiService.ts.
 */
const KAYRA_MAX_COMPLETION = 150;

/**
 * Characters-per-token ratio for Kayra/Erato context estimation.
 *
 * Kayra tokenizes at ~3.0-3.5 chars/token, denser than the 4 chars/token assumed by
 * contextTruncator. Drives the virtual context length below and the stream adapter's
 * dynamic max_length cap.
 */
export const NAI_KAYRA_CHARS_PER_TOKEN = 3.5;

/**
 * Hard context window ceiling (input + output tokens combined) for Kayra/Erato when the
 * subscription API has not reported the guild's tier yet: the Scroll tier's 8192
 * (Tablet is 4096, Opus varies).
 */
export const NAI_KAYRA_CONTEXT_LIMIT = 8192;

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
   * GLM-4.6 via OpenAI-compatible endpoint - generous output cap, intentionally reduced
   * contextLength to compensate for the contextTruncator's 4 chars/token assumption.
   *
   * GLM-4.6 actual tokenization: ~2.2-2.5 chars/token (vs 4 assumed).
   * Lowering to 8_192 makes safeInputBudget = floor((8192 - 4096) * 0.9) = 3_686
   * estimated tokens ; truncation fires correctly before hitting the real 12_288 ceiling.
   *
   * The hard 12_288 ceiling is enforced separately by the dynamic max_length cap
   * in novelaiStreamAdapter.ts (NAI_GLM_CONTEXT_LIMIT).
   */
  "glm-4-6": { contextLength: 8_192, maxCompletionTokens: 4096 },
};

/**
 * Gets the token limits for a known NovelAI model.
 *
 * For Kayra (kayra-v1): uses subscriptionContextTokens (from GET /user/subscription)
 * to compute a correct virtual contextLength. Falls back to the shared
 * NAI_KAYRA_CONTEXT_LIMIT when no subscription data is available.
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
    const realLimit = subscriptionContextTokens ?? NAI_KAYRA_CONTEXT_LIMIT;
    return {
      contextLength: getKayraVirtualContextLength(realLimit),
      maxCompletionTokens: KAYRA_MAX_COMPLETION,
    };
  }

  return STATIC_NOVELAI_TOKEN_LIMITS[modelCodename];
}
