import type { TomoriState } from "@/types/db/schema";

/**
 * Leaf-level store for the TomoriState in-memory cache.
 *
 * Owns the mutable Maps and the invalidation entry point. Kept deliberately
 * dependency-free (only a type import) so writer modules (e.g. repositories)
 * can invalidate the cache without pulling in `tomoriStateCache.ts`, which
 * imports the repositories barrel and would create a circular dependency.
 *
 * Reader functions (getCachedAllPersonas, getCachedMainPersona, etc.) live
 * in `tomoriStateCache.ts` and share state with writers via this module.
 */

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
  // 1. Drop any cached persona snapshot for this server
  cache.delete(serverDiscId);
  // 2. Drop any recorded DB error so next read can re-evaluate freshly
  lastDbError.delete(serverDiscId);
}
