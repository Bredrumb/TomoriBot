import { z } from "zod";
import { broadcastInvalidation, registerInvalidation, invalidationKey } from "@/utils/cache/invalidationBus";
import { PrivacyLevel, type UserRow } from "@/types/db/schema";
// Import UserRepository directly rather than the repositories barrel so this module avoids pulling every repository
// into a cycle.
import { userRepository } from "@/utils/db/repositories/UserRepository";
import { log } from "../misc/logger";

interface UserCacheEntry {
  userRow: UserRow | null;
  privacyLevel: PrivacyLevel;
  blacklistStatus: Map<string, boolean>;
  cachedAt: number;
}

const cache = new Map<string, UserCacheEntry>();

// Longer TTL than server config caches since user data changes even less frequently.
const USER_CACHE_DURATION_MS = 30 * 60 * 1000;

let cacheHits = 0;
let cacheMisses = 0;
let blacklistCacheHits = 0;
let blacklistCacheMisses = 0;

async function getOrCreateCacheEntry(userDiscId: string): Promise<UserCacheEntry> {
  const now = Date.now();
  const cachedEntry = cache.get(userDiscId);

  if (cachedEntry) {
    const cacheAge = now - cachedEntry.cachedAt;
    if (cacheAge < USER_CACHE_DURATION_MS) {
      cacheHits++;
      return cachedEntry;
    }
  }

  cacheMisses++;

  try {
    const [userRow, privacyLevel] = await Promise.all([
      userRepository.loadByDiscordId(userDiscId),
      userRepository.getPrivacyLevel(userDiscId),
    ]);

    const newEntry: UserCacheEntry = {
      userRow,
      privacyLevel,
      blacklistStatus: cachedEntry?.blacklistStatus ?? new Map(),
      cachedAt: now,
    };

    cache.set(userDiscId, newEntry);
    return newEntry;
  } catch (error) {
    log.error(`[User Cache] Error loading user data for ${userDiscId}:`, error);

    // Stale data was read successfully at some point, so it beats a guess in either direction.
    if (cachedEntry) {
      log.warn(`[User Cache] Returning stale cache for user ${userDiscId} due to error`);
      return cachedEntry;
    }

    // Default to FULL without writing to cache, because unknown privacy must fail closed while leaving it uncached
    // lets the next call retry.
    return {
      userRow: null,
      privacyLevel: PrivacyLevel.FULL,
      blacklistStatus: new Map(),
      cachedAt: now,
    };
  }
}

export async function getCachedUserRow(userDiscId: string): Promise<UserRow | null> {
  const entry = await getOrCreateCacheEntry(userDiscId);
  return entry.userRow;
}

export async function getCachedPrivacyLevel(userDiscId: string): Promise<PrivacyLevel> {
  const entry = await getOrCreateCacheEntry(userDiscId);
  return entry.privacyLevel;
}

export async function getCachedBlacklistStatus(serverDiscId: string, userDiscId: string): Promise<boolean> {
  try {
    return await getCachedBlacklistStatusOrThrow(serverDiscId, userDiscId);
  } catch (error) {
    // Unknown moderation status must block access without caching a blacklist entry.
    log.error(`[User Cache] Error checking blacklist for user ${userDiscId} in server ${serverDiscId}:`, error);
    return true;
  }
}

export async function getCachedBlacklistStatusOrThrow(serverDiscId: string, userDiscId: string): Promise<boolean> {
  const entry = await getOrCreateCacheEntry(userDiscId);

  const cachedStatus = entry.blacklistStatus.get(serverDiscId);
  if (cachedStatus !== undefined) {
    blacklistCacheHits++;
    return cachedStatus;
  }

  blacklistCacheMisses++;
  const isUserBlacklisted = await userRepository.isBlacklisted(serverDiscId, userDiscId);
  entry.blacklistStatus.set(serverDiscId, isUserBlacklisted);
  return isUserBlacklisted;
}

export function invalidateUserCache(userDiscId: string): void {
  cache.delete(userDiscId);
  broadcastInvalidation("user", [[userDiscId]]);
}

export function invalidateUserBlacklistCache(serverDiscId: string, userDiscId: string): void {
  const entry = cache.get(userDiscId);
  if (entry) {
    entry.blacklistStatus.delete(serverDiscId);
  }
  broadcastInvalidation("userBlacklist", [[serverDiscId, userDiscId]]);
}

export function invalidateAllUserBlacklistCacheForServer(serverDiscId: string): void {
  for (const entry of cache.values()) {
    entry.blacklistStatus.delete(serverDiscId);
  }
  broadcastInvalidation("userBlacklist", [[serverDiscId]]);
}

export function clearUserCache(): void {
  cache.clear();
  cacheHits = 0;
  cacheMisses = 0;
  blacklistCacheHits = 0;
  blacklistCacheMisses = 0;
}

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
  const hitRate = total > 0 ? `${((cacheHits / total) * 100).toFixed(2)}%` : "N/A";

  const blacklistTotal = blacklistCacheHits + blacklistCacheMisses;
  const blacklistHitRate = blacklistTotal > 0 ? `${((blacklistCacheHits / blacklistTotal) * 100).toFixed(2)}%` : "N/A";

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

registerInvalidation("user", z.tuple([invalidationKey]), ([user]) => invalidateUserCache(user), clearUserCache);
registerInvalidation(
  "userBlacklist",
  z.union([z.tuple([invalidationKey]), z.tuple([invalidationKey, invalidationKey])]),
  ([server, user]) => {
    if (user === undefined) invalidateAllUserBlacklistCacheForServer(server);
    else invalidateUserBlacklistCache(server, user);
  },
  clearUserCache,
);
