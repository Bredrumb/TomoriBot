import type { TomoriState } from "@/types/db/schema";
import type { StructuredContextItem } from "@/types/misc/context";
import { getGeminiTokenLimits } from "@/utils/cache/geminiCapabilityCache";
import { getNovelAITokenLimits } from "@/utils/cache/novelaiCapabilityCache";
import { getCachedContextTokens, refreshNovelAISubscription } from "@/utils/cache/novelaiSubscriptionCache";
import { getOpenRouterTokenLimits, isOpenRouterCapabilityCacheReady } from "@/utils/cache/openrouterCapabilityCache";
import { log } from "@/utils/misc/logger";
import { DEFAULT_MAX_OUTPUT_TOKENS, resolveMaxOutputTokens } from "@/utils/provider/maxOutputTokens";
import { providerUsesApiFamily } from "@/utils/provider/providerInfoRegistry";
import { decryptApiKey } from "@/utils/security/crypto";
import { truncateDialogueHistory } from "@/utils/text/contextTruncator";

/**
 * The context window history truncation works against, and the reply budget it reserves first.
 * NovelAI's `contextLength` is virtual (pre-scaled for the 4 chars/token estimator), so it is
 * comparable to estimated input tokens rather than to the model's published window.
 */
export interface ContextBudget {
  contextLength: number;
  outputReserve: number;
}

/**
 * Resolves the budget the live pipeline truncates against, or null for a provider whose window
 * TomoriBot does not know (truncation is then skipped).
 */
export async function resolveContextBudget(
  tomoriState: TomoriState,
  serverDiscId: string,
): Promise<ContextBudget | null> {
  if (
    providerUsesApiFamily(tomoriState.llm.llm_provider, "openrouter") &&
    tomoriState.llm.llm_codename !== "other-model" &&
    isOpenRouterCapabilityCacheReady()
  ) {
    const tokenLimits = getOpenRouterTokenLimits(tomoriState.llm.llm_codename);
    if (!tokenLimits || tokenLimits.contextLength <= 0 || !tokenLimits.maxCompletionTokens) return null;
    // Reserve the SAME output budget the request builder sends: the server's `/model parameters`
    // override first, then OPENROUTER_MAX_OUTPUT_TOKENS, then a flat 8192, clamped to the model's
    // reported completion ceiling. Over-reserving here drops history that would have fit.
    return {
      contextLength: tokenLimits.contextLength,
      outputReserve: resolveMaxOutputTokens({
        configured: tomoriState.config.llm_max_output_tokens,
        envRaw: process.env.OPENROUTER_MAX_OUTPUT_TOKENS,
        fallback: DEFAULT_MAX_OUTPUT_TOKENS,
        providerReportedMax: tokenLimits.maxCompletionTokens,
      }),
    };
  }

  if (providerUsesApiFamily(tomoriState.llm.llm_provider, "google-genai")) {
    const tokenLimits = getGeminiTokenLimits(tomoriState.llm.llm_codename);
    if (!tokenLimits || tokenLimits.contextLength <= 0 || !tokenLimits.maxCompletionTokens) return null;
    // Same fallback chain as the Google request builder. The extra clamp to the model-reported
    // ceiling (which the request builder omits) only bites when the resolved value exceeds what the
    // model can emit, so it never under-reserves relative to actual output.
    return {
      contextLength: tokenLimits.contextLength,
      outputReserve: resolveMaxOutputTokens({
        configured: tomoriState.config.llm_max_output_tokens,
        envRaw: process.env.GOOGLE_MAX_OUTPUT_TOKENS,
        fallback: DEFAULT_MAX_OUTPUT_TOKENS,
        providerReportedMax: tokenLimits.maxCompletionTokens,
      }),
    };
  }

  if (providerUsesApiFamily(tomoriState.llm.llm_provider, "novelai")) {
    let naiSubscriptionTokens = getCachedContextTokens(serverDiscId);
    if (naiSubscriptionTokens === undefined && tomoriState.config.api_key) {
      try {
        const tempKey = await decryptApiKey(tomoriState.config.api_key, tomoriState.config.key_version || 1);
        naiSubscriptionTokens = await refreshNovelAISubscription(serverDiscId, tempKey);
      } catch (error) {
        log.warn("Failed to refresh NovelAI subscription for context truncation; using default token limits.", error);
      }
    }
    const tokenLimits = getNovelAITokenLimits(tomoriState.llm.llm_codename, naiSubscriptionTokens);
    if (!tokenLimits || tokenLimits.contextLength <= 0 || !tokenLimits.maxCompletionTokens) return null;
    // NovelAI has no dedicated output-token env cap, so the reserve falls back to the
    // subscription-tier ceiling unless the server set a `/model parameters` override.
    return {
      contextLength: tokenLimits.contextLength,
      outputReserve: resolveMaxOutputTokens({
        configured: tomoriState.config.llm_max_output_tokens,
        envRaw: undefined,
        fallback: tokenLimits.maxCompletionTokens,
        providerReportedMax: tokenLimits.maxCompletionTokens,
      }),
    };
  }

  return null;
}

/**
 * Drops the oldest history exchanges until the context fits the provider's budget.
 */
export async function applyProviderContextTruncation(
  contextItems: StructuredContextItem[],
  tomoriState: TomoriState,
  serverDiscId: string,
): Promise<StructuredContextItem[]> {
  const budget = await resolveContextBudget(tomoriState, serverDiscId);
  if (!budget) return contextItems;

  const { truncated, historyPairsDropped, sampleItemsDropped, totalDropped } = truncateDialogueHistory(
    contextItems,
    budget.contextLength,
    budget.outputReserve,
  );
  if (totalDropped === 0) return contextItems;

  log.warn(
    `History truncation: dropped ${historyPairsDropped} history exchange pair(s) and ${sampleItemsDropped} sample dialogue item(s) for ${tomoriState.llm.llm_codename} to preserve output budget`,
  );
  return truncated;
}
