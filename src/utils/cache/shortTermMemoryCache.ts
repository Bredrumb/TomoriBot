/**
 * Short-Term Memory Cache
 *
 * Stores recent conversations (last 10 messages per channel) and tool-generated summaries
 * for cross-channel and cross-server awareness.
 *
 * Features:
 * - Cache-only storage (no database persistence)
 * - TTL-based expiration (2 hours for conversations, 4 hours for summaries)
 * - Persona-shared guild STM plus privacy-respecting cross-server user STM
 * - Relative timestamp formatting (e.g., "2 hours ago")
 *
 * Design:
 * - User key pattern: `shortterm:user:${userId}:${channelId}` or `shortterm:user:${userId}:${channelId}:${personaId}`
 * - Server key pattern: `shortterm:server:${serverId}:${channelId}` or `shortterm:server:${serverId}:${channelId}:${personaId}`
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
  /** Original speaker name (persona name or username) for multi-persona labeling */
  speakerName?: string;
}

/**
 * A short-term memory entry for a specific channel
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

  /** Parent channel ID when channelId is a thread , so used for privacy/RP inheritance checks */
  parentChannelId?: string | null;

  /** Optional channel name (for same-server channel mentions) */
  channelName?: string;

  /** Tomori persona ID for persona-scoped memory */
  personaId?: number | null;

  /** Persona lineage ID for cross-server persona matching */
  personaLineageId?: number | null;

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

const CRUDE_CONVERSATION_TTL_HOURS = Number.parseInt(process.env.SHORT_TERM_MEMORY_TTL_HOURS || "12", 10);
const SUMMARY_TTL_HOURS = Number.parseInt(process.env.SHORT_TERM_MEMORY_SUMMARY_TTL_HOURS || "24", 10);
const MAX_SUMMARY_LENGTH = Number.parseInt(process.env.SHORT_TERM_MEMORY_MAX_SUMMARY_LENGTH || "1500", 10);
const MAX_MESSAGES_PER_CHANNEL = Number.parseInt(process.env.SHORT_TERM_MEMORY_MAX_MESSAGES_PER_CHANNEL || "10", 10);

const CRUDE_CONVERSATION_TTL_MS = CRUDE_CONVERSATION_TTL_HOURS * 60 * 60 * 1000;
const SUMMARY_TTL_MS = SUMMARY_TTL_HOURS * 60 * 60 * 1000;

export { MAX_SUMMARY_LENGTH };

const USER_CACHE_PREFIX = "shortterm:user";
const SERVER_CACHE_PREFIX = "shortterm:server";

const cache = new Map<string, ShortTermMemoryEntry>();

const stats: CacheStats = {
  hits: 0,
  misses: 0,
  stores: 0,
  invalidations: 0,
  expirations: 0,
};

/**
 * Generate cache key for a user in a channel, optionally scoped to a persona
 * @param userId - Discord user ID
 * @param channelId - Discord channel ID
 * @param personaId - Optional persona ID for persona-scoped memory
 */
function getUserCacheKey(userId: string, channelId: string, personaId?: number | null): string {
  if (personaId) return `${USER_CACHE_PREFIX}:${userId}:${channelId}:${personaId}`;
  return `${USER_CACHE_PREFIX}:${userId}:${channelId}`;
}

/**
 * Generate cache key for a server-shared channel memory, optionally scoped to a persona
 * @param serverId - Discord server ID
 * @param channelId - Discord channel ID
 * @param personaId - Optional persona ID for persona-scoped memory
 */
function getServerCacheKey(serverId: string, channelId: string, personaId?: number | null): string {
  if (personaId) {
    return `${SERVER_CACHE_PREFIX}:${serverId}:${channelId}:${personaId}`;
  }
  return `${SERVER_CACHE_PREFIX}:${serverId}:${channelId}`;
}

/**
 * Check if a cache entry has expired based on TTL
 * @returns True if expired, false otherwise
 */
function isExpired(entry: ShortTermMemoryEntry): boolean {
  const now = Date.now();
  const age = now - entry.lastUpdated;

  const ttl = entry.summary ? SUMMARY_TTL_MS : CRUDE_CONVERSATION_TTL_MS;

  return age > ttl;
}

/**
 * Format a timestamp as a relative time string
 */
export function getRelativeTimestamp(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;

  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

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

function storeMemoryEntry(
  key: string,
  channelId: string,
  messages: Array<{
    role: "user" | "model";
    content: string;
    timestamp: number;
    speakerName?: string;
  }>,
  serverId: string,
  serverName?: string,
  channelName?: string,
  personaId?: number | null,
  personaLineageId?: number | null,
  parentChannelId?: string | null,
): void {
  const existing = cache.get(key);

  const entry: ShortTermMemoryEntry = {
    messages,
    summary: existing?.summary,
    serverId,
    serverName,
    channelId,
    parentChannelId,
    channelName,
    personaId,
    personaLineageId,
    lastUpdated: Date.now(),
  };

  cache.set(key, entry);
  stats.stores++;
}

function collectMemories(
  keyPrefix: string,
  excludeChannelId?: string,
  personaLineageId?: number | null,
): ShortTermMemoryEntry[] {
  const memories: ShortTermMemoryEntry[] = [];
  const expiredKeys: string[] = [];

  for (const [key, entry] of cache.entries()) {
    if (!key.startsWith(keyPrefix)) {
      continue;
    }

    if (excludeChannelId && entry.channelId === excludeChannelId) {
      continue;
    }

    if (personaLineageId && entry.personaLineageId !== personaLineageId) {
      continue;
    }

    if (isExpired(entry)) {
      expiredKeys.push(key);
      continue;
    }

    memories.push(entry);
    stats.hits++;
  }

  for (const key of expiredKeys) {
    cache.delete(key);
    stats.expirations++;
  }

  memories.sort((a, b) => b.lastUpdated - a.lastUpdated);
  return memories;
}

function getShortTermMemoryByKey(key: string): ShortTermMemoryEntry | undefined {
  const entry = cache.get(key);

  if (!entry) {
    stats.misses++;
    return undefined;
  }

  if (isExpired(entry)) {
    cache.delete(key);
    stats.expirations++;
    stats.misses++;
    return undefined;
  }

  stats.hits++;
  return entry;
}

function updateSummaryForKey(
  key: string,
  summary: string,
  serverId: string,
  channelId: string,
  serverName?: string,
  channelName?: string,
  personaId?: number | null,
  personaLineageId?: number | null,
  parentChannelId?: string | null,
): void {
  let existing = cache.get(key);

  if (!existing) {
    existing = {
      messages: [],
      summary,
      serverId,
      serverName,
      channelId,
      parentChannelId,
      channelName,
      personaId,
      personaLineageId,
      lastUpdated: Date.now(),
    };
  } else {
    existing.summary = summary;
    existing.lastUpdated = Date.now();
  }

  cache.set(key, existing);
}

/**
 *
 * @param userId - Discord user ID
 * @param channelId - Discord channel ID
 * @param messages - Array of conversation messages (max 10 turns) with optional speaker names
 * @param serverId - Discord server ID (or "DM" for direct messages)
 * @param serverName - Optional server name for same-server channel mentions
 * @param channelName - Optional channel name for same-server channel mentions
 * @param personaId - Optional persona ID for persona-scoped memory
 * @param personaLineageId - Optional persona lineage ID for cross-server persona matching
 * @param parentChannelId - Parent channel ID when channelId is a thread (used for privacy inheritance)
 */
export function storeShortTermMemory(
  userId: string,
  channelId: string,
  messages: Array<{
    role: "user" | "model";
    content: string;
    timestamp: number;
    speakerName?: string;
  }>,
  serverId: string,
  serverName?: string,
  channelName?: string,
  personaId?: number | null,
  personaLineageId?: number | null,
  parentChannelId?: string | null,
): void {
  try {
    if (!userId || !channelId || !serverId) {
      log.warn(
        `[shortTermMemoryCache] Invalid parameters for storeShortTermMemory - userId=${!!userId}, channelId=${!!channelId}, serverId=${!!serverId}`,
      );
      return;
    }

    const limitedMessages = messages.slice(-MAX_MESSAGES_PER_CHANNEL);

    storeMemoryEntry(
      getUserCacheKey(userId, channelId, personaId),
      channelId,
      limitedMessages,
      serverId,
      serverName,
      channelName,
      personaId,
      personaLineageId,
      parentChannelId,
    );

    if (serverId !== "DM") {
      storeMemoryEntry(
        getServerCacheKey(serverId, channelId, personaId),
        channelId,
        limitedMessages,
        serverId,
        serverName,
        channelName,
        personaId,
        personaLineageId,
        parentChannelId,
      );
    }
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
 * Get all short-term memories for a user across channels, optionally scoped to a persona lineage
 *
 * @param userId - Discord user ID
 * @param excludeChannelId - Optional channel ID to exclude (e.g., current channel)
 * @param personaLineageId - Optional persona lineage ID to filter by (only returns entries matching this lineage)
 */
export function getShortTermMemoriesForUser(
  userId: string,
  excludeChannelId?: string,
  personaLineageId?: number | null,
): ShortTermMemoryEntry[] {
  try {
    const memories = collectMemories(`${USER_CACHE_PREFIX}:${userId}:`, excludeChannelId, personaLineageId);
    return memories;
  } catch (error) {
    log.error(`[shortTermMemoryCache] Failed to get short-term memories - userId=${userId}`, error, {
      errorType: "CACHE_RETRIEVAL_ERROR",
      metadata: { userDiscId: userId },
    });
    return [];
  }
}

/**
 * Get all server-shared short-term memories for a guild, optionally scoped to a persona lineage
 *
 * @param serverId - Discord server ID
 * @param excludeChannelId - Optional channel ID to exclude (e.g., current channel)
 * @param personaLineageId - Optional persona lineage ID to filter by
 */
export function getShortTermMemoriesForServer(
  serverId: string,
  excludeChannelId?: string,
  personaLineageId?: number | null,
): ShortTermMemoryEntry[] {
  try {
    if (!serverId || serverId === "DM") {
      return [];
    }

    const memories = collectMemories(`${SERVER_CACHE_PREFIX}:${serverId}:`, excludeChannelId, personaLineageId);
    return memories;
  } catch (error) {
    log.error(`[shortTermMemoryCache] Failed to get server-shared short-term memories - serverId=${serverId}`, error, {
      errorType: "CACHE_RETRIEVAL_ERROR",
      metadata: { serverId },
    });
    return [];
  }
}

/**
 * Get short-term memory for a specific user/channel pair, optionally scoped to a persona
 *
 * @param userId - Discord user ID
 * @param channelId - Discord channel ID
 * @param personaId - Optional persona ID for persona-scoped memory
 * @returns Memory entry if found and not expired, undefined otherwise
 */
export function getShortTermMemoryForUserChannel(
  userId: string,
  channelId: string,
  personaId?: number | null,
): ShortTermMemoryEntry | undefined {
  try {
    return getShortTermMemoryByKey(getUserCacheKey(userId, channelId, personaId));
  } catch (error) {
    log.error(
      `[shortTermMemoryCache] Failed to get user short-term memory for channel - userId=${userId}, channelId=${channelId}`,
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
 * Get short-term memory for a specific server/channel pair, optionally scoped to a persona
 *
 * @param serverId - Discord server ID
 * @param channelId - Discord channel ID
 * @param personaId - Optional persona ID for persona-scoped memory
 * @returns Memory entry if found and not expired, undefined otherwise
 */
export function getShortTermMemoryForServerChannel(
  serverId: string,
  channelId: string,
  personaId?: number | null,
): ShortTermMemoryEntry | undefined {
  try {
    if (!serverId || serverId === "DM") {
      return undefined;
    }

    return getShortTermMemoryByKey(getServerCacheKey(serverId, channelId, personaId));
  } catch (error) {
    log.error(
      `[shortTermMemoryCache] Failed to get server short-term memory for channel - serverId=${serverId}, channelId=${channelId}`,
      error,
      {
        errorType: "CACHE_RETRIEVAL_ERROR",
        metadata: { serverId, channelId },
      },
    );
    return undefined;
  }
}

/**
 * Update the summary for short-term memory entries (used by update_short_term_memory tool)
 *
 * @param userId - Discord user ID
 * @param channelId - Discord channel ID
 * @param summary - Tool-generated summary text
 * @param serverId - Discord server ID (required if creating new entry)
 * @param serverName - Server name (optional, for new entries)
 * @param channelName - Channel name (optional, for new entries)
 * @param personaId - Optional persona ID for persona-scoped memory
 * @param personaLineageId - Optional persona lineage ID for cross-server persona matching
 * @param parentChannelId - Parent channel ID when channelId is a thread (used for privacy inheritance)
 */
export function updateShortTermMemorySummary(
  userId: string,
  channelId: string,
  summary: string,
  serverId?: string,
  serverName?: string,
  channelName?: string,
  personaId?: number | null,
  personaLineageId?: number | null,
  parentChannelId?: string | null,
): void {
  try {
    if (!userId || !channelId || !summary) {
      log.warn(
        `[shortTermMemoryCache] Invalid parameters for updateShortTermMemorySummary - userId=${!!userId}, channelId=${!!channelId}, summary=${!!summary}`,
      );
      return;
    }

    const truncatedSummary = summary.length > MAX_SUMMARY_LENGTH ? summary.slice(0, MAX_SUMMARY_LENGTH) : summary;

    updateSummaryForKey(
      getUserCacheKey(userId, channelId, personaId),
      truncatedSummary,
      serverId || "unknown",
      channelId,
      serverName,
      channelName,
      personaId,
      personaLineageId,
      parentChannelId,
    );

    if (serverId && serverId !== "DM") {
      updateSummaryForKey(
        getServerCacheKey(serverId, channelId, personaId),
        truncatedSummary,
        serverId,
        channelId,
        serverName,
        channelName,
        personaId,
        personaLineageId,
        parentChannelId,
      );
    }
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
 * Clear all short-term memories for a specific channel (used by /tool refresh)
 *
 * @param channelId - Discord channel ID
 */
export function clearShortTermMemoryForChannel(channelId: string): void {
  try {
    let clearedCount = 0;

    for (const [key, entry] of cache.entries()) {
      if (entry.channelId === channelId) {
        cache.delete(key);
        clearedCount++;
      }
    }

    stats.invalidations += clearedCount;
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
 * Clear one server-scoped short-term memory entry for a specific channel/persona pair.
 *
 * @param serverId - Discord server ID
 * @param channelId - Discord channel ID
 * @param personaId - Optional persona ID for persona-scoped memory
 */
export function clearShortTermMemoryForServerChannel(
  serverId: string,
  channelId: string,
  personaId?: number | null,
): void {
  try {
    if (!serverId || serverId === "DM" || !channelId) {
      log.warn(
        `[shortTermMemoryCache] Invalid parameters for clearShortTermMemoryForServerChannel - serverId=${serverId}, channelId=${channelId}, personaId=${personaId ?? "none"}`,
      );
      return;
    }

    if (cache.delete(getServerCacheKey(serverId, channelId, personaId))) {
      stats.invalidations++;
    }
  } catch (error) {
    log.error(
      `[shortTermMemoryCache] Failed to clear server short-term memory entry - serverId=${serverId}, channelId=${channelId}, personaId=${personaId ?? "none"}`,
      error,
      {
        errorType: "CACHE_CLEAR_ERROR",
        metadata: { serverId, channelId, personaId },
      },
    );
  }
}

/**
 * Clear all user-scoped short-term memories for a user (used by /personal stm clear)
 *
 * @param userId - Discord user ID
 */
export function clearShortTermMemoryForUser(userId: string): void {
  try {
    let clearedCount = 0;

    for (const key of cache.keys()) {
      if (key.startsWith(`${USER_CACHE_PREFIX}:${userId}:`)) {
        cache.delete(key);
        clearedCount++;
      }
    }

    stats.invalidations += clearedCount;
  } catch (error) {
    log.error(`[shortTermMemoryCache] Failed to clear short-term memories for user - userId=${userId}`, error, {
      errorType: "CACHE_CLEAR_ERROR",
      metadata: { userDiscId: userId },
    });
  }
}

/**
 * Remove expired entries from cache (cleanup job)
 * Should be called periodically (e.g., every 30 minutes)
 */
export function clearExpiredEntries(): void {
  try {
    let expiredCount = 0;

    for (const [key, entry] of cache.entries()) {
      if (isExpired(entry)) {
        cache.delete(key);
        expiredCount++;
      }
    }

    stats.expirations += expiredCount;
  } catch (error) {
    log.error("[shortTermMemoryCache] Failed to clear expired entries", error, {
      errorType: "CACHE_CLEANUP_ERROR",
    });
  }
}

/**
 * Clear all short-term memories.
 *
 * This is intentionally not used by normal cache invalidation paths because STM
 * is user-visible conversational state. It exists for explicit emergency memory
 * pressure handling where the operator has opted into sacrificing STM.
 */
export function clearShortTermMemoryCache(): void {
  try {
    const clearedCount = cache.size;
    cache.clear();
    stats.invalidations += clearedCount;
  } catch (error) {
    log.error("[shortTermMemoryCache] Failed to clear all short-term memory entries", error, {
      errorType: "CACHE_CLEAR_ERROR",
    });
  }
}

/**
 * Get cache statistics for monitoring performance
 *
 */
export function getShortTermMemoryCacheStats(): CacheStats & {
  size: number;
  hitRate: string;
} {
  const totalRequests = stats.hits + stats.misses;
  const hitRate = totalRequests > 0 ? `${((stats.hits / totalRequests) * 100).toFixed(1)}%` : "0%";

  return {
    ...stats,
    size: cache.size,
    hitRate,
  };
}
