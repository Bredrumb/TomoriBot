import type { PersonalSpotlightStatus } from "@/utils/db/repositories/UserRepository";
import { userRepository } from "@/utils/db/repositories/UserRepository";

const spotlightCache = new Map<string, { result: PersonalSpotlightStatus | null; expiresAt: number }>();

let cacheHits = 0;
let cacheMisses = 0;

const CACHE_TTL_MINUTES = Number.parseInt(process.env.PERSONAL_SPOTLIGHT_CACHE_TTL_MINUTES || "5", 10);
const CACHE_TTL_MS = CACHE_TTL_MINUTES * 60 * 1000;

function getCacheKey(serverId: number, userId: number, channelDiscId: string): string {
  return `${serverId}:${userId}:${channelDiscId}`;
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

  cacheMisses++;

  const result = await userRepository.getPersonalSpotlightStatus(serverId, userId, channelDiscId);
  spotlightCache.set(cacheKey, {
    result,
    expiresAt: now + CACHE_TTL_MS,
  });

  return result;
}

export function invalidatePersonalSpotlightCache(serverId: number, userId?: number, channelDiscId?: string): void {
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
