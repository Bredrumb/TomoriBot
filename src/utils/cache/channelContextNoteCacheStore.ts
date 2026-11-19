import { z } from "zod";
import {
  broadcastInvalidation,
  registerInvalidation,
  invalidationKey,
  invalidationDatabaseId,
} from "@/utils/cache/invalidationBus";
import { TOMORI_STATE_CACHE_TTL_MS } from "@/constants/cacheTtl";

export type ChannelContextNote = {
  note: string;
  depth: number;
};

const channelContextNoteCache = new Map<string, { entry: ChannelContextNote | null; expiresAt: number }>();

const CACHE_TTL_MS = TOMORI_STATE_CACHE_TTL_MS;

function getCacheKey(serverId: number, channelDiscId: string): string {
  return `${serverId}:${channelDiscId}`;
}

// Cached null represents a negative hit (no note) so callers can distinguish it from undefined on cache miss or
// expiry.
export function getChannelContextNoteCacheEntry(
  serverId: number,
  channelDiscId: string,
): ChannelContextNote | null | undefined {
  const cached = channelContextNoteCache.get(getCacheKey(serverId, channelDiscId));
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    channelContextNoteCache.delete(getCacheKey(serverId, channelDiscId));
    return undefined;
  }
  return cached.entry;
}

export function setChannelContextNoteCache(
  serverId: number,
  channelDiscId: string,
  entry: ChannelContextNote | null,
): void {
  channelContextNoteCache.set(getCacheKey(serverId, channelDiscId), {
    entry,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export function invalidateChannelContextNoteCache(serverId: number, channelDiscId: string): void {
  channelContextNoteCache.delete(getCacheKey(serverId, channelDiscId));
  broadcastInvalidation("channelContextNote", [[String(serverId), channelDiscId]]);
}

export function invalidateAllChannelContextNoteCacheForServer(serverId: number): void {
  const prefix = `${serverId}:`;
  for (const key of channelContextNoteCache.keys()) {
    if (key.startsWith(prefix)) {
      channelContextNoteCache.delete(key);
    }
  }
  broadcastInvalidation("channelContextNote", [[String(serverId)]]);
}

function clearChannelContextNoteCache(): void {
  channelContextNoteCache.clear();
}

registerInvalidation(
  "channelContextNote",
  z.union([z.tuple([invalidationDatabaseId]), z.tuple([invalidationDatabaseId, invalidationKey])]),
  ([server, channel]) => {
    if (channel === undefined) invalidateAllChannelContextNoteCacheForServer(server);
    else invalidateChannelContextNoteCache(server, channel);
  },
  clearChannelContextNoteCache,
);
