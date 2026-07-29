import type { GuildMcpServerRow } from "@/types/db/schema";
import { log } from "@/utils/misc/logger";
import { mcpRepository } from "@/utils/db/repositories/McpRepository";

/**
 * Cache entry for a guild's MCP server configurations.
 * Stores all rows (enabled + disabled) so callers can filter in-memory.
 */
interface GuildMcpConfigCacheEntry {
  configs: GuildMcpServerRow[];
  cachedAt: number;
}

/**
 * In-memory cache: serverId (int) -> cache entry.
 * Keyed by internal server_id (not Discord snowflake) for direct DB FK alignment.
 */
const cache = new Map<number, GuildMcpConfigCacheEntry>();

/**
 * Cache TTL in milliseconds. Default: 5 minutes.
 * Configurable via GUILD_MCP_CONFIG_CACHE_TTL_MINUTES env var.
 */
const CACHE_TTL_MS = (Number(process.env.GUILD_MCP_CONFIG_CACHE_TTL_MINUTES) || 5) * 60 * 1000;

/** Cache statistics for monitoring */
let cacheHits = 0;
let cacheMisses = 0;

/**
 * Get cached guild MCP server configurations for a server.
 * Returns all rows (enabled + disabled) from cache or DB.
 *
 * Cache flow:
 * 1. Check in-memory cache
 *    - HIT & FRESH → return immediately (0 DB queries)
 *    - MISS or STALE → load from DB, cache, and return
 *
 * @param serverId - Internal server_id (FK to servers table)
 * @returns Array of GuildMcpServerRow (may be empty if none registered)
 */
export async function getCachedGuildMcpConfigs(serverId: number): Promise<GuildMcpServerRow[]> {
  const now = Date.now();
  const entry = cache.get(serverId);

  // Cache hit check
  if (entry) {
    const age = now - entry.cachedAt;
    if (age < CACHE_TTL_MS) {
      cacheHits++;
      return entry.configs;
    }
    // Stale — fall through to refresh
  }

  // Cache miss or stale — load from DB via repository
  cacheMisses++;

  try {
    const configs = await mcpRepository.loadGuildMcpConfigs(serverId);

    // Cache the result (even if empty — avoids repeated DB queries for guilds with no MCP servers)
    cache.set(serverId, {
      configs,
      cachedAt: now,
    });

    return configs;
  } catch (error) {
    log.error(`[GuildMcpConfigCache] Failed to load configs for server ${serverId}`, error);

    // Return stale cache if available (graceful degradation)
    if (entry) {
      log.warn(`[GuildMcpConfigCache] Returning stale cache for server ${serverId} due to error`);
      return entry.configs;
    }

    return [];
  }
}

/**
 * Get only enabled guild MCP server configurations.
 * Convenience wrapper that filters getCachedGuildMcpConfigs().
 *
 * @param serverId - Internal server_id
 * @returns Array of enabled GuildMcpServerRow
 */
export async function getCachedEnabledGuildMcpConfigs(serverId: number): Promise<GuildMcpServerRow[]> {
  const configs = await getCachedGuildMcpConfigs(serverId);
  return configs.filter((c) => c.is_enabled);
}

/**
 * Invalidate the cache for a specific server.
 * Must be called after any DB write (insert/delete/toggle) to ensure consistency.
 *
 * @param serverId - Internal server_id to invalidate
 */
export function invalidateGuildMcpConfigCache(serverId: number): void {
  cache.delete(serverId);
}

/**
 * Clear the entire guild MCP config cache.
 * Useful for testing or manual refresh.
 */
export function clearGuildMcpConfigCache(): void {
  cache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

/**
 * Get cache statistics for monitoring and debugging.
 *
 * @returns Object with hits, misses, hit rate, and current cache size
 */
export function getGuildMcpConfigCacheStats(): {
  hits: number;
  misses: number;
  hitRate: string;
  cacheSize: number;
} {
  const total = cacheHits + cacheMisses;
  const hitRate = total > 0 ? `${((cacheHits / total) * 100).toFixed(2)}%` : "N/A";

  return {
    hits: cacheHits,
    misses: cacheMisses,
    hitRate,
    cacheSize: cache.size,
  };
}
