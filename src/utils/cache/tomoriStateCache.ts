import type { TomoriState } from "@/types/db/schema";
import { loadAllPersonasForServer } from "../db/dbRead";
import { log } from "../misc/logger";

/**
 * Cache entry structure for TomoriState data per server.
 * Now holds arrays of personas (main + alters) for multi-persona support.
 * Includes timestamp for TTL (Time To Live) expiration tracking.
 */
interface TomoriStateCacheEntry {
	personas: TomoriState[]; // Array of all personas (main first, then alters)
	mainPersona: TomoriState; // Quick reference to main persona (is_alter=false)
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
 * Loads ALL personas (main + alters) with 10-minute in-memory cache.
 * Falls back to DB query on cache miss or stale.
 *
 * Cache flow:
 * 1. Check in-memory cache
 *    - HIT & FRESH (<10 min) -> Return immediately (0 DB queries)
 *    - MISS or STALE -> Continue to step 2
 * 2. Load from DB via loadAllPersonasForServer()
 * 3. Cache in memory for next requests
 *
 * @param serverDiscId - Discord server ID
 * @returns Array of TomoriState objects (main first, then alters), or empty array if not found
 */
export async function getCachedAllPersonas(
	serverDiscId: string,
): Promise<TomoriState[]> {
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
				`[TomoriState Cache] HIT for server ${serverDiscId} (age: ${Math.round(cacheAge / 1000)}s, ${cachedEntry.personas.length} personas)`,
			);
			return cachedEntry.personas;
		}

		// Cache stale - fall through to refresh
		log.info(
			`[TomoriState Cache] STALE for server ${serverDiscId} (age: ${Math.round(cacheAge / 1000)}s)`,
		);
	}

	// 2. Cache miss or stale - refresh from DB
	cacheMisses++;
	log.info(
		`[TomoriState Cache] MISS for server ${serverDiscId} - loading all personas from DB`,
	);

	try {
		// 3. Load fresh data from database (all personas)
		const personas = await loadAllPersonasForServer(serverDiscId);

		if (personas.length > 0) {
			// Find main persona (is_alter=false)
			const mainPersona = personas.find((p) => !p.is_alter);
			if (!mainPersona) {
				log.error(
					`[TomoriState Cache] No main persona found for server ${serverDiscId}`,
				);
				return personas; // Return alters anyway, but log error
			}

			// 4. Cache the loaded data
			cache.set(serverDiscId, {
				personas,
				mainPersona,
				cachedAt: now,
			});

			log.success(
				`[TomoriState Cache] Cached ${personas.length} persona(s) for server ${serverDiscId} (main: ${mainPersona.tomori_nickname})`,
			);
		}

		return personas;
	} catch (error) {
		log.error(
			`[TomoriState Cache] Error loading personas for server ${serverDiscId}:`,
			error,
		);

		// Return stale cache if available (graceful fallback)
		if (cachedEntry) {
			log.warn(
				`[TomoriState Cache] Returning stale cache for server ${serverDiscId} due to error`,
			);
			return cachedEntry.personas;
		}

		// No cache available, return empty array
		return [];
	}
}

/**
 * Loads ONLY the main persona with 10-minute in-memory cache.
 * Backward compatibility wrapper for getCachedAllPersonas().
 *
 * @param serverDiscId - Discord server ID
 * @returns Main TomoriState or null if not found
 */
export async function getCachedMainPersona(
	serverDiscId: string,
): Promise<TomoriState | null> {
	// 1. Check in-memory cache first for quick lookup
	const cachedEntry = cache.get(serverDiscId);
	if (cachedEntry) {
		const cacheAge = Date.now() - cachedEntry.cachedAt;
		if (cacheAge < TOMORI_STATE_CACHE_DURATION_MS) {
			// Cache hit - return main persona immediately
			cacheHits++;
			return cachedEntry.mainPersona;
		}
	}

	// 2. Cache miss or stale - load all personas
	const personas = await getCachedAllPersonas(serverDiscId);

	if (personas.length === 0) {
		return null;
	}

	// Return main persona (is_alter=false)
	const mainPersona = personas.find((p) => !p.is_alter);
	return mainPersona || null;
}

/**
 * DEPRECATED: Use getCachedMainPersona() or getCachedAllPersonas() instead.
 * Kept for backward compatibility during transition.
 *
 * @deprecated Use getCachedMainPersona() for main persona only, or getCachedAllPersonas() for all personas.
 */
export async function getCachedTomoriState(
	serverDiscId: string,
): Promise<TomoriState | null> {
	return getCachedMainPersona(serverDiscId);
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
