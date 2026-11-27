import { isDeepStrictEqual } from "node:util";
import type { TransactionSQL } from "bun";
import { sql } from "@/utils/db/client";
import { normalizeStmCategories, type ShortTermMemoryRow } from "@/types/db/schema";
import { log } from "@/utils/misc/logger";
import { z } from "zod";
import { broadcastInvalidation, invalidationKey, registerInvalidation } from "@/utils/cache/invalidationBus";

interface ShortTermMessage {
  role: "user" | "model";
  content: string;
  timestamp: number;
  speakerName?: string;
}

export interface ShortTermMemoryEntry {
  messages: ShortTermMessage[];

  summary?: string;

  categories?: Record<string, string>;

  turnsSinceRefresh?: number;

  lastRefreshedTurn?: number;

  summarizedThrough?: number;

  // Sentinel value "DM" represents direct messages because `serverId` is always a required string.
  serverId: string;

  serverName?: string;

  channelId: string;

  channelName?: string;

  personaId?: number | null;

  personaLineageId?: number | null;

  // Unix timestamp in milliseconds because `lastUpdated` omits the unit from its name.
  lastUpdated: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  stores: number;
  invalidations: number;
  expirations: number;
}

const CRUDE_CONVERSATION_TTL_HOURS = 12;
const SUMMARY_TTL_HOURS = 24;
const MAX_SUMMARY_LENGTH = 1500;
export const MAX_MESSAGES_PER_CHANNEL = 10;

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

// In-flight DB hydrations keyed by cache key: prevents duplicate reads and allows awaiting.
const pendingHydrations = new Map<string, Promise<void>>();

// Tracks bulk-loaded scopes so live turns do not re-run the full STM SELECT query.
const bulkWarmedServers = new Set<string>();
const bulkWarmedUsers = new Set<string>();

// Functional unique-index conflict target used in all short_term_memories upserts.
const STM_CONFLICT = `(scope_kind, COALESCE(server_disc_id, ''), COALESCE(user_disc_id, ''), channel_disc_id, COALESCE(persona_id, 0))`;

// Non-destructive insert guarantees the row exists before later updates because it leaves existing summaries,
// categories, and counters untouched.
async function ensureStmRow(
  scopeKind: "server" | "user",
  serverDiscId: string | null,
  userDiscId: string | null,
  channelDiscId: string,
  personaId: number | null,
  personaLineageId: number | null,
): Promise<void> {
  await sql.unsafe(
    `INSERT INTO short_term_memories
       (scope_kind, server_disc_id, user_disc_id, channel_disc_id, persona_id, persona_lineage_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ${STM_CONFLICT} DO NOTHING`,
    [scopeKind, serverDiscId, userDiscId, channelDiscId, personaId, personaLineageId],
  );
}

async function upsertStmSummary(
  scopeKind: "server" | "user",
  serverDiscId: string | null,
  userDiscId: string | null,
  channelDiscId: string,
  personaId: number | null,
  personaLineageId: number | null,
  summary: string,
): Promise<void> {
  await sql.unsafe(
    `INSERT INTO short_term_memories
       (scope_kind, server_disc_id, user_disc_id, channel_disc_id, persona_id, persona_lineage_id, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT ${STM_CONFLICT}
     DO UPDATE SET summary = EXCLUDED.summary`,
    [scopeKind, serverDiscId, userDiscId, channelDiscId, personaId, personaLineageId, summary],
  );
}

// Summary-mode clear must null the DB column so cleared summaries do not resurrect from `hydrateEntryFromDb` on the
// next cache miss.
async function clearStmSummary(
  scopeKind: "server" | "user",
  serverDiscId: string | null,
  userDiscId: string | null,
  channelDiscId: string,
  personaId: number | null,
): Promise<void> {
  await sql.unsafe(
    `UPDATE short_term_memories
     SET summary = NULL
     WHERE scope_kind = $1
       AND COALESCE(server_disc_id, '') = COALESCE($2, '')
       AND COALESCE(user_disc_id, '')   = COALESCE($3, '')
       AND channel_disc_id = $4
       AND COALESCE(persona_id, 0) = COALESCE($5, 0)`,
    [scopeKind, serverDiscId, userDiscId, channelDiscId, personaId],
  );
}

async function upsertStmCategories(
  scopeKind: "server" | "user",
  serverDiscId: string | null,
  userDiscId: string | null,
  channelDiscId: string,
  personaId: number | null,
  personaLineageId: number | null,
  categories: Record<string, string>,
): Promise<void> {
  await sql.unsafe(
    `INSERT INTO short_term_memories
       (scope_kind, server_disc_id, user_disc_id, channel_disc_id, persona_id, persona_lineage_id, categories)
     VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB)
     ON CONFLICT ${STM_CONFLICT}
     DO UPDATE SET categories = EXCLUDED.categories`,
    [scopeKind, serverDiscId, userDiscId, channelDiscId, personaId, personaLineageId, JSON.stringify(categories)],
  );
}

async function incrementStmCounter(
  scopeKind: "server" | "user",
  serverDiscId: string | null,
  userDiscId: string | null,
  channelDiscId: string,
  personaId: number | null,
  personaLineageId: number | null,
): Promise<void> {
  await sql.unsafe(
    `INSERT INTO short_term_memories
       (scope_kind, server_disc_id, user_disc_id, channel_disc_id, persona_id, persona_lineage_id, turns_since_refresh)
     VALUES ($1, $2, $3, $4, $5, $6, 1)
     ON CONFLICT ${STM_CONFLICT}
     DO UPDATE SET turns_since_refresh = short_term_memories.turns_since_refresh + 1`,
    [scopeKind, serverDiscId, userDiscId, channelDiscId, personaId, personaLineageId],
  );
}

async function resetStmCounter(
  scopeKind: "server" | "user",
  serverDiscId: string | null,
  userDiscId: string | null,
  channelDiscId: string,
  personaId: number | null,
  personaLineageId: number | null,
  client: Pick<typeof sql, "unsafe"> = sql,
): Promise<void> {
  await client.unsafe(
    `INSERT INTO short_term_memories
       (scope_kind, server_disc_id, user_disc_id, channel_disc_id, persona_id, persona_lineage_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ${STM_CONFLICT}
     DO UPDATE SET
       turns_since_refresh = 0,
       last_refreshed_turn = short_term_memories.last_refreshed_turn + 1`,
    [scopeKind, serverDiscId, userDiscId, channelDiscId, personaId, personaLineageId],
  );
}

async function hydrateEntryFromDb(
  key: string,
  scopeKind: "server" | "user",
  serverDiscId: string | null,
  userDiscId: string | null,
  channelDiscId: string,
  personaId: number | null,
): Promise<void> {
  try {
    const rows = await sql.unsafe<ShortTermMemoryRow[]>(
      `SELECT * FROM short_term_memories
       WHERE scope_kind = $1
         AND COALESCE(server_disc_id, '') = COALESCE($2, '')
         AND COALESCE(user_disc_id, '')   = COALESCE($3, '')
         AND channel_disc_id = $4
         AND COALESCE(persona_id, 0) = COALESCE($5, 0)
       LIMIT 1`,
      [scopeKind, serverDiscId, userDiscId, channelDiscId, personaId],
    );

    const row = rows[0];
    if (row) warmRowIntoCache(key, row);
  } catch (error) {
    log.warn("[shortTermMemoryCache] Background DB hydration failed", { key, error });
  }
}

// Existing warm keys are never overwritten so concurrent live writes always win over stale DB state.
function warmRowIntoCache(key: string, row: ShortTermMemoryRow): void {
  if (cache.has(key)) return;
  // `sql.unsafe` returns JSONB `categories` as a raw string instead of a parsed object, so normalize it to avoid
  // character-by-character enumeration downstream.
  const normalizedCategories = normalizeStmCategories(row.categories);
  const hasCategories = Object.keys(normalizedCategories).length > 0;
  cache.set(key, {
    messages: [],
    summary: row.summary ?? undefined,
    categories: hasCategories ? normalizedCategories : undefined,
    turnsSinceRefresh: row.turns_since_refresh,
    lastRefreshedTurn: row.last_refreshed_turn,
    summarizedThrough: row.summarized_through?.getTime(),
    serverId: row.server_disc_id ?? "DM",
    channelId: row.channel_disc_id,
    personaId: row.persona_id ?? null,
    personaLineageId: row.persona_lineage_id ?? null,
    lastUpdated: row.updated_at ? row.updated_at.getTime() : Date.now(),
  });
}

function getUserCacheKey(userId: string, channelId: string, personaId?: number | null): string {
  if (personaId) return `${USER_CACHE_PREFIX}:${userId}:${channelId}:${personaId}`;
  return `${USER_CACHE_PREFIX}:${userId}:${channelId}`;
}

function getServerCacheKey(serverId: string, channelId: string, personaId?: number | null): string {
  if (personaId) {
    return `${SERVER_CACHE_PREFIX}:${serverId}:${channelId}:${personaId}`;
  }
  return `${SERVER_CACHE_PREFIX}:${serverId}:${channelId}`;
}

function isExpired(entry: ShortTermMemoryEntry): boolean {
  const now = Date.now();
  const age = now - entry.lastUpdated;

  const ttl = entry.summary ? SUMMARY_TTL_MS : CRUDE_CONVERSATION_TTL_MS;

  return age > ttl;
}

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
): void {
  const entry = cache.get(key) ?? { channelId, serverId, lastUpdated: Date.now(), messages };
  Object.assign(entry, {
    messages,
    serverId,
    serverName,
    channelName,
    personaId,
    personaLineageId,
    lastUpdated: Date.now(),
  });

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

function parseStmKey(key: string): {
  scopeKind: "server" | "user";
  discId: string;
  channelDiscId: string;
  personaId: number | null;
} | null {
  const userMatch = /^shortterm:user:([^:]+):([^:]+)(?::(\d+))?$/.exec(key);
  if (userMatch) {
    return {
      scopeKind: "user",
      discId: userMatch[1],
      channelDiscId: userMatch[2],
      personaId: userMatch[3] !== undefined ? Number(userMatch[3]) : null,
    };
  }
  const serverMatch = /^shortterm:server:([^:]+):([^:]+)(?::(\d+))?$/.exec(key);
  if (serverMatch) {
    return {
      scopeKind: "server",
      discId: serverMatch[1],
      channelDiscId: serverMatch[2],
      personaId: serverMatch[3] !== undefined ? Number(serverMatch[3]) : null,
    };
  }
  return null;
}

function getShortTermMemoryByKey(key: string): ShortTermMemoryEntry | undefined {
  const entry = cache.get(key);

  if (!entry) {
    stats.misses++;
    // Trigger a one-shot background DB hydration on miss so categories/summary
    // are available on the next request after a bot restart.
    if (!pendingHydrations.has(key)) {
      const parsed = parseStmKey(key);
      if (parsed) {
        const serverDiscId = parsed.scopeKind === "server" ? parsed.discId : null;
        const userDiscId = parsed.scopeKind === "user" ? parsed.discId : null;
        const promise = hydrateEntryFromDb(
          key,
          parsed.scopeKind,
          serverDiscId,
          userDiscId,
          parsed.channelDiscId,
          parsed.personaId,
        ).finally(() => pendingHydrations.delete(key));
        pendingHydrations.set(key, promise);
      }
    }
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

// Callers must await this before synchronous STM reads so post-restart turns see persisted data, and concurrent
// hydrations coalesce onto one query.
export async function preWarmStmEntry(
  scopeKind: "server" | "user",
  discId: string,
  channelId: string,
  personaId?: number | null,
): Promise<void> {
  const key =
    scopeKind === "server"
      ? getServerCacheKey(discId, channelId, personaId)
      : getUserCacheKey(discId, channelId, personaId);

  if (cache.has(key)) return;

  const inflight = pendingHydrations.get(key);
  if (inflight) {
    await inflight;
    return;
  }

  const serverDiscId = scopeKind === "server" ? discId : null;
  const userDiscId = scopeKind === "user" ? discId : null;
  const promise = hydrateEntryFromDb(key, scopeKind, serverDiscId, userDiscId, channelId, personaId ?? null).finally(
    () => pendingHydrations.delete(key),
  );
  pendingHydrations.set(key, promise);
  await promise;
}

// One-shot per server per process; await before getShortTermMemoriesForServer so cross-channel recall has every
// channel's row on the first turn after restart.
export async function preWarmServerStmEntries(serverDiscId: string): Promise<void> {
  if (!serverDiscId || serverDiscId === "DM" || bulkWarmedServers.has(serverDiscId)) return;

  // Sentinel key (real channel keys are numeric snowflakes, so no collision) used only
  // to dedupe the in-flight bulk query inside the existing pendingHydrations map.
  const inflightKey = `${SERVER_CACHE_PREFIX}:${serverDiscId}:__bulk__`;
  const inflight = pendingHydrations.get(inflightKey);
  if (inflight) {
    await inflight;
    return;
  }

  const promise = (async () => {
    try {
      const rows = await sql.unsafe<ShortTermMemoryRow[]>(
        "SELECT * FROM short_term_memories WHERE scope_kind = 'server' AND server_disc_id = $1",
        [serverDiscId],
      );
      for (const row of rows) {
        warmRowIntoCache(getServerCacheKey(serverDiscId, row.channel_disc_id, row.persona_id), row);
      }
      bulkWarmedServers.add(serverDiscId);
    } catch (error) {
      log.warn("[shortTermMemoryCache] Bulk server STM warm failed", { serverDiscId, error });
    }
  })().finally(() => pendingHydrations.delete(inflightKey));

  pendingHydrations.set(inflightKey, promise);
  await promise;
}

export async function preWarmUserStmEntries(userDiscId: string): Promise<void> {
  if (!userDiscId || bulkWarmedUsers.has(userDiscId)) return;

  const inflightKey = `${USER_CACHE_PREFIX}:${userDiscId}:__bulk__`;
  const inflight = pendingHydrations.get(inflightKey);
  if (inflight) {
    await inflight;
    return;
  }

  const promise = (async () => {
    try {
      const rows = await sql.unsafe<ShortTermMemoryRow[]>(
        "SELECT * FROM short_term_memories WHERE scope_kind = 'user' AND user_disc_id = $1",
        [userDiscId],
      );
      for (const row of rows) {
        warmRowIntoCache(getUserCacheKey(userDiscId, row.channel_disc_id, row.persona_id), row);
      }
      bulkWarmedUsers.add(userDiscId);
    } catch (error) {
      log.warn("[shortTermMemoryCache] Bulk user STM warm failed", { userDiscId, error });
    }
  })().finally(() => pendingHydrations.delete(inflightKey));

  pendingHydrations.set(inflightKey, promise);
  await promise;
}

export function filterUnwarmedStmUsers(userDiscIds: readonly string[]): string[] {
  return [...new Set(userDiscIds)].filter((id) => id && !bulkWarmedUsers.has(id));
}

export function warmUserStmRows(userDiscIds: readonly string[], rows: readonly ShortTermMemoryRow[]): void {
  for (const row of rows) {
    if (row.user_disc_id) {
      warmRowIntoCache(getUserCacheKey(row.user_disc_id, row.channel_disc_id, row.persona_id), row);
    }
  }
  for (const id of userDiscIds) bulkWarmedUsers.add(id);
}

function updateContentForKey(
  key: string,
  content: StmContent,
  serverId: string,
  channelId: string,
  serverName?: string,
  channelName?: string,
  personaId?: number | null,
  personaLineageId?: number | null,
): void {
  const entry = cache.get(key) ?? {
    messages: [],
    serverId,
    serverName,
    channelId,
    channelName,
    personaId,
    personaLineageId,
    lastUpdated: Date.now(),
  };
  Object.assign(entry, content, { lastUpdated: Date.now() });
  cache.set(key, entry);
}

export async function storeShortTermMemory(
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
): Promise<void> {
  try {
    if (!userId || !channelId || !serverId) {
      log.warn(
        `[shortTermMemoryCache] Invalid parameters for storeShortTermMemory - userId=${!!userId}, channelId=${!!channelId}, serverId=${!!serverId}`,
      );
      return;
    }

    const limitedMessages = messages.slice(-MAX_MESSAGES_PER_CHANNEL);
    const resolvedPersonaId = personaId ?? null;
    const resolvedLineageId = personaLineageId ?? null;
    storeMemoryEntry(
      getUserCacheKey(userId, channelId, personaId),
      channelId,
      limitedMessages,
      serverId,
      serverName,
      channelName,
      personaId,
      personaLineageId,
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
      );
    }

    const serverDiscId = serverId !== "DM" ? serverId : null;
    await Promise.all([
      ensureStmRow("user", serverDiscId, userId, channelId, resolvedPersonaId, resolvedLineageId).catch((err) =>
        log.warn("[shortTermMemoryCache] Failed to persist user STM row", { error: err }),
      ),
      serverDiscId &&
        ensureStmRow("server", serverDiscId, null, channelId, resolvedPersonaId, resolvedLineageId).catch((err) =>
          log.warn("[shortTermMemoryCache] Failed to persist server STM row", { error: err }),
        ),
    ]);
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

export function updateShortTermMemorySummary(
  userId: string,
  channelId: string,
  summary: string,
  serverId?: string,
  serverName?: string,
  channelName?: string,
  personaId?: number | null,
  personaLineageId?: number | null,
): void {
  try {
    if (!userId || !channelId || !summary) {
      log.warn(
        `[shortTermMemoryCache] Invalid parameters for updateShortTermMemorySummary - userId=${!!userId}, channelId=${!!channelId}, summary=${!!summary}`,
      );
      return;
    }

    const truncatedSummary = summary.length > MAX_SUMMARY_LENGTH ? summary.slice(0, MAX_SUMMARY_LENGTH) : summary;
    const resolvedPersonaId = personaId ?? null;
    const resolvedLineageId = personaLineageId ?? null;
    updateContentForKey(
      getUserCacheKey(userId, channelId, personaId),
      { summary: truncatedSummary },
      serverId || "unknown",
      channelId,
      serverName,
      channelName,
      personaId,
      personaLineageId,
    );

    if (serverId && serverId !== "DM") {
      updateContentForKey(
        getServerCacheKey(serverId, channelId, personaId),
        { summary: truncatedSummary },
        serverId,
        channelId,
        serverName,
        channelName,
        personaId,
        personaLineageId,
      );
    }

    const serverDiscId = serverId && serverId !== "DM" ? serverId : null;
    void upsertStmSummary(
      "user",
      serverDiscId,
      userId,
      channelId,
      resolvedPersonaId,
      resolvedLineageId,
      truncatedSummary,
    ).catch((err) => log.warn("[shortTermMemoryCache] Failed to persist STM summary (user scope)", { error: err }));
    if (serverId && serverId !== "DM") {
      void upsertStmSummary(
        "server",
        serverId,
        null,
        channelId,
        resolvedPersonaId,
        resolvedLineageId,
        truncatedSummary,
      ).catch((err) => log.warn("[shortTermMemoryCache] Failed to persist STM summary (server scope)", { error: err }));
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

export function invalidateShortTermMemory(
  userId: string,
  channelId: string,
  personaId?: number | null,
  serverId?: string,
): void {
  try {
    let clearedCount = 0;

    if (cache.delete(getUserCacheKey(userId, channelId, personaId))) {
      clearedCount++;
    }

    if (serverId && serverId !== "DM" && cache.delete(getServerCacheKey(serverId, channelId, personaId))) {
      clearedCount++;
    }

    if (clearedCount > 0) {
      stats.invalidations += clearedCount;
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

// Cache eviction alone lets hydrateEntryFromDb resurrect old summaries on a miss, so this also nulls the DB summary
// column.
export function clearShortTermMemorySummary(
  userId: string,
  channelId: string,
  personaId?: number | null,
  serverId?: string,
): void {
  try {
    invalidateShortTermMemory(userId, channelId, personaId, serverId);

    const serverDiscId = serverId && serverId !== "DM" ? serverId : null;
    const resolvedPersonaId = personaId ?? null;
    void clearStmSummary("user", serverDiscId, userId, channelId, resolvedPersonaId).catch((err) =>
      log.warn("[shortTermMemoryCache] Failed to clear STM summary in DB (user scope)", { error: err }),
    );
    if (serverDiscId) {
      void clearStmSummary("server", serverDiscId, null, channelId, resolvedPersonaId).catch((err) =>
        log.warn("[shortTermMemoryCache] Failed to clear STM summary in DB (server scope)", { error: err }),
      );
    }
  } catch (error) {
    log.error(
      `[shortTermMemoryCache] Failed to clear short-term memory summary - userId=${userId}, channelId=${channelId}`,
      error,
      {
        errorType: "CACHE_CLEAR_ERROR",
        metadata: { userDiscId: userId, channelId },
      },
    );
  }
}

// Fire-and-forget DB delete keeps synchronous clears non-failing; callers pass failureMessage and metadata so
// operators see scope without decoding SQL params.
interface StmDeleteInput {
  whereClause: string;
  params: Array<string | number | null>;
  failureMessage: string;
  metadata: Record<string, string | number | null | undefined>;
}

function deleteStmRowsInBackground({ whereClause, params, failureMessage, metadata }: StmDeleteInput): void {
  void sql
    .unsafe(`DELETE FROM short_term_memories WHERE ${whereClause}`, params)
    .catch((err) => log.warn(`[shortTermMemoryCache] ${failureMessage}`, { error: err, ...metadata }));
}

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

    deleteStmRowsInBackground({
      whereClause: "channel_disc_id = $1",
      params: [channelId],
      failureMessage: "Failed to delete STM from DB for channel",
      metadata: { channelId },
    });
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

    deleteStmRowsInBackground({
      whereClause: `scope_kind = 'server'
         AND server_disc_id = $1
         AND channel_disc_id = $2
         AND COALESCE(persona_id, 0) = COALESCE($3, 0)`,
      params: [serverId, channelId, personaId ?? null],
      failureMessage: "Failed to delete server STM from DB",
      metadata: { serverId, channelId },
    });
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

export function clearShortTermMemoryForUser(userId: string): void {
  try {
    evictUserShortTermMemory(userId);

    deleteStmRowsInBackground({
      whereClause: "scope_kind = 'user' AND user_disc_id = $1",
      params: [userId],
      failureMessage: "Failed to delete user STM from DB",
      metadata: { userId },
    });
  } catch (error) {
    log.error(`[shortTermMemoryCache] Failed to clear short-term memories for user - userId=${userId}`, error, {
      errorType: "CACHE_CLEAR_ERROR",
      metadata: { userDiscId: userId },
    });
  }
}

function evictUserShortTermMemory(userId?: string): void {
  const prefix = userId === undefined ? `${USER_CACHE_PREFIX}:` : `${USER_CACHE_PREFIX}:${userId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      stats.invalidations++;
    }
  }
  if (userId === undefined) bulkWarmedUsers.clear();
  else bulkWarmedUsers.delete(userId);
}

export function invalidateShortTermMemoryForUser(userId: string): void {
  evictUserShortTermMemory(userId);
  broadcastInvalidation("userStm", [[userId]]);
}

registerInvalidation(
  "userStm",
  z.tuple([invalidationKey]),
  ([user]) => invalidateShortTermMemoryForUser(user),
  () => evictUserShortTermMemory(),
);

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

// Reserved for emergency memory pressure only and excluded from normal invalidation because STM holds user-visible
// conversational state.
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

export async function updateShortTermMemoryCategories(
  userId: string,
  channelId: string,
  categories: Record<string, string>,
  serverId?: string,
  serverName?: string,
  channelName?: string,
  personaId?: number | null,
  personaLineageId?: number | null,
): Promise<void> {
  try {
    if (!userId || !channelId) {
      log.warn(
        `[shortTermMemoryCache] Invalid parameters for updateShortTermMemoryCategories - userId=${!!userId}, channelId=${!!channelId}`,
      );
      return;
    }

    const resolvedPersonaId = personaId ?? null;
    const resolvedLineageId = personaLineageId ?? null;
    updateContentForKey(
      getUserCacheKey(userId, channelId, personaId),
      { categories },
      serverId ?? "unknown",
      channelId,
      serverName,
      channelName,
      personaId,
      personaLineageId,
    );

    if (serverId && serverId !== "DM") {
      updateContentForKey(
        getServerCacheKey(serverId, channelId, personaId),
        { categories },
        serverId,
        channelId,
        serverName,
        channelName,
        personaId,
        personaLineageId,
      );
    }

    const serverDiscId = serverId && serverId !== "DM" ? serverId : null;
    await upsertStmCategories(
      "user",
      serverDiscId,
      userId,
      channelId,
      resolvedPersonaId,
      resolvedLineageId,
      categories,
    );
    if (serverId && serverId !== "DM") {
      await upsertStmCategories("server", serverId, null, channelId, resolvedPersonaId, resolvedLineageId, categories);
    }
  } catch (error) {
    log.error(
      `[shortTermMemoryCache] Failed to update STM categories - userId=${userId}, channelId=${channelId}`,
      error,
      {
        errorType: "CACHE_UPDATE_ERROR",
        metadata: { userDiscId: userId, channelId },
      },
    );
  }
}

type StmContent = { summary: string } | { categories: Record<string, string> };

type StmSnapshot = ReturnType<typeof snapshotStmContent>;
type StmContentRow = Pick<
  ShortTermMemoryRow,
  "scope_kind" | "summary" | "categories" | "summarized_through" | "last_refreshed_turn"
> & { stm_id: number };

const STM_SNAPSHOT_CHANGED = new Error("STM snapshot changed during the write");

export function snapshotStmContent(entry: ShortTermMemoryEntry) {
  return {
    entry,
    summary: entry.summary,
    categories: { ...entry.categories },
    summarizedThrough: entry.summarizedThrough,
    lastRefreshedTurn: entry.lastRefreshedTurn ?? 0,
  };
}

export function hasStmSnapshot(entry: ShortTermMemoryEntry | undefined, snapshot: StmSnapshot): boolean {
  return (
    entry === snapshot.entry &&
    entry.summary === snapshot.summary &&
    entry.summarizedThrough === snapshot.summarizedThrough &&
    (entry.lastRefreshedTurn ?? 0) === snapshot.lastRefreshedTurn &&
    isDeepStrictEqual(entry.categories ?? {}, snapshot.categories)
  );
}

export async function persistStmSummarization(
  scope: { serverId: string | null; userId: string; channelId: string; personaId: number | null },
  snapshot: StmSnapshot,
  content: StmContent,
  summarizedThrough: number | undefined,
): Promise<void> {
  const { serverId, userId, channelId, personaId } = scope;
  const userKey = getUserCacheKey(userId, channelId, personaId);
  const liveKey = serverId ? getServerCacheKey(serverId, channelId, personaId) : userKey;
  const userEntry = cache.get(userKey);
  const isCurrent = () => cache.get(userKey) === userEntry && hasStmSnapshot(cache.get(liveKey), snapshot);

  if (!userEntry) return;

  const written = await sql
    .begin(async (tx) => {
      const rows = await tx<StmContentRow[]>`
      SELECT stm_id, scope_kind, summary, categories, summarized_through, last_refreshed_turn
      FROM short_term_memories
      WHERE COALESCE(server_disc_id, '') = COALESCE(${serverId}, '')
        AND channel_disc_id = ${channelId}
        AND COALESCE(persona_id, 0) = COALESCE(${personaId}, 0)
        AND ((scope_kind = 'user' AND user_disc_id = ${userId})
          OR (scope_kind = 'server' AND user_disc_id IS NULL AND ${serverId}::TEXT IS NOT NULL))
      ORDER BY stm_id
      FOR UPDATE
    `;
      const liveRow = rows.find((row) => row.scope_kind === (serverId ? "server" : "user"));
      if (
        rows.length !== (serverId ? 2 : 1) ||
        !liveRow ||
        !isCurrent() ||
        (liveRow.summary ?? undefined) !== snapshot.summary ||
        liveRow.summarized_through?.getTime() !== snapshot.summarizedThrough ||
        liveRow.last_refreshed_turn !== snapshot.lastRefreshedTurn ||
        !isDeepStrictEqual(normalizeStmCategories(liveRow.categories), snapshot.categories)
      ) {
        return false;
      }

      const summary = "summary" in content ? content.summary : null;
      const categories = "categories" in content ? JSON.stringify(content.categories) : null;
      await tx`
      UPDATE short_term_memories
      SET summary = COALESCE(${summary}, summary),
          categories = COALESCE(${categories}::JSONB, categories),
          summarized_through = ${summarizedThrough === undefined ? null : new Date(summarizedThrough)}
      WHERE stm_id IN (${rows[0].stm_id}, ${rows[1]?.stm_id ?? rows[0].stm_id})
    `;
      await resetStmTurnCounter(channelId, serverId, serverId ? null : userId, personaId, tx);
      if (!isCurrent()) throw STM_SNAPSHOT_CHANGED;
      return true;
    })
    .catch((error: unknown) => {
      if (error === STM_SNAPSHOT_CHANGED) return false;
      throw error;
    });

  if (!written || !isCurrent()) return;

  for (const entry of new Set([snapshot.entry, userEntry])) {
    Object.assign(entry, content, { summarizedThrough, lastUpdated: Date.now() });
  }
  resetCachedStmCounter(snapshot.entry);
}

// Guild live STM is server-shared (serverId, userId=null) and DM STM is user-scoped (userId, serverId=null), because
// serverId truthiness selects the scope.
export async function incrementStmTurnCounter(
  channelId: string,
  serverId: string | null,
  userId: string | null,
  personaId?: number | null,
): Promise<void> {
  try {
    if (!serverId && !userId) return;
    const resolvedPersonaId = personaId ?? null;
    const scopeKind = serverId ? "server" : "user";
    const cacheKey = serverId
      ? getServerCacheKey(serverId, channelId, personaId)
      : getUserCacheKey(userId ?? "", channelId, personaId);
    const entry = cache.get(cacheKey);
    if (entry) {
      entry.turnsSinceRefresh = (entry.turnsSinceRefresh ?? 0) + 1;
    }
    await incrementStmCounter(scopeKind, serverId, userId, channelId, resolvedPersonaId, null);
  } catch (error) {
    log.error("[shortTermMemoryCache] Failed to increment STM turn counter", error, {
      errorType: "CACHE_UPDATE_ERROR",
      metadata: { channelId, serverId, userId },
    });
  }
}

function resetCachedStmCounter(entry: ShortTermMemoryEntry): void {
  entry.lastRefreshedTurn = (entry.lastRefreshedTurn ?? 0) + 1;
  entry.turnsSinceRefresh = 0;
}

// Mutually exclusive serverId/userId scope matches incrementStmTurnCounter, and last_refreshed_turn advances
// monotonically so callers can track refresh epochs.
export async function resetStmTurnCounter(
  channelId: string,
  serverId: string | null,
  userId: string | null,
  personaId?: number | null,
  transaction?: TransactionSQL,
): Promise<void> {
  if (!serverId && !userId) return;
  const resolvedPersonaId = personaId ?? null;
  const scopeKind = serverId ? "server" : "user";
  if (transaction) {
    await resetStmCounter(scopeKind, serverId, userId, channelId, resolvedPersonaId, null, transaction);
    return;
  }

  try {
    const cacheKey = serverId
      ? getServerCacheKey(serverId, channelId, personaId)
      : getUserCacheKey(userId ?? "", channelId, personaId);
    const entry = cache.get(cacheKey);
    if (entry) resetCachedStmCounter(entry);
    await resetStmCounter(scopeKind, serverId, userId, channelId, resolvedPersonaId, null);
  } catch (error) {
    log.error("[shortTermMemoryCache] Failed to reset STM turn counter", error, {
      errorType: "CACHE_UPDATE_ERROR",
      metadata: { channelId, serverId, userId },
    });
  }
}
