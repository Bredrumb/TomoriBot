import type { PersonalSpotlightStatus } from "@/utils/db/repositories/UserRepository";
import { userRepository } from "@/utils/db/repositories/UserRepository";

const spotlightCache = new Map<string, { result: PersonalSpotlightStatus | null; expiresAt: number }>();

/**
 * Per-server gate so a server that has never configured a spotlight never creates an entry in the
 * server/user/channel-keyed cache below.
 *
 * Any new write path must call {@link invalidatePersonalSpotlightCache}, or this keeps answering
 * "none" for up to the TTL.
 */
const serverHasSpotlights = new Map<number, { hasAny: boolean; expiresAt: number }>();

let cacheHits = 0;
let cacheMisses = 0;

const CACHE_TTL_MINUTES = Number.parseInt(process.env.PERSONAL_SPOTLIGHT_CACHE_TTL_MINUTES || "5", 10);
const CACHE_TTL_MS = CACHE_TTL_MINUTES * 60 * 1000;

const MAX_ENTRIES = Number.parseInt(process.env.PERSONAL_SPOTLIGHT_CACHE_MAX_ENTRIES || "2000", 10);

function getCacheKey(serverId: number, userId: number, channelDiscId: string): string {
  return `${serverId}:${userId}:${channelDiscId}`;
}

/**
 * Bound the cache before inserting.
 *
 * The TTL above is consulted only on read, so nothing expires on its own. Expired entries go first,
 * then oldest-inserted, which relies on Map preserving insertion order.
 */
function evictForInsert(now: number): void {
  if (spotlightCache.size < MAX_ENTRIES) return;

  for (const [key, entry] of spotlightCache) {
    if (entry.expiresAt <= now) spotlightCache.delete(key);
  }

  while (spotlightCache.size >= MAX_ENTRIES) {
    const oldest = spotlightCache.keys().next();
    if (oldest.done) break;
    spotlightCache.delete(oldest.value);
  }
}

export async function getCachedPersonalSpotlightStatus(
  serverId: number,
  userId: number,
  channelDiscId: string,
): Promise<PersonalSpotlightStatus | null> {
  const cacheKey = getCacheKey(serverId, userId, channelDiscId);
  const now = Date.now();
  const cached = spotlightCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    cacheHits++;
    return cached.result;
  }

  const gate = serverHasSpotlights.get(serverId);
  if (gate && gate.expiresAt > now) {
    if (!gate.hasAny) {
      cacheHits++;
      return null;
    }
  } else {
    const hasAny = await userRepository.serverHasPersonalSpotlights(serverId);
    serverHasSpotlights.set(serverId, { hasAny, expiresAt: now + CACHE_TTL_MS });
    if (!hasAny) {
      cacheMisses++;
      return null;
    }
  }

  cacheMisses++;

  const result = await userRepository.getPersonalSpotlightStatus(serverId, userId, channelDiscId);
  evictForInsert(now);
  spotlightCache.set(cacheKey, {
    result,
    expiresAt: now + CACHE_TTL_MS,
  });

  return result;
}

export function invalidatePersonalSpotlightCache(serverId: number, userId?: number, channelDiscId?: string): void {
  // The first spotlight created or the last removed flips the gate, so it drops with the entries.
  serverHasSpotlights.delete(serverId);

  const prefixParts = [serverId.toString()];
  if (userId !== undefined) {
    prefixParts.push(userId.toString());
  }
  if (channelDiscId !== undefined) {
    prefixParts.push(channelDiscId);
  }
  const prefix = `${prefixParts.join(":")}${channelDiscId !== undefined ? "" : ":"}`;

  for (const key of spotlightCache.keys()) {
    if (key.startsWith(prefix)) {
      spotlightCache.delete(key);
    }
  }
}

export function clearPersonalSpotlightCache(): void {
  spotlightCache.clear();
  serverHasSpotlights.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

export function getPersonalSpotlightCacheStats(): {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
} {
  const total = cacheHits + cacheMisses;
  return {
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: total > 0 ? (cacheHits / total) * 100 : 0,
    size: spotlightCache.size,
  };
}
