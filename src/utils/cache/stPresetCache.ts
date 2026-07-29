/**
 * SillyTavern Preset Cache
 *
 * In-memory cache for the active ST preset and its nodes per server.
 * Avoids a DB query on every buildContext() call.
 *
 * Cache flow:
 *   1. getCachedActivePreset(serverId) checks in-memory cache
 *   2. On miss/stale, loads from DB (loadActivePreset + loadAllNodes)
 *   3. Returns { preset, nodes } or null if no active preset
 *
 * Invalidation:
 *   - Called by stPresetDb.ts after any write (activate, deactivate, toggle, delete)
 *   - Clears the entry for the affected server_id
 */

import type { StPresetRow, StPresetNodeRow } from "@/types/db/schema";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";
import { log } from "@/utils/misc/logger";

// ─── Types ──────────────────────────────────────────────────────────────

/** Cached preset data: the active preset row + all its nodes */
export interface CachedPresetData {
  preset: StPresetRow;
  nodes: StPresetNodeRow[];
}

/** Internal cache entry with timestamp for TTL */
interface CacheEntry {
  data: CachedPresetData | null; // null = no active preset for this server
  cachedAt: number;
}

// ─── Configuration ──────────────────────────────────────────────────────

/**
 * Cache duration: configurable via env, default 10 minutes.
 * Matches the tomoriStateCache TTL since preset changes are similarly infrequent.
 */
const CACHE_DURATION_MS = (Number(process.env.ST_PRESET_CACHE_TTL_MINUTES) || 10) * 60 * 1000;

// ─── Cache Storage ──────────────────────────────────────────────────────

/** In-memory cache map: server_id (numeric) -> cache entry */
const cache = new Map<number, CacheEntry>();

/** Cache statistics for monitoring */
let cacheHits = 0;
let cacheMisses = 0;

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Get the active ST preset and its nodes for a server, using the in-memory cache.
 * Returns null if no preset is active for this server.
 *
 * @param serverId - Internal numeric server_id (FK to servers table)
 * @returns Cached preset data or null
 */
export async function getCachedActivePreset(serverId: number): Promise<CachedPresetData | null> {
  const now = Date.now();
  const entry = cache.get(serverId);

  // Check cache freshness
  if (entry) {
    const cacheAge = now - entry.cachedAt;
    if (cacheAge < CACHE_DURATION_MS) {
      cacheHits++;
      return entry.data;
    }
    // Stale — fall through to refresh
  }

  // Cache miss or stale — load from DB
  cacheMisses++;
  try {
    const preset = await presetRepository.loadActivePreset(serverId);

    if (!preset) {
      // No active preset — cache the negative result to avoid repeated queries
      cache.set(serverId, { data: null, cachedAt: now });
      return null;
    }

    // Validate preset_id exists (should always be present on loaded DB rows)
    if (preset.preset_id == null) {
      log.error(`[ST Preset Cache] Active preset for server_id ${serverId} has no preset_id — skipping`);
      cache.set(serverId, { data: null, cachedAt: now });
      return null;
    }

    // Load all nodes for the active preset
    const nodes = await presetRepository.loadAllNodes(preset.preset_id);

    const data: CachedPresetData = { preset, nodes };
    cache.set(serverId, { data, cachedAt: now });
    return data;
  } catch (error) {
    log.error(`[ST Preset Cache] Failed to load active preset for server_id ${serverId}`, error);

    // Return stale data if available (graceful fallback)
    if (entry) {
      log.warn(`[ST Preset Cache] Returning stale cache for server_id ${serverId} due to error`);
      return entry.data;
    }

    return null;
  }
}

/**
 * Invalidate the cached preset data for a specific server.
 * Must be called after any write operation that affects the active preset
 * or its nodes (activate, deactivate, toggle, delete).
 *
 * @param serverId - Internal numeric server_id to invalidate
 */
export function invalidateStPresetCache(serverId: number): void {
  cache.delete(serverId);
}

/**
 * Clear the entire preset cache. Used during shutdown or testing.
 */
export function clearStPresetCache(): void {
  cache.clear();
}

/**
 * Get cache statistics for monitoring/debugging.
 * @returns Hit/miss counts and current cache size
 */
export function getStPresetCacheStats(): {
  hits: number;
  misses: number;
  size: number;
} {
  return { hits: cacheHits, misses: cacheMisses, size: cache.size };
}
