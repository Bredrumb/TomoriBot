import { z } from "zod";
import { broadcastInvalidation, registerInvalidation, invalidationDatabaseId } from "@/utils/cache/invalidationBus";

import type { StPresetRow, StPresetNodeRow } from "@/types/db/schema";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";
import { log } from "@/utils/misc/logger";

export interface CachedPresetData {
  preset: StPresetRow;
  nodes: StPresetNodeRow[];
}

interface CacheEntry {
  data: CachedPresetData | null; // null = no active preset for this server
  cachedAt: number;
}

// Matches the tomoriStateCache TTL since preset changes are similarly infrequent.
const CACHE_DURATION_MS = 10 * 60 * 1000;

const cache = new Map<number, CacheEntry>();

let cacheHits = 0;
let cacheMisses = 0;

export async function getCachedActivePreset(serverId: number): Promise<CachedPresetData | null> {
  const now = Date.now();
  const entry = cache.get(serverId);

  if (entry) {
    const cacheAge = now - entry.cachedAt;
    if (cacheAge < CACHE_DURATION_MS) {
      cacheHits++;
      return entry.data;
    }
  }

  // Cache miss or stale , so load from DB
  cacheMisses++;
  try {
    const preset = await presetRepository.loadActivePreset(serverId);

    if (!preset) {
      // No active preset , so cache the negative result to avoid repeated queries
      cache.set(serverId, { data: null, cachedAt: now });
      return null;
    }

    if (preset.preset_id == null) {
      log.error(`[ST Preset Cache] Active preset for server_id ${serverId} has no preset_id — skipping`);
      cache.set(serverId, { data: null, cachedAt: now });
      return null;
    }

    const nodes = await presetRepository.loadAllNodes(preset.preset_id);

    const data: CachedPresetData = { preset, nodes };
    cache.set(serverId, { data, cachedAt: now });
    return data;
  } catch (error) {
    log.error(`[ST Preset Cache] Failed to load active preset for server_id ${serverId}`, error);

    if (entry) {
      log.warn(`[ST Preset Cache] Returning stale cache for server_id ${serverId} due to error`);
      return entry.data;
    }

    return null;
  }
}

export function invalidateStPresetCache(serverId: number): void {
  cache.delete(serverId);
  broadcastInvalidation("stPreset", [[String(serverId)]]);
}

export function clearStPresetCache(): void {
  cache.clear();
}

export function getStPresetCacheStats(): {
  hits: number;
  misses: number;
  size: number;
} {
  return { hits: cacheHits, misses: cacheMisses, size: cache.size };
}

registerInvalidation(
  "stPreset",
  z.tuple([invalidationDatabaseId]),
  ([server]) => invalidateStPresetCache(server),
  clearStPresetCache,
);
