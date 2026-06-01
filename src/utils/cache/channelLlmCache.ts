/**
 * Channel LLM Override Cache
 * Provides in-memory TTL caching for per-channel LLM model overrides.
 * Prevents a DB query per-message for the channel override lookup step.
 *
 * Priority chain (highest → lowest):
 *   1. persona_llm  — persona-specific override stored in persona_configs
 *   2. channel LLM  — this cache / channel_llm_overrides table
 *   3. global llm   — server_model_configs.llm_id (the existing TomoriState.llm)
 */

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

/**
 * Gets the channel-level LLM override for a given server/channel pair.
 * Checks the in-memory cache first; falls back to the database on miss.
 * Caches negative results (null) to avoid repeated DB round-trips for channels without overrides.
 *
 * @param serverId - Database integer server ID
 * @param channelDiscId - Discord channel snowflake ID
 * @returns The overriding LlmRow, or null if no channel override is set
 */
export async function getCachedChannelLlm(serverId: number, channelDiscId: string): Promise<LlmRow | null> {
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
