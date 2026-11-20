import { z } from "zod";
import {
  broadcastInvalidation,
  registerInvalidation,
  invalidationKey,
  invalidationDatabaseId,
} from "@/utils/cache/invalidationBus";
import type { ChannelPromptMode } from "@/types/db/schema";
import { TOMORI_STATE_CACHE_TTL_MS } from "@/constants/cacheTtl";

export type ChannelPromptOverride = {
  prompt: string;
  mode: ChannelPromptMode;
};

const channelPromptCache = new Map<string, { override: ChannelPromptOverride | null; expiresAt: number }>();

const CACHE_TTL_MS = TOMORI_STATE_CACHE_TTL_MS;

function getCacheKey(serverId: number, channelDiscId: string): string {
  return `${serverId}:${channelDiscId}`;
}

// Cached null represents a negative hit (no override) so callers can distinguish it from undefined on cache miss or
// expiry.
export function getChannelPromptCacheEntry(
  serverId: number,
  channelDiscId: string,
): ChannelPromptOverride | null | undefined {
  const cached = channelPromptCache.get(getCacheKey(serverId, channelDiscId));
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    channelPromptCache.delete(getCacheKey(serverId, channelDiscId));
    return undefined;
  }
  return cached.override;
}

export function setChannelPromptCache(
  serverId: number,
  channelDiscId: string,
  override: ChannelPromptOverride | null,
): void {
  channelPromptCache.set(getCacheKey(serverId, channelDiscId), { override, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidateChannelPromptCache(serverId: number, channelDiscId: string): void {
  channelPromptCache.delete(getCacheKey(serverId, channelDiscId));
  broadcastInvalidation("channelPrompt", [[String(serverId), channelDiscId]]);
}

export function getChannelPromptCacheSize(): number {
  return channelPromptCache.size;
}

export function clearChannelPromptCache(): void {
  channelPromptCache.clear();
}

export function invalidateAllChannelPromptCacheForServer(serverId: number): void {
  const prefix = `${serverId}:`;
  for (const key of channelPromptCache.keys()) {
    if (key.startsWith(prefix)) {
      channelPromptCache.delete(key);
    }
  }
  broadcastInvalidation("channelPrompt", [[String(serverId)]]);
}

registerInvalidation(
  "channelPrompt",
  z.union([z.tuple([invalidationDatabaseId]), z.tuple([invalidationDatabaseId, invalidationKey])]),
  ([server, channel]) => {
    if (channel === undefined) invalidateAllChannelPromptCacheForServer(server);
    else invalidateChannelPromptCache(server, channel);
  },
  clearChannelPromptCache,
);
