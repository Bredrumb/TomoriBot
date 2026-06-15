import type { PersonaSpriteMessageRow } from "@/types/db/schema";
import {
  personaSpriteMessageRepository,
  type PersonaSpriteMessageRecordInput,
} from "@/utils/db/repositories/PersonaSpriteMessageRepository";
import { log } from "@/utils/misc/logger";

/**
 * Read cache for the message → sprite-label mapping.
 *
 * Entries are immutable once written (a sent message's sprite never changes),
 * so this cache never needs invalidation — the TTL exists only to bound memory.
 * Negative results are cached too: most persona webhook messages are plain
 * (non-sprite) sends, and caching the miss avoids re-querying them every turn.
 */

const parsedCacheTtlMinutes = Number.parseInt(process.env.PERSONA_SPRITE_MESSAGE_CACHE_TTL_MINUTES || "120", 10);
const CACHE_TTL_MINUTES =
  Number.isFinite(parsedCacheTtlMinutes) && parsedCacheTtlMinutes > 0 ? parsedCacheTtlMinutes : 120;
const CACHE_TTL_MS = CACHE_TTL_MINUTES * 60 * 1000;

const parsedRetentionDays = Number.parseInt(process.env.PERSONA_SPRITE_MESSAGE_RETENTION_DAYS || "30", 10);
const RETENTION_DAYS = Number.isFinite(parsedRetentionDays) && parsedRetentionDays > 0 ? parsedRetentionDays : 30;

// Housekeeping internals (not operational limits): sweep expired cache entries
// once the map grows past the threshold, and prune aged DB rows at most once
// per interval, piggybacked on the write path so no timer wiring is needed.
const SWEEP_SIZE_THRESHOLD = 5000;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

type CachedSpriteMessage = {
  record: PersonaSpriteMessageRow | null;
  expiresAt: number;
};

const spriteMessageCache = new Map<string, CachedSpriteMessage>();
let lastPruneAt = 0;

function getFreshEntry(messageDiscId: string): CachedSpriteMessage | undefined {
  const cached = spriteMessageCache.get(messageDiscId);
  if (!cached) return undefined;

  if (cached.expiresAt <= Date.now()) {
    spriteMessageCache.delete(messageDiscId);
    return undefined;
  }

  return cached;
}

function setEntry(messageDiscId: string, record: PersonaSpriteMessageRow | null): void {
  if (spriteMessageCache.size >= SWEEP_SIZE_THRESHOLD) {
    sweepExpiredEntries();
  }
  spriteMessageCache.set(messageDiscId, {
    record,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function sweepExpiredEntries(): void {
  const now = Date.now();
  for (const [messageDiscId, entry] of spriteMessageCache) {
    if (entry.expiresAt <= now) {
      spriteMessageCache.delete(messageDiscId);
    }
  }
}

/**
 * Batch-resolves uncached message IDs in one DB round trip and seeds the cache,
 * including negative entries for IDs with no sprite mapping. Call this once per
 * context build with the webhook message IDs of the fetched history window so
 * subsequent per-message lookups are cache hits.
 */
export async function primePersonaSpriteMessageRecords(messageDiscIds: string[]): Promise<void> {
  const uncachedIds = messageDiscIds.filter((messageDiscId) => getFreshEntry(messageDiscId) === undefined);
  if (uncachedIds.length === 0) {
    return;
  }

  const rows = await personaSpriteMessageRepository.getByMessageIds(uncachedIds);
  if (!rows) {
    // Transient DB error: skip seeding so the next context build retries
    // instead of negative-caching real sprite messages.
    return;
  }

  for (const messageDiscId of uncachedIds) {
    setEntry(messageDiscId, rows.get(messageDiscId) ?? null);
  }
}

/**
 * Read-through lookup for a single message's sprite mapping.
 * Returns null when the message has no sprite mapping (cached negatively).
 */
export async function getPersonaSpriteMessageRecord(messageDiscId: string): Promise<PersonaSpriteMessageRow | null> {
  const cached = getFreshEntry(messageDiscId);
  if (cached !== undefined) {
    return cached.record;
  }

  const rows = await personaSpriteMessageRepository.getByMessageIds([messageDiscId]);
  if (!rows) {
    // Transient DB error: degrade to a plain label this turn without caching.
    return null;
  }

  const record = rows.get(messageDiscId) ?? null;
  setEntry(messageDiscId, record);
  return record;
}

/**
 * Persists a sprite-message mapping after a successful webhook send and seeds
 * the cache so the very next context build resolves it without a DB read.
 * Failures are logged and swallowed: a lost row degrades the future context
 * label to the plain persona name, never an error.
 */
export async function recordPersonaSpriteMessage(input: PersonaSpriteMessageRecordInput): Promise<void> {
  const written = await personaSpriteMessageRepository.record(input);
  if (written) {
    setEntry(input.messageDiscId, {
      message_disc_id: input.messageDiscId,
      persona_id: input.personaId,
      sprite_name: input.spriteName,
      channel_disc_id: input.channelDiscId,
    });
  }

  void pruneIfDue();
}

async function pruneIfDue(): Promise<void> {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) {
    return;
  }
  lastPruneAt = now;

  try {
    const deleted = await personaSpriteMessageRepository.pruneOlderThanDays(RETENTION_DAYS);
    if (deleted > 0) {
      log.info(`[PersonaSpriteMessageCache] Pruned ${deleted} sprite message rows older than ${RETENTION_DAYS} days`);
    }
  } catch (error) {
    log.warn("[PersonaSpriteMessageCache] Sprite message retention prune failed", error as Error);
  }
}

export function clearPersonaSpriteMessageCache(): void {
  spriteMessageCache.clear();
}

export function getPersonaSpriteMessageCacheSize(): number {
  return spriteMessageCache.size;
}
