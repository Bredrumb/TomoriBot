import { z } from "zod";
import {
  broadcastInvalidation,
  registerInvalidation,
  invalidationKey,
  invalidationDatabaseId,
} from "@/utils/cache/invalidationBus";
import type { LlmRow } from "@/types/db/schema";
import { TOMORI_STATE_CACHE_TTL_MS } from "@/constants/cacheTtl";

/**
 * In-memory TTL store for per-channel LLM overrides.
 * Repository writes invalidate this store after successful override changes.
 */
const channelLlmCache = new Map<string, { llm: LlmRow | null; expiresAt: number }>();

const CACHE_TTL_MS = TOMORI_STATE_CACHE_TTL_MS;

function getCacheKey(serverId: number, channelDiscId: string): string {
  return `${serverId}:${channelDiscId}`;
}

export function getChannelLlmCacheEntry(serverId: number, channelDiscId: string): LlmRow | null | undefined {
  const cached = channelLlmCache.get(getCacheKey(serverId, channelDiscId));
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    channelLlmCache.delete(getCacheKey(serverId, channelDiscId));
    return undefined;
  }
  return cached.llm;
}

export function setChannelLlmCache(serverId: number, channelDiscId: string, llm: LlmRow | null): void {
  channelLlmCache.set(getCacheKey(serverId, channelDiscId), { llm, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidateChannelLlmCache(serverId: number, channelDiscId: string): void {
  channelLlmCache.delete(getCacheKey(serverId, channelDiscId));
  broadcastInvalidation("channelLlm", [[String(serverId), channelDiscId]]);
}

export function getChannelLlmCacheSize(): number {
  return channelLlmCache.size;
}

export function clearChannelLlmCache(): void {
  channelLlmCache.clear();
}

export function invalidateAllChannelLlmCacheForServer(serverId: number): void {
  const prefix = `${serverId}:`;
  for (const key of channelLlmCache.keys()) {
    if (key.startsWith(prefix)) {
      channelLlmCache.delete(key);
    }
  }
  broadcastInvalidation("channelLlm", [[String(serverId)]]);
}

registerInvalidation(
  "channelLlm",
  z.union([z.tuple([invalidationDatabaseId]), z.tuple([invalidationDatabaseId, invalidationKey])]),
  ([server, channel]) => {
    if (channel === undefined) invalidateAllChannelLlmCacheForServer(server);
    else invalidateChannelLlmCache(server, channel);
  },
  clearChannelLlmCache,
);
