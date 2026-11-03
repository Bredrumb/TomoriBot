import type { TomoriState } from "@/types/db/schema";
import type { StructuredContextItem } from "@/types/misc/context";
import { log } from "@/utils/misc/logger";
import { resolveChatMaxOutputTokens } from "@/utils/provider/maxOutputTokens";
import { resolveModelLimits } from "@/utils/provider/modelLimits";
import { normalizeProviderName, providerUsesApiFamily } from "@/utils/provider/providerInfoRegistry";
import { truncateDialogueHistory } from "@/utils/text/contextTruncator";

/**
 * The context window history truncation works against, and the reply budget it reserves first.
 */
export interface ContextBudget {
  exact?: boolean;
  contextLength: number;
  outputReserve: number;
}

/**
 * Resolves the budget the live pipeline truncates against, or null for a provider whose window
 * TomoriBot does not know (truncation is then skipped).
 */
export async function resolveContextBudget(tomoriState: TomoriState): Promise<ContextBudget | null> {
  if (providerUsesApiFamily(tomoriState.llm.llm_provider, "novelai")) {
    return null;
  }

  const limits = await resolveModelLimits(tomoriState);
  if (!limits.contextWindow) return null;
  // Reserve exactly what the request builder sends: over-reserving drops history that would have fit.
  // The one exception is an OpenRouter model with no known ceiling, whose request omits max_tokens:
  // the default reply budget is reserved so a long channel still trims instead of overflowing.
  return {
    contextLength: limits.contextWindow,
    outputReserve: resolveChatMaxOutputTokens({
      provider: normalizeProviderName(tomoriState.llm.llm_provider),
      configured: tomoriState.config.llm_max_output_tokens,
      modelMaxOutputTokens: limits.maxOutputTokens,
      contextWindow: limits.contextWindow,
    }),
  };
}

/**
 * Drops the oldest history exchanges until the context fits the provider's budget.
 */
export async function applyProviderContextTruncation(
  contextItems: StructuredContextItem[],
  tomoriState: TomoriState,
  reservedTailItems: StructuredContextItem[] = [],
): Promise<StructuredContextItem[]> {
  const budget = await resolveContextBudget(tomoriState);
  if (!budget) return contextItems;

  const { truncated, historyPairsDropped, sampleItemsDropped, totalDropped } = truncateDialogueHistory(
    contextItems,
    budget.contextLength,
    budget.outputReserve,
    reservedTailItems,
  );
  if (totalDropped === 0) return contextItems;

  log.warn(
    `History truncation: dropped ${historyPairsDropped} history exchange pair(s) and ${sampleItemsDropped} sample dialogue item(s) for ${tomoriState.llm.llm_codename} to preserve output budget`,
  );
  return truncated;
}
