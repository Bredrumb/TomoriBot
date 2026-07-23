/**
 * Shared resolution for the "max output tokens" figure used in two places that
 * MUST agree:
 *
 * 1. The provider request builders (e.g. `openrouterProvider`, `googleProvider`),
 *    which send it as `max_tokens` / `maxOutputTokens`.
 * 2. The context truncator (`applyProviderContextTruncation`), which reserves
 *    this many tokens for the reply *before* deciding how much dialogue history
 *    to keep.
 *
 * When these two figures drift, the truncator over-reserves output budget and
 * silently drops chat history that would otherwise fit — the "TomoriBot forgets
 * everything after each message" class of bug. Keeping the resolution in one
 * place makes the intended parity explicit.
 *
 * Resolution order (highest priority first):
 *   1. `configured` — the server's `/model parameters` output-token override
 *      (`config.llm_max_output_tokens`).
 *   2. `envRaw` — the provider-specific env cap (e.g. `OPENROUTER_MAX_OUTPUT_TOKENS`,
 *      `GOOGLE_MAX_OUTPUT_TOKENS`), when set to a usable positive integer.
 *   3. `fallback` — the caller's last-resort value. Providers that want to fall
 *      back to the model's own reported ceiling pass that ceiling here; providers
 *      that want a flat default (OpenRouter's historical 8192) pass that instead.
 *
 * The result is always clamped to `providerReportedMax` when that is a positive
 * number, so neither the reservation nor the request can exceed what the model
 * can actually emit.
 */

/** Historical flat fallback used by the OpenRouter path when no override/env is set. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

/**
 * Parses a positive integer from a raw env string.
 *
 * @param raw - Raw env value (may be undefined/empty/non-numeric).
 * @returns The parsed positive integer, or `undefined` so callers fall through
 *          to the next resolution tier.
 */
function parsePositiveIntEnv(raw: string | undefined): number | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Resolves the output-token budget to reserve (truncation) or request (provider).
 *
 * @param params.configured - `config.llm_max_output_tokens` server override (nullable/optional).
 * @param params.envRaw - Raw provider-specific env override string, or undefined.
 * @param params.fallback - Value used when neither the override nor the env cap is set.
 * @param params.providerReportedMax - The model's reported max completion tokens; when a
 *   positive number, the result is clamped to it so we never exceed the model's ceiling.
 * @returns The resolved output-token budget (always a positive integer).
 */
export function resolveMaxOutputTokens(params: {
  configured: number | null | undefined;
  envRaw: string | undefined;
  fallback: number;
  providerReportedMax?: number;
}): number {
  const { configured, envRaw, fallback, providerReportedMax } = params;

  // 1. Highest-priority intent: server override → provider env cap → caller fallback.
  const desired = (configured ?? parsePositiveIntEnv(envRaw) ?? fallback) || fallback;

  // 2. Never reserve/request more than the model can actually emit.
  if (typeof providerReportedMax === "number" && providerReportedMax > 0) {
    return Math.max(1, Math.min(providerReportedMax, desired));
  }
  return Math.max(1, desired);
}
