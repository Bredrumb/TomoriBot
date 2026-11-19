import {
  type ChannelPromptOverride,
  getChannelPromptCacheEntry,
  setChannelPromptCache,
} from "@/utils/cache/channelPromptCacheStore";
import { channelPromptRepo } from "@/utils/db/repositories/ChannelPromptRepository";
import { log } from "@/utils/misc/logger";

export type { ChannelPromptOverride };

export async function getCachedChannelPrompt(
  serverId: number,
  channelDiscId: string,
): Promise<ChannelPromptOverride | null> {
  const cached = getChannelPromptCacheEntry(serverId, channelDiscId);
  if (cached !== undefined) return cached;

  try {
    const override = await channelPromptRepo.getChannelPromptOverride(serverId, channelDiscId);
    setChannelPromptCache(serverId, channelDiscId, override);
    return override;
  } catch (error) {
    log.error(`[ChannelPromptCache] Failed to fetch channel prompt override for ${serverId}:${channelDiscId}:`, error);
    return null;
  }
}
