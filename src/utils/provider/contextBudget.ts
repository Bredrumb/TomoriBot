import type { TomoriState } from "@/types/db/schema";
import type { StructuredContextItem } from "@/types/misc/context";
import { log } from "@/utils/misc/logger";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import { resolveChatMaxOutputTokens } from "@/utils/provider/maxOutputTokens";
import { resolveModelLimits } from "@/utils/provider/modelLimits";
import { normalizeProviderName, providerUsesApiFamily } from "@/utils/provider/providerInfoRegistry";
import { truncateDialogueHistory } from "@/utils/text/contextTruncator";

export interface ContextBudget {
  exact?: boolean;
  contextLength: number;
  outputReserve: number;
}

export async function resolveContextBudget(
  tomoriState: TomoriState,
  refreshLiveLimits = true,
): Promise<ContextBudget | null> {
  if (providerUsesApiFamily(tomoriState.llm.llm_provider, "novelai")) {
    return null;
  }

  const limits = await resolveModelLimits(tomoriState, refreshLiveLimits);
  if (!limits.contextWindow) return null;
  // Match the output cap so history stays intact, except unknown-ceiling OpenRouter models reserve default budget.
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
    normalizeMessageFetchLimit(tomoriState.config.message_fetch_limit),
  );
  if (totalDropped === 0) return truncated;

  log.warn(
    `History truncation: dropped ${historyPairsDropped} history exchange pair(s) and ${sampleItemsDropped} sample dialogue item(s) for ${tomoriState.llm.llm_codename} to preserve output budget`,
  );
  return truncated;
}
