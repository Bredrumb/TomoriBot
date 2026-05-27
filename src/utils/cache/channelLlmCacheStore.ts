import type { LlmRow } from "@/types/db/schema";

/**
 * In-memory TTL store for per-channel LLM overrides.
 * Repository writes invalidate this store after successful override changes.
 */
const channelLlmCache = new Map<string, { llm: LlmRow | null; expiresAt: number }>();

const CACHE_TTL_MINUTES = Number.parseInt(process.env.TOMORI_STATE_CACHE_TTL_MINUTES || "10", 10);
const CACHE_TTL_MS = CACHE_TTL_MINUTES * 60 * 1000;

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
}
