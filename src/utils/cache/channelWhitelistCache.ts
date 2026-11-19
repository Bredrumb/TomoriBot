import { z } from "zod";
import { broadcastInvalidation, registerInvalidation, invalidationKey } from "@/utils/cache/invalidationBus";
import type { WhitelistCheckResult } from "@/types/misc/channelWhitelist";
import { whitelistRepository } from "@/utils/db/repositories/WhitelistRepository";

const whitelistCache = new Map<string, { result: WhitelistCheckResult; expiresAt: number }>();

let cacheHits = 0;
let cacheMisses = 0;

const CACHE_TTL_MS = 5 * 60 * 1000;

function getCacheKey(
  serverDiscId: string,
  channelDiscId: string,
  memberRoleDiscIds?: string[],
  parentChannelDiscId?: string,
): string {
  let roleSignature = "unknown";

  if (memberRoleDiscIds !== undefined) {
    roleSignature = memberRoleDiscIds.length > 0 ? memberRoleDiscIds.slice().sort().join(",") : "none";
  }

  const parentSig = parentChannelDiscId || "none";
  return `${serverDiscId}:${channelDiscId}:${parentSig}:${roleSignature}`;
}

export async function getCachedWhitelistStatus(
  serverDiscId: string,
  channelDiscId: string,
  memberRoleDiscIds?: string[],
  parentChannelDiscId?: string,
): Promise<WhitelistCheckResult> {
  const cacheKey = getCacheKey(serverDiscId, channelDiscId, memberRoleDiscIds, parentChannelDiscId);
  const now = Date.now();

  const cached = whitelistCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    cacheHits++;
    return cached.result;
  }

  cacheMisses++;

  const result = await whitelistRepository.checkChannelWhitelist(
    serverDiscId,
    channelDiscId,
    memberRoleDiscIds,
    parentChannelDiscId,
  );

  whitelistCache.set(cacheKey, {
    result,
    expiresAt: now + CACHE_TTL_MS,
  });

  return result;
}

export function invalidateWhitelistCache(serverDiscId: string, channelDiscId?: string): void {
  for (const key of whitelistCache.keys()) {
    const [server, channel, parent] = key.split(":");
    if (server === serverDiscId && (!channelDiscId || channel === channelDiscId || parent === channelDiscId)) {
      whitelistCache.delete(key);
    }
  }
  broadcastInvalidation("whitelist", [channelDiscId === undefined ? [serverDiscId] : [serverDiscId, channelDiscId]]);
}

export function getWhitelistCacheStats(): {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
} {
  return {
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: getCacheHitRate(),
    size: whitelistCache.size,
  };
}

function getCacheHitRate(): number {
  const total = cacheHits + cacheMisses;
  if (total === 0) return 0;
  return (cacheHits / total) * 100;
}

export function clearWhitelistCache(): void {
  whitelistCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

registerInvalidation(
  "whitelist",
  z.union([z.tuple([invalidationKey]), z.tuple([invalidationKey, invalidationKey])]),
  ([server, channel]) => invalidateWhitelistCache(server, channel),
  clearWhitelistCache,
);
