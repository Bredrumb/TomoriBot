/**
 * Channel System Prompt Override Cache
 * Provides in-memory TTL caching for per-channel system prompt overrides.
 * Prevents a DB query per-message for the channel prompt lookup step.
 *
 * When a row exists for a channel, its prompt either appends after
 * (mode = "append") or fully replaces (mode = "replace") the server-level
 * system prompt in that channel only.
 */

import {
  type ChannelPromptOverride,
  clearChannelPromptCache,
  getChannelPromptCacheEntry,
  getChannelPromptCacheSize,
  invalidateAllChannelPromptCacheForServer,
  invalidateChannelPromptCache,
  setChannelPromptCache,
} from "@/utils/cache/channelPromptCacheStore";
import { channelPromptRepo } from "@/utils/db/repositories/ChannelPromptRepository";
import { log } from "@/utils/misc/logger";

export type { ChannelPromptOverride };
export {
  clearChannelPromptCache,
  getChannelPromptCacheSize,
  invalidateAllChannelPromptCacheForServer,
  invalidateChannelPromptCache,
  setChannelPromptCache,
};

/**
 * Gets the channel-level system prompt override for a given server/channel pair.
 * Checks the in-memory cache first; falls back to the database on miss.
 * Caches negative results (null) to avoid repeated DB round-trips for channels without overrides.
 *
 * @param serverId      - Database integer server ID
 * @param channelDiscId - Discord channel snowflake ID
 * @returns The override `{ prompt, mode }`, or null if no channel override is set
 */
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
