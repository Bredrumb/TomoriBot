import type { TomoriState } from "@/types/db/schema";
import { invalidateServerPersonaAppearances, clearPersonaAppearances } from "@/utils/cache/personaAppearanceCacheStore";
import { z } from "zod";
import {
  broadcastInvalidation,
  registerInvalidation,
  invalidationKey,
  withoutInvalidationBroadcast,
} from "@/utils/cache/invalidationBus";

/** Repository writers import this store instead of the readers to avoid a repository dependency cycle. */

/**
 * Cache entry structure for TomoriState data per server.
 * Holds arrays of personas (main + alters) for multi-persona support.
 * Includes timestamp for TTL (Time To Live) expiration tracking.
 */
export interface TomoriStateCacheEntry {
  personas: TomoriState[]; // Array of all personas (main first, then alters)
  mainPersona: TomoriState; // Quick reference to main persona (is_alter=false)
  cachedAt: number; // Timestamp in milliseconds
}

/**
 * In-memory cache map: serverDiscId -> cache entry.
 * Reduces database queries from 3-4 per message to 0 (cache hit).
 */
export const cache = new Map<string, TomoriStateCacheEntry>();

/**
 * Tracks recent DB errors per server so the UI layer can distinguish
 * "server not set up" from "DB temporarily unavailable" when the cache
 * returns null/empty. Entries are cleared on successful loads and invalidation.
 */
export const lastDbError = new Map<string, { message: string; timestamp: number }>();

/**
 * Invalidates in-memory cache for a specific server.
 * Called by repository writers and command handlers when config/settings change.
 *
 * @param serverDiscId - Discord server ID to invalidate
 */
export function invalidateTomoriStateCache(serverDiscId: string): void {
  invalidateServerPersonaAppearances(serverDiscId);
  cache.delete(serverDiscId);
  lastDbError.delete(serverDiscId);
  broadcastInvalidation("tomoriState", [[serverDiscId]]);
}

/**
 * Invalidates multiple server snapshots. Used when one shared source row
 * affects many pointer personas.
 *
 * @param serverDiscIds - Discord server IDs to invalidate
 */
export function invalidateTomoriStateCaches(serverDiscIds: Iterable<string>): void {
  const tuples: [string][] = [];
  withoutInvalidationBroadcast(() => {
    for (const serverDiscId of serverDiscIds) {
      invalidateTomoriStateCache(serverDiscId);
      tuples.push([serverDiscId]);
    }
  });
  broadcastInvalidation("tomoriState", tuples);
}

registerInvalidation(
  "tomoriState",
  z.tuple([invalidationKey]),
  ([server]) => invalidateTomoriStateCache(server),
  () => {
    clearPersonaAppearances();
    cache.clear();
    lastDbError.clear();
  },
);
