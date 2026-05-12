/**
 * Channel LLM Override Cache
 * Provides in-memory TTL caching for per-channel LLM model overrides.
 * Prevents a DB query per-message for the channel override lookup step.
 *
 * Priority chain (highest → lowest):
 *   1. persona_llm  — persona-specific override stored in persona_configs
 *   2. channel LLM  — this cache / channel_llm_overrides table
 *   3. global llm   — tomori_configs.llm_id (the existing TomoriState.llm)
 */

import type { LlmRow } from "@/types/db/schema";
import { getChannelLlmOverride } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";

/**
 * In-memory store keyed by "serverId:channelDiscId" (e.g. "42:1234567890")
 * Value is null when we know there is NO override (negative cache entry),
 * or an LlmRow when an override is set.
 */
const channelLlmCache = new Map<string, { llm: LlmRow | null; expiresAt: number }>();

/**
 * Cache TTL matches TomoriState cache TTL to keep effective-LLM results consistent.
 * Defaults to 10 minutes (same as TOMORI_STATE_CACHE_TTL_MINUTES).
 */
const CACHE_TTL_MINUTES = Number.parseInt(process.env.TOMORI_STATE_CACHE_TTL_MINUTES || "10", 10);
const CACHE_TTL_MS = CACHE_TTL_MINUTES * 60 * 1000;

/**
 * Generate cache key from database server ID and Discord channel ID.
 * Uses DB integer ID (not Discord snowflake) for server to match the FK in channel_llm_overrides.
 *
 * @param serverId - Database integer server ID
 * @param channelDiscId - Discord channel snowflake ID
 */
function getCacheKey(serverId: number, channelDiscId: string): string {
  return `${serverId}:${channelDiscId}`;
}

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
  const key = getCacheKey(serverId, channelDiscId);
  const now = Date.now();

  // 1. Check in-memory cache (includes negative/null entries)
  const cached = channelLlmCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.llm; // may be null — indicates no override
  }

  // 2. Cache miss — fetch from database
  try {
    const llm = await getChannelLlmOverride(serverId, channelDiscId);

    // 3. Store result (including null) in cache
    channelLlmCache.set(key, { llm, expiresAt: now + CACHE_TTL_MS });

    return llm;
  } catch (error) {
    log.error(`[ChannelLlmCache] Failed to fetch channel LLM override for ${key}:`, error);
    return null; // fail open — fall back to global model
  }
}

/**
 * Directly populate the cache after a successful channel override write.
 * Call this immediately after setChannelLlmOverride() succeeds.
 *
 * @param serverId - Database integer server ID
 * @param channelDiscId - Discord channel snowflake ID
 * @param llm - The LlmRow that was just written (or null to cache "no override")
 */
export function setChannelLlmCache(serverId: number, channelDiscId: string, llm: LlmRow | null): void {
  const key = getCacheKey(serverId, channelDiscId);
  channelLlmCache.set(key, { llm, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Removes the cached entry for a specific channel so the next access re-fetches from DB.
 * Must be called after any write to channel_llm_overrides for this channel.
 *
 * @param serverId - Database integer server ID
 * @param channelDiscId - Discord channel snowflake ID
 */
export function invalidateChannelLlmCache(serverId: number, channelDiscId: string): void {
  const key = getCacheKey(serverId, channelDiscId);
  channelLlmCache.delete(key);
}

/**
 * Returns the current number of entries held in the channel-LLM cache.
 * Used by the cache metrics logger to track in-memory growth over time.
 */
export function getChannelLlmCacheSize(): number {
  return channelLlmCache.size;
}

/**
 * Removes all cached channel overrides for a server (e.g., on full server reset).
 *
 * @param serverId - Database integer server ID
 */
export function invalidateAllChannelLlmCacheForServer(serverId: number): void {
  const prefix = `${serverId}:`;
  for (const key of channelLlmCache.keys()) {
    if (key.startsWith(prefix)) {
      channelLlmCache.delete(key);
    }
  }
}
