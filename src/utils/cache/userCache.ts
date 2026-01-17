import { PrivacyLevel, type UserRow } from "@/types/db/schema";
import { loadUserRow, getPrivacyLevel, isBlacklisted } from "../db/dbRead";
import { log } from "../misc/logger";

/**
 * Cache entry structure for user data.
 * Includes user row, privacy level, and per-server blacklist status.
 * Blacklist is per-server, so we store a map of serverDiscId -> isBlacklisted.
 */
interface UserCacheEntry {
	userRow: UserRow | null; // null if user doesn't exist in DB
	privacyLevel: PrivacyLevel;
	blacklistStatus: Map<string, boolean>; // serverDiscId -> isBlacklisted
	cachedAt: number; // Timestamp in milliseconds
}

/**
 * In-memory cache map: userDiscId -> cache entry
 * Reduces database queries from 3-15 per message to 0-1 (cache hit + possible blacklist miss).
 */
const cache = new Map<string, UserCacheEntry>();

/**
 * Cache duration: configurable via env, default 30 minutes.
 * Longer TTL for user data since it changes even less frequently than server config.
 */
const USER_CACHE_DURATION_MS =
	(Number(process.env.USER_CACHE_TTL_MINUTES) || 30) * 60 * 1000;

/**
 * Cache statistics for monitoring
 */
let cacheHits = 0;
let cacheMisses = 0;
let blacklistCacheHits = 0;
let blacklistCacheMisses = 0;

/**
 * Gets or creates a cache entry for a user, loading from DB if needed.
 * Internal helper function used by the public cache accessors.
 *
 * @param userDiscId - Discord user ID
 * @returns UserCacheEntry (never null, creates entry with defaults if user not found)
 */
async function getOrCreateCacheEntry(userDiscId: string): Promise<UserCacheEntry> {
	const now = Date.now();
	const cachedEntry = cache.get(userDiscId);

	// Check if cache is still fresh
	if (cachedEntry) {
		const cacheAge = now - cachedEntry.cachedAt;
		if (cacheAge < USER_CACHE_DURATION_MS) {
			cacheHits++;
			log.info(
				`[User Cache] HIT for user ${userDiscId} (age: ${Math.round(cacheAge / 1000)}s)`,
			);
			return cachedEntry;
		}

		// Cache stale - fall through to refresh
		log.info(
			`[User Cache] STALE for user ${userDiscId} (age: ${Math.round(cacheAge / 1000)}s)`,
		);
	}

	// Cache miss or stale - refresh from DB
	cacheMisses++;
	log.info(`[User Cache] MISS for user ${userDiscId} - loading from DB`);

	try {
		// Load user row and privacy level in parallel
		const [userRow, privacyLevel] = await Promise.all([
			loadUserRow(userDiscId),
			getPrivacyLevel(userDiscId),
		]);

		// Create new cache entry (preserve existing blacklist entries if available)
		const newEntry: UserCacheEntry = {
			userRow,
			privacyLevel,
			blacklistStatus: cachedEntry?.blacklistStatus ?? new Map(),
			cachedAt: now,
		};

		cache.set(userDiscId, newEntry);

		log.success(
			`[User Cache] Cached user ${userDiscId} (nickname: ${userRow?.user_nickname ?? "N/A"}, privacy: ${privacyLevel})`,
		);

		return newEntry;
	} catch (error) {
		log.error(
			`[User Cache] Error loading user data for ${userDiscId}:`,
			error,
		);

		// Return stale cache if available (graceful fallback)
		if (cachedEntry) {
			log.warn(
				`[User Cache] Returning stale cache for user ${userDiscId} due to error`,
			);
			return cachedEntry;
		}

		// No cache available, return default entry
		const defaultEntry: UserCacheEntry = {
			userRow: null,
			privacyLevel: PrivacyLevel.MINIMAL,
			blacklistStatus: new Map(),
			cachedAt: now,
		};
		cache.set(userDiscId, defaultEntry);
		return defaultEntry;
	}
}

/**
 * Loads UserRow with 30-minute in-memory cache.
 * Falls back to DB query on cache miss or stale.
 *
 * @param userDiscId - Discord user ID
 * @returns UserRow or null if not found
 */
export async function getCachedUserRow(
	userDiscId: string,
): Promise<UserRow | null> {
	const entry = await getOrCreateCacheEntry(userDiscId);
	return entry.userRow;
}

/**
 * Gets privacy level with 30-minute in-memory cache.
 *
 * @param userDiscId - Discord user ID
 * @returns PrivacyLevel (defaults to MINIMAL if not found)
 */
export async function getCachedPrivacyLevel(
	userDiscId: string,
): Promise<PrivacyLevel> {
	const entry = await getOrCreateCacheEntry(userDiscId);
	return entry.privacyLevel;
}

/**
 * Checks blacklist status with caching.
 * Per-server blacklist is stored within the user cache entry.
 * If blacklist status for a specific server is not cached, it queries the DB
 * and caches the result for future lookups.
 *
 * @param serverDiscId - Discord server ID
 * @param userDiscId - Discord user ID
 * @returns boolean indicating if user is blacklisted in this server
 */
export async function getCachedBlacklistStatus(
	serverDiscId: string,
	userDiscId: string,
): Promise<boolean> {
	const entry = await getOrCreateCacheEntry(userDiscId);

	// Check if we have blacklist status cached for this server
	if (entry.blacklistStatus.has(serverDiscId)) {
		blacklistCacheHits++;
		log.info(
			`[User Cache] Blacklist HIT for user ${userDiscId} in server ${serverDiscId}`,
		);
		// biome-ignore lint/style/noNonNullAssertion: has() check guarantees existence
		return entry.blacklistStatus.get(serverDiscId)!;
	}

	// Blacklist status not cached for this server - query DB
	blacklistCacheMisses++;
	log.info(
		`[User Cache] Blacklist MISS for user ${userDiscId} in server ${serverDiscId} - querying DB`,
	);

	try {
		const isUserBlacklisted = await isBlacklisted(serverDiscId, userDiscId);
		entry.blacklistStatus.set(serverDiscId, isUserBlacklisted);

		log.info(
			`[User Cache] Cached blacklist status for user ${userDiscId} in server ${serverDiscId}: ${isUserBlacklisted}`,
		);

		return isUserBlacklisted;
	} catch (error) {
		log.error(
			`[User Cache] Error checking blacklist for user ${userDiscId} in server ${serverDiscId}:`,
			error,
		);
		// Default to false on error to avoid blocking personalization unintentionally
		return false;
	}
}

/**
 * Invalidates entire user cache entry.
 * Called when user settings change (privacy, nickname, memories).
 *
 * @param userDiscId - Discord user ID to invalidate
 */
export function invalidateUserCache(userDiscId: string): void {
	const hadCache = cache.has(userDiscId);
	cache.delete(userDiscId);

	if (hadCache) {
		log.info(`[User Cache] Invalidated cache for user ${userDiscId}`);
	}
}

/**
 * Invalidates only blacklist status for a user in a specific server.
 * More granular than full user invalidation - preserves user row and privacy level.
 *
 * @param serverDiscId - Discord server ID
 * @param userDiscId - Discord user ID
 */
export function invalidateUserBlacklistCache(
	serverDiscId: string,
	userDiscId: string,
): void {
	const entry = cache.get(userDiscId);
	if (entry) {
		const hadBlacklist = entry.blacklistStatus.has(serverDiscId);
		entry.blacklistStatus.delete(serverDiscId);

		if (hadBlacklist) {
			log.info(
				`[User Cache] Invalidated blacklist for user ${userDiscId} in server ${serverDiscId}`,
			);
		}
	}
}

/**
 * Clears entire in-memory user cache.
 * Useful for testing or manual refresh operations.
 */
export function clearUserCache(): void {
	const previousSize = cache.size;
	cache.clear();
	cacheHits = 0;
	cacheMisses = 0;
	blacklistCacheHits = 0;
	blacklistCacheMisses = 0;

	log.info(`[User Cache] Cleared entire cache (${previousSize} entries)`);
}

/**
 * Gets cache statistics for monitoring and debugging.
 *
 * @returns Object with cache hits, misses, hit rates, and cache size
 */
export function getUserCacheStats(): {
	hits: number;
	misses: number;
	hitRate: string;
	cacheSize: number;
	blacklistHits: number;
	blacklistMisses: number;
	blacklistHitRate: string;
} {
	const total = cacheHits + cacheMisses;
	const hitRate =
		total > 0 ? `${((cacheHits / total) * 100).toFixed(2)}%` : "N/A";

	const blacklistTotal = blacklistCacheHits + blacklistCacheMisses;
	const blacklistHitRate =
		blacklistTotal > 0
			? `${((blacklistCacheHits / blacklistTotal) * 100).toFixed(2)}%`
			: "N/A";

	return {
		hits: cacheHits,
		misses: cacheMisses,
		hitRate,
		cacheSize: cache.size,
		blacklistHits: blacklistCacheHits,
		blacklistMisses: blacklistCacheMisses,
		blacklistHitRate,
	};
}
