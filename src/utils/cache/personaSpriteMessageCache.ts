import type { PersonaSpriteMessageRow } from "@/types/db/schema";
import {
  personaSpriteMessageRepository,
  type PersonaSpriteMessageRecordInput,
} from "@/utils/db/repositories/PersonaSpriteMessageRepository";
import { log } from "@/utils/misc/logger";

// Sent message sprites are immutable, so TTL only bounds memory without invalidation, and negative entries cache
// plain sends to avoid repeat DB queries.

const CACHE_TTL_MS = 120 * 60 * 1000;

const parsedRetentionDays = Number.parseInt(process.env.PERSONA_SPRITE_MESSAGE_RETENTION_DAYS || "30", 10);
const RETENTION_DAYS = Number.isFinite(parsedRetentionDays) && parsedRetentionDays > 0 ? parsedRetentionDays : 30;

// Housekeeping internals (not operational limits), both piggybacked on the write path so no timer
// wiring is needed. The sweep is time-gated, not size-gated: the production working set peaks just
// under any threshold high enough to be cheap, so a size gate never fired and expired entries stayed
// until restart. A lower size gate would rescan the whole map on every insert once it held fresh entries.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

type CachedSpriteMessage = {
  record: PersonaSpriteMessageRow | null;
  expiresAt: number;
};

const spriteMessageCache = new Map<string, CachedSpriteMessage>();
let lastPruneAt = 0;
let lastSweepAt = Date.now();

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
  const now = Date.now();
  if (now - lastSweepAt >= SWEEP_INTERVAL_MS) {
    lastSweepAt = now;
    sweepExpiredEntries(now);
  }
  spriteMessageCache.set(messageDiscId, {
    record,
    expiresAt: now + CACHE_TTL_MS,
  });
}

function sweepExpiredEntries(now: number): void {
  for (const [messageDiscId, entry] of spriteMessageCache) {
    if (entry.expiresAt <= now) {
      spriteMessageCache.delete(messageDiscId);
    }
  }
}

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

export async function getPersonaSpriteMessageRecord(messageDiscId: string): Promise<PersonaSpriteMessageRow | null> {
  const cached = getFreshEntry(messageDiscId);
  if (cached !== undefined) {
    return cached.record;
  }

  const rows = await personaSpriteMessageRepository.getByMessageIds([messageDiscId]);
  if (!rows) {
    return null;
  }

  const record = rows.get(messageDiscId) ?? null;
  setEntry(messageDiscId, record);
  return record;
}

// DB write failures are logged and swallowed because a lost mapping safely degrades future context labels to the
// plain persona name.
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
