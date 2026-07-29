import type { WhitelistCheckResult } from "@/types/misc/channelWhitelist";
import { whitelistRepository } from "@/utils/db/repositories/WhitelistRepository";

/**
 * Cache for channel whitelist status
 * Key format: "serverDiscId:channelDiscId:parentChannelDiscId:roleSignature"
 * TTL: 5 minutes (whitelists change infrequently)
 */
const whitelistCache = new Map<string, { result: WhitelistCheckResult; expiresAt: number }>();

/**
 * Cache statistics for monitoring
 */
let cacheHits = 0;
let cacheMisses = 0;

/**
 * Cache TTL in milliseconds (configurable via CHANNEL_WHITELIST_CACHE_TTL_MINUTES)
 * Default: 5 minutes
 */
const CACHE_TTL_MINUTES = Number.parseInt(process.env.CHANNEL_WHITELIST_CACHE_TTL_MINUTES || "5", 10);
const CACHE_TTL_MS = CACHE_TTL_MINUTES * 60 * 1000;

/**
 * Generate cache key from server and channel Discord IDs
 * @param serverDiscId - Discord server ID (snowflake)
 * @param channelDiscId - Discord channel ID (snowflake)
 * @param memberRoleDiscIds - Optional member role IDs used for role-whitelist checks
 * @param parentChannelDiscId - Optional parent channel ID for threads
 */
function getCacheKey(
  serverDiscId: string,
  channelDiscId: string,
  memberRoleDiscIds?: string[],
  parentChannelDiscId?: string,
): string {
  let roleSignature = "unknown";

  if (memberRoleDiscIds !== undefined) {
    roleSignature = memberRoleDiscIds.length > 0 ? memberRoleDiscIds.slice().sort().join(",") : "none";
  }

  const parentSig = parentChannelDiscId || "none";
  return `${serverDiscId}:${channelDiscId}:${parentSig}:${roleSignature}`;
}

/**
 * Get cached whitelist status or fetch from database
 * @param serverDiscId - Discord server ID (snowflake)
 * @param channelDiscId - Discord channel ID (snowflake)
 * @param memberRoleDiscIds - Optional member role IDs used for role-whitelist checks
 * @param parentChannelDiscId - Optional parent channel ID for threads; threads inherit whitelist from parent
 * and any channel-specific cooldown settings
 */
export async function getCachedWhitelistStatus(
  serverDiscId: string,
  channelDiscId: string,
  memberRoleDiscIds?: string[],
  parentChannelDiscId?: string,
): Promise<WhitelistCheckResult> {
  const cacheKey = getCacheKey(serverDiscId, channelDiscId, memberRoleDiscIds, parentChannelDiscId);
  const now = Date.now();

  const cached = whitelistCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    cacheHits++;
    return cached.result;
  }

  cacheMisses++;

  const result = await whitelistRepository.checkChannelWhitelist(
    serverDiscId,
    channelDiscId,
    memberRoleDiscIds,
    parentChannelDiscId,
  );

  whitelistCache.set(cacheKey, {
    result,
    expiresAt: now + CACHE_TTL_MS,
  });

  return result;
}

/**
 * Invalidate whitelist cache for a server
 * If channelDiscId is provided, only invalidate that specific channel (and any thread checks referencing it)
 * Otherwise, invalidate ALL channels for the server
 * @param serverDiscId - Discord server ID (snowflake)
 * @param channelDiscId - Optional Discord channel ID (snowflake)
 */
export function invalidateWhitelistCache(serverDiscId: string, channelDiscId?: string): void {
  const prefix = channelDiscId ? `${serverDiscId}:${channelDiscId}:` : `${serverDiscId}:`;
  for (const key of whitelistCache.keys()) {
    if (key.startsWith(prefix)) {
      whitelistCache.delete(key);
    }
  }
}

/**
 * Get cache statistics for monitoring
 */
export function getWhitelistCacheStats(): {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
} {
  return {
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: getCacheHitRate(),
    size: whitelistCache.size,
  };
}

/**
 * Calculate current cache hit rate
 * @returns Hit rate as percentage (0-100)
 */
function getCacheHitRate(): number {
  const total = cacheHits + cacheMisses;
  if (total === 0) return 0;
  return (cacheHits / total) * 100;
}

/**
 * Clear all cache entries and reset statistics
 * Useful for testing or manual cache refresh
 */
export function clearWhitelistCache(): void {
  whitelistCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}
