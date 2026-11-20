import type { LlmRow } from "@/types/db/schema";
import { llmOverrideRepo } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import {
  getChannelLlmCacheEntry,
  getChannelLlmCacheSize,
  clearChannelLlmCache,
  invalidateAllChannelLlmCacheForServer,
  invalidateChannelLlmCache,
  setChannelLlmCache,
} from "@/utils/cache/channelLlmCacheStore";

export {
  clearChannelLlmCache,
  getChannelLlmCacheSize,
  invalidateAllChannelLlmCacheForServer,
  invalidateChannelLlmCache,
  setChannelLlmCache,
};

async function getCachedOwnChannelLlm(serverId: number, channelDiscId: string): Promise<LlmRow | null> {
  const cached = getChannelLlmCacheEntry(serverId, channelDiscId);
  if (cached !== undefined) return cached;

  try {
    const llm = await llmOverrideRepo.getChannelLlmOverride(serverId, channelDiscId);
    setChannelLlmCache(serverId, channelDiscId, llm);
    return llm;
  } catch (error) {
    log.error(`[ChannelLlmCache] Failed to fetch channel LLM override for ${serverId}:${channelDiscId}:`, error);
    return null;
  }
}

// Each ID caches under its own key, so changing a parent channel override only needs to evict the parent because
// threads look up the parent separately.
export async function getCachedChannelLlm(
  serverId: number,
  channelDiscId: string,
  parentChannelDiscId?: string | null,
): Promise<LlmRow | null> {
  const own = await getCachedOwnChannelLlm(serverId, channelDiscId);
  if (own || !parentChannelDiscId) return own;
  return getCachedOwnChannelLlm(serverId, parentChannelDiscId);
}
