import type { TomoriState } from "@/types/db/schema";
import { loadTomoriState } from "../db/dbRead";
import { log } from "../misc/logger";

/**
 * Cache entry structure for TomoriState data per server.
 * Includes timestamp for TTL (Time To Live) expiration tracking.
 */
interface TomoriStateCacheEntry {
	state: TomoriState;
	cachedAt: number; // Timestamp in milliseconds
}

/**
 * In-memory cache map: serverDiscId -> cache entry
 * Reduces database queries from 3-4 per message to 0 (cache hit).
 */
const cache = new Map<string, TomoriStateCacheEntry>();

/**
 * Cache duration: configurable via env, default 10 minutes.
 * Longer TTL than emoji cache since config changes are less frequent.
 */
const TOMORI_STATE_CACHE_DURATION_MS =
	(Number(process.env.TOMORI_STATE_CACHE_TTL_MINUTES) || 10) * 60 * 1000;

/**
 * Cache statistics for monitoring
 */
let cacheHits = 0;
let cacheMisses = 0;

/**
 * Loads TomoriState with 10-minute in-memory cache.
 * Falls back to DB query on cache miss or stale.
 *
 * Cache flow:
 * 1. Check in-memory cache
 *    - HIT & FRESH (<10 min) -> Return immediately (0 DB queries)
 *    - MISS or STALE -> Continue to step 2
 * 2. Load from DB via loadTomoriState()
 * 3. Cache in memory for next requests
 *
 * @param serverDiscId - Discord server ID
 * @returns TomoriState or null if not found
 */
export async function getCachedTomoriState(
	serverDiscId: string,
): Promise<TomoriState | null> {
	// 1. Check in-memory cache
	const now = Date.now();
	const cachedEntry = cache.get(serverDiscId);

	if (cachedEntry) {
		// Check if cache is still fresh (< 10 minutes old)
		const cacheAge = now - cachedEntry.cachedAt;
		if (cacheAge < TOMORI_STATE_CACHE_DURATION_MS) {
			// Cache hit - return immediately
			cacheHits++;
			log.info(
				`[TomoriState Cache] HIT for server ${serverDiscId} (age: ${Math.round(cacheAge / 1000)}s)`,
			);
			return cachedEntry.state;
		}

		// Cache stale - fall through to refresh
		log.info(
			`[TomoriState Cache] STALE for server ${serverDiscId} (age: ${Math.round(cacheAge / 1000)}s)`,
		);
	}

	// 2. Cache miss or stale - refresh from DB
	cacheMisses++;
	log.info(`[TomoriState Cache] MISS for server ${serverDiscId} - loading from DB`);

	try {
		// 3. Load fresh data from database
		const state = await loadTomoriState(serverDiscId);

		if (state) {
			// 4. Cache the loaded data
			cache.set(serverDiscId, {
				state,
				cachedAt: now,
			});

			log.success(
				`[TomoriState Cache] Cached state for server ${serverDiscId} (tomori: ${state.tomori_nickname})`,
			);
		}

		return state;
	} catch (error) {
		log.error(
			`[TomoriState Cache] Error loading state for server ${serverDiscId}:`,
			error,
		);

		// Return stale cache if available (graceful fallback)
		if (cachedEntry) {
			log.warn(
				`[TomoriState Cache] Returning stale cache for server ${serverDiscId} due to error`,
			);
			return cachedEntry.state;
		}

		// No cache available, return null
		return null;
	}
}

/**
 * Invalidates in-memory cache for a specific server.
 * Called by command handlers when config/settings change.
 *
 * @param serverDiscId - Discord server ID to invalidate
 */
export function invalidateTomoriStateCache(serverDiscId: string): void {
	const hadCache = cache.has(serverDiscId);
	cache.delete(serverDiscId);

	if (hadCache) {
		log.info(
			`[TomoriState Cache] Invalidated cache for server ${serverDiscId}`,
		);
	}
}

/**
 * Clears entire in-memory cache.
 * Useful for testing or manual refresh operations.
 */
export function clearTomoriStateCache(): void {
	const previousSize = cache.size;
	cache.clear();
	cacheHits = 0;
	cacheMisses = 0;

	log.info(
		`[TomoriState Cache] Cleared entire cache (${previousSize} entries)`,
	);
}

/**
 * Gets cache statistics for monitoring and debugging.
 *
 * @returns Object with cache hits, misses, hit rate percentage, and cache size
 */
export function getTomoriStateCacheStats(): {
	hits: number;
	misses: number;
	hitRate: string;
	cacheSize: number;
} {
	const total = cacheHits + cacheMisses;
	const hitRate =
		total > 0 ? `${((cacheHits / total) * 100).toFixed(2)}%` : "N/A";

	return {
		hits: cacheHits,
		misses: cacheMisses,
		hitRate,
		cacheSize: cache.size,
	};
}
