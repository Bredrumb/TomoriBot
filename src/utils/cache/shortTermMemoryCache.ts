/**
 * Short-Term Memory Cache
 *
 * Stores recent conversations (last 10 messages per channel) and tool-generated summaries
 * for cross-channel and cross-server awareness.
 *
 * Features:
 * - Cache-only storage (no database persistence)
 * - TTL-based expiration (2 hours for conversations, 4 hours for summaries)
 * - Privacy-respecting cross-server sharing (opt-in)
 * - Relative timestamp formatting (e.g., "2 hours ago")
 *
 * Design:
 * - Key pattern: `shortterm:${userId}:${channelId}`
 * - Conversations: Last 10 condensed turns (user + model messages)
 * - Summaries: Tool-generated summaries replace crude conversations
 * - Cross-model compatible: Summaries created by any model work for all models
 */

import { log } from "@/utils/misc/logger";

/**
 * A single message in a short-term memory conversation
 */
interface ShortTermMessage {
	role: "user" | "model";
	content: string;
	timestamp: number;
}

/**
 * A short-term memory entry for a user in a specific channel
 */
export interface ShortTermMemoryEntry {
	/** Array of conversation messages (max 10 condensed turns) */
	messages: ShortTermMessage[];

	/** Optional tool-generated summary (replaces crude conversation when present) */
	summary?: string;

	/** Discord server ID (or "DM" for direct messages) */
	serverId: string;

	/** Optional server name (for same-server channel mentions) */
	serverName?: string;

	/** Discord channel ID */
	channelId: string;

	/** Optional channel name (for same-server channel mentions) */
	channelName?: string;

	/** Unix timestamp (ms) of last update */
	lastUpdated: number;
}

/**
 * Cache statistics for monitoring performance
 */
interface CacheStats {
	hits: number;
	misses: number;
	stores: number;
	invalidations: number;
	expirations: number;
}

// Environment variables for configuration
const CRUDE_CONVERSATION_TTL_HOURS = Number.parseInt(
	process.env.SHORT_TERM_MEMORY_TTL_HOURS || "12",
	10,
);
const SUMMARY_TTL_HOURS = Number.parseInt(
	process.env.SHORT_TERM_MEMORY_SUMMARY_TTL_HOURS || "24",
	10,
);
const MAX_SUMMARY_LENGTH = Number.parseInt(
	process.env.SHORT_TERM_MEMORY_MAX_SUMMARY_LENGTH || "1500",
	10,
);
const MAX_MESSAGES_PER_CHANNEL = Number.parseInt(
	process.env.SHORT_TERM_MEMORY_MAX_MESSAGES_PER_CHANNEL || "10",
	10,
);

// Convert hours to milliseconds
const CRUDE_CONVERSATION_TTL_MS = CRUDE_CONVERSATION_TTL_HOURS * 60 * 60 * 1000;
const SUMMARY_TTL_MS = SUMMARY_TTL_HOURS * 60 * 60 * 1000;

// Export constants for use in tools and context builders
export { MAX_SUMMARY_LENGTH };

// In-memory cache: Map<userId:channelId, ShortTermMemoryEntry>
const cache = new Map<string, ShortTermMemoryEntry>();

// Cache statistics
const stats: CacheStats = {
	hits: 0,
	misses: 0,
	stores: 0,
	invalidations: 0,
	expirations: 0,
};

/**
 * Generate cache key for a user in a channel
 */
function getCacheKey(userId: string, channelId: string): string {
	return `shortterm:${userId}:${channelId}`;
}

/**
 * Check if a cache entry has expired based on TTL
 * @param entry - The cache entry to check
 * @returns True if expired, false otherwise
 */
function isExpired(entry: ShortTermMemoryEntry): boolean {
	const now = Date.now();
	const age = now - entry.lastUpdated;

	// If summary exists, use summary TTL; otherwise use crude conversation TTL
	const ttl = entry.summary ? SUMMARY_TTL_MS : CRUDE_CONVERSATION_TTL_MS;

	return age > ttl;
}

/**
 * Format a timestamp as a relative time string
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Human-readable relative time (e.g., "2 hours ago", "just now")
 */
export function getRelativeTimestamp(timestamp: number): string {
	const now = Date.now();
	const diffMs = now - timestamp;

	// Convert to different units
	const diffMinutes = Math.floor(diffMs / (60 * 1000));
	const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
	const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

	// Format based on age
	if (diffMinutes < 1) {
		return "just now";
	}
	if (diffMinutes < 60) {
		return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
	}
	if (diffHours < 24) {
		return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
	}
	if (diffDays < 7) {
		return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
	}
	return "over a week ago";
}

/**
 * Store a short-term memory for a user in a channel
 *
 * @param userId - Discord user ID
 * @param channelId - Discord channel ID
 * @param messages - Array of conversation messages (max 10 turns)
 * @param serverId - Discord server ID (or "DM" for direct messages)
 * @param serverName - Optional server name for same-server channel mentions
 * @param channelName - Optional channel name for same-server channel mentions
 */
export function storeShortTermMemory(
	userId: string,
	channelId: string,
	messages: Array<{
		role: "user" | "model";
		content: string;
		timestamp: number;
	}>,
	serverId: string,
	serverName?: string,
	channelName?: string,
): void {
	try {
		// 1. Validate inputs
		if (!userId || !channelId || !serverId) {
			log.warn(
				`[shortTermMemoryCache] Invalid parameters for storeShortTermMemory - userId=${!!userId}, channelId=${!!channelId}, serverId=${!!serverId}`,
			);
			return;
		}

		// 2. Limit messages to MAX_MESSAGES_PER_CHANNEL (take most recent)
		const limitedMessages = messages.slice(-MAX_MESSAGES_PER_CHANNEL);

		// 3. Get existing entry (preserve summary if exists)
		const key = getCacheKey(userId, channelId);
		const existing = cache.get(key);

		// 🔍 DEBUG: Log existing entry state BEFORE creating new entry
		log.info(
			`[shortTermMemoryCache] [STORAGE] Before store - key=${key}, existingEntry=${!!existing}, existingSummary=${!!existing?.summary}, existingSummaryLength=${existing?.summary?.length || 0}`,
		);

		// 4. Create new entry
		const entry: ShortTermMemoryEntry = {
			messages: limitedMessages,
			summary: existing?.summary, // Preserve existing summary
			serverId,
			serverName,
			channelId,
			channelName,
			lastUpdated: Date.now(),
		};

		// 5. Store in cache
		cache.set(key, entry);
		stats.stores++;

		// 🔍 DEBUG: Log final entry state AFTER storing
		log.info(
			`[shortTermMemoryCache] [STORAGE] After store - key=${key}, messageCount=${limitedMessages.length}, hasSummary=${!!entry.summary}, summaryLength=${entry.summary?.length || 0}, summaryPreserved=${!!existing?.summary && !!entry.summary}`,
		);
	} catch (error) {
		log.error(
			`[shortTermMemoryCache] Failed to store short-term memory - userId=${userId}, channelId=${channelId}`,
			error,
			{
				errorType: "CACHE_STORAGE_ERROR",
				metadata: { userDiscId: userId, channelId },
			},
		);
	}
}

/**
 * Get all short-term memories for a user across channels
 *
 * @param userId - Discord user ID
 * @param excludeChannelId - Optional channel ID to exclude (e.g., current channel)
 * @returns Array of non-expired memory entries
 */
export function getShortTermMemoriesForUser(
	userId: string,
	excludeChannelId?: string,
): ShortTermMemoryEntry[] {
	try {
		const memories: ShortTermMemoryEntry[] = [];

		// 1. Iterate through cache and find entries for this user
		for (const [key, entry] of cache.entries()) {
			// Check if key matches user
			if (!key.startsWith(`shortterm:${userId}:`)) {
				continue;
			}

			// Exclude specified channel if provided
			if (excludeChannelId && entry.channelId === excludeChannelId) {
				continue;
			}

			// Check expiration
			if (isExpired(entry)) {
				// Mark for removal but don't remove during iteration
				continue;
			}

			// Add to results
			memories.push(entry);
			stats.hits++;
		}

		// 2. Sort by lastUpdated (most recent first)
		memories.sort((a, b) => b.lastUpdated - a.lastUpdated);

		log.info(
			`[shortTermMemoryCache] Retrieved short-term memories for user - userId=${userId}, count=${memories.length}, excludeChannelId=${excludeChannelId}`,
		);

		return memories;
	} catch (error) {
		log.error(
			`[shortTermMemoryCache] Failed to get short-term memories - userId=${userId}`,
			error,
			{
				errorType: "CACHE_RETRIEVAL_ERROR",
				metadata: { userDiscId: userId },
			},
		);
		return [];
	}
}

/**
 * Get short-term memory for a specific channel
 *
 * @param userId - Discord user ID
 * @param channelId - Discord channel ID
 * @returns Memory entry if found and not expired, undefined otherwise
 */
export function getShortTermMemoryForChannel(
	userId: string,
	channelId: string,
): ShortTermMemoryEntry | undefined {
	try {
		const key = getCacheKey(userId, channelId);
		const entry = cache.get(key);

		// 🔍 DEBUG: Log what we found in cache
		log.info(
			`[shortTermMemoryCache] [RETRIEVAL] Get memory for channel - key=${key}, entryFound=${!!entry}, hasSummary=${!!entry?.summary}, summaryLength=${entry?.summary?.length || 0}, messageCount=${entry?.messages.length || 0}`,
		);

		// Check if entry exists
		if (!entry) {
			stats.misses++;
			log.info(
				`[shortTermMemoryCache] [RETRIEVAL] Cache miss - no entry found for key=${key}`,
			);
			return undefined;
		}

		// Check expiration
		if (isExpired(entry)) {
			// Remove expired entry
			cache.delete(key);
			stats.expirations++;
			stats.misses++;
			log.info(
				`[shortTermMemoryCache] [RETRIEVAL] Cache miss - entry expired for key=${key}`,
			);
			return undefined;
		}

		stats.hits++;
		log.info(
			`[shortTermMemoryCache] [RETRIEVAL] Cache hit - returning entry with summary=${!!entry.summary}, messages=${entry.messages.length}`,
		);
		return entry;
	} catch (error) {
		log.error(
			`[shortTermMemoryCache] Failed to get short-term memory for channel - userId=${userId}, channelId=${channelId}`,
			error,
			{
				errorType: "CACHE_RETRIEVAL_ERROR",
				metadata: { userDiscId: userId, channelId },
			},
		);
		return undefined;
	}
}

/**
 * Update the summary for a short-term memory (used by update_short_term_memory tool)
 *
 * @param userId - Discord user ID
 * @param channelId - Discord channel ID
 * @param summary - Tool-generated summary text
 * @param serverId - Discord server ID (required if creating new entry)
 * @param serverName - Server name (optional, for new entries)
 * @param channelName - Channel name (optional, for new entries)
 */
export function updateShortTermMemorySummary(
	userId: string,
	channelId: string,
	summary: string,
	serverId?: string,
	serverName?: string,
	channelName?: string,
): void {
	try {
		// 1. Validate inputs
		if (!userId || !channelId || !summary) {
			log.warn(
				`[shortTermMemoryCache] Invalid parameters for updateShortTermMemorySummary - userId=${!!userId}, channelId=${!!channelId}, summary=${!!summary}`,
			);
			return;
		}

		// 2. Validate summary length (use configured max)
		const truncatedSummary =
			summary.length > MAX_SUMMARY_LENGTH
				? summary.slice(0, MAX_SUMMARY_LENGTH)
				: summary;

		// 3. Get existing entry
		const key = getCacheKey(userId, channelId);
		let existing = cache.get(key);

		// 🔍 DEBUG: Log state BEFORE updating summary
		log.info(
			`[shortTermMemoryCache] [SUMMARY_UPDATE] Before update - key=${key}, existingEntry=${!!existing}, existingMessages=${existing?.messages.length || 0}, existingSummary=${!!existing?.summary}`,
		);

		// 4. If no existing entry, create a minimal one (tool was called before conversation storage)
		if (!existing) {
			log.info(
				`[shortTermMemoryCache] [SUMMARY_UPDATE] Creating new entry with summary - userId=${userId}, channelId=${channelId}, summaryLength=${truncatedSummary.length}`,
			);

			existing = {
				messages: [], // Empty messages array - will be populated when conversation is stored
				summary: truncatedSummary,
				serverId: serverId || "unknown",
				serverName,
				channelId,
				channelName,
				lastUpdated: Date.now(),
			};
		} else {
			// Update existing entry
			log.info(
				`[shortTermMemoryCache] [SUMMARY_UPDATE] Updating existing entry - previousSummary=${!!existing.summary}, newSummaryLength=${truncatedSummary.length}`,
			);
			existing.summary = truncatedSummary;
			existing.lastUpdated = Date.now();
		}

		// 5. Store updated entry
		cache.set(key, existing);

		// 🔍 DEBUG: Verify entry was stored correctly
		const stored = cache.get(key);
		log.info(
			`[shortTermMemoryCache] [SUMMARY_UPDATE] After update - key=${key}, storedEntry=${!!stored}, storedSummary=${!!stored?.summary}, storedSummaryLength=${stored?.summary?.length || 0}, storedMessages=${stored?.messages.length || 0}`,
		);
	} catch (error) {
		log.error(
			`[shortTermMemoryCache] Failed to update short-term memory summary - userId=${userId}, channelId=${channelId}`,
			error,
			{
				errorType: "CACHE_UPDATE_ERROR",
				metadata: { userDiscId: userId, channelId },
			},
		);
	}
}

/**
 * Invalidate (remove) a specific short-term memory entry
 *
 * @param userId - Discord user ID
 * @param channelId - Discord channel ID
 */
export function invalidateShortTermMemory(
	userId: string,
	channelId: string,
): void {
	try {
		const key = getCacheKey(userId, channelId);
		const deleted = cache.delete(key);

		if (deleted) {
			stats.invalidations++;
			log.info(
				`[shortTermMemoryCache] Invalidated short-term memory - userId=${userId}, channelId=${channelId}`,
			);
		}
	} catch (error) {
		log.error(
			`[shortTermMemoryCache] Failed to invalidate short-term memory - userId=${userId}, channelId=${channelId}`,
			error,
			{
				errorType: "CACHE_INVALIDATION_ERROR",
				metadata: { userDiscId: userId, channelId },
			},
		);
	}
}

/**
 * Clear all short-term memories for a specific channel (used by /tool refresh)
 *
 * @param channelId - Discord channel ID
 */
export function clearShortTermMemoryForChannel(channelId: string): void {
	try {
		let clearedCount = 0;

		// Find and delete all entries for this channel (across all users)
		for (const [key, entry] of cache.entries()) {
			if (entry.channelId === channelId) {
				cache.delete(key);
				clearedCount++;
			}
		}

		stats.invalidations += clearedCount;

		log.info(
			`[shortTermMemoryCache] Cleared all short-term memories for channel - channelId=${channelId}, clearedCount=${clearedCount}`,
		);
	} catch (error) {
		log.error(
			`[shortTermMemoryCache] Failed to clear short-term memories for channel - channelId=${channelId}`,
			error,
			{
				errorType: "CACHE_CLEAR_ERROR",
				metadata: { channelId },
			},
		);
	}
}

/**
 * Clear all short-term memories for a user (used by /personal cache clear)
 *
 * @param userId - Discord user ID
 */
export function clearShortTermMemoryForUser(userId: string): void {
	try {
		let clearedCount = 0;

		// Find and delete all entries for this user
		for (const key of cache.keys()) {
			if (key.startsWith(`shortterm:${userId}:`)) {
				cache.delete(key);
				clearedCount++;
			}
		}

		stats.invalidations += clearedCount;

		log.info(
			`[shortTermMemoryCache] Cleared all short-term memories for user - userId=${userId}, clearedCount=${clearedCount}`,
		);
	} catch (error) {
		log.error(
			`[shortTermMemoryCache] Failed to clear short-term memories for user - userId=${userId}`,
			error,
			{
				errorType: "CACHE_CLEAR_ERROR",
				metadata: { userDiscId: userId },
			},
		);
	}
}

/**
 * Remove expired entries from cache (cleanup job)
 * Should be called periodically (e.g., every 30 minutes)
 */
export function clearExpiredEntries(): void {
	try {
		let expiredCount = 0;

		// Iterate and remove expired entries
		for (const [key, entry] of cache.entries()) {
			if (isExpired(entry)) {
				cache.delete(key);
				expiredCount++;
			}
		}

		stats.expirations += expiredCount;

		if (expiredCount > 0) {
			log.info(
				`[shortTermMemoryCache] Cleared expired short-term memories - expiredCount=${expiredCount}, remainingCount=${cache.size}`,
			);
		}
	} catch (error) {
		log.error("[shortTermMemoryCache] Failed to clear expired entries", error, {
			errorType: "CACHE_CLEANUP_ERROR",
		});
	}
}

/**
 * Get cache statistics for monitoring performance
 *
 * @returns Cache hit/miss/store/invalidation/expiration stats
 */
export function getShortTermMemoryCacheStats(): CacheStats & {
	size: number;
	hitRate: string;
} {
	const totalRequests = stats.hits + stats.misses;
	const hitRate =
		totalRequests > 0
			? `${((stats.hits / totalRequests) * 100).toFixed(1)}%`
			: "0%";

	return {
		...stats,
		size: cache.size,
		hitRate,
	};
}
