import type { ChannelPromptMode } from "@/types/db/schema";

/**
 * Resolved per-channel system prompt override.
 * `null` (cached) means the channel has no override : a negative-cache hit.
 */
export type ChannelPromptOverride = {
  prompt: string;
  mode: ChannelPromptMode;
};

/**
 * In-memory TTL store for per-channel system prompt overrides.
 * Repository writes invalidate this store after successful override changes.
 */
const channelPromptCache = new Map<string, { override: ChannelPromptOverride | null; expiresAt: number }>();

const CACHE_TTL_MINUTES = Number.parseInt(process.env.TOMORI_STATE_CACHE_TTL_MINUTES || "10", 10);
const CACHE_TTL_MS = CACHE_TTL_MINUTES * 60 * 1000;

function getCacheKey(serverId: number, channelDiscId: string): string {
  return `${serverId}:${channelDiscId}`;
}

/**
 * Returns the cached override (or cached `null` for "no override"), or `undefined` on miss/expiry.
 */
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
}
