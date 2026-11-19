import { z } from "zod";
import { broadcastInvalidation, registerInvalidation, invalidationDatabaseId } from "@/utils/cache/invalidationBus";
import type { Guild } from "discord.js";
import type { CustomExpressionRow, ServerEmojiRow, ServerStickerRow } from "@/types/db/schema";
import { serverRepository } from "@/utils/db/repositories";
import { log } from "../misc/logger";
import { lazySyncGuildEmojis } from "./emojiLazySync";
import { lazySyncGuildStickers } from "./stickerLazySync";

interface EmojiStickerCacheEntry {
  emojis: ServerEmojiRow[];
  stickers: ServerStickerRow[];
  customs: CustomExpressionRow[];
  emojisLoaded: boolean;
  stickersLoaded: boolean;
  cachedAt: number;
}

const cache = new Map<number, EmojiStickerCacheEntry>();

const MEMORY_CACHE_DURATION_MS = 10 * 60 * 1000;

let cacheHits = 0;
let cacheMisses = 0;

export async function loadEmojiStickerCache(
  serverId: number,
  guild: Guild,
  emojiUsageEnabled: boolean,
  stickerUsageEnabled: boolean,
): Promise<{
  emojis: ServerEmojiRow[] | null;
  stickers: ServerStickerRow[] | null;
  customs: CustomExpressionRow[] | null;
}> {
  if (!emojiUsageEnabled && !stickerUsageEnabled) {
    return { emojis: null, stickers: null, customs: null };
  }

  const now = Date.now();
  const cachedEntry = cache.get(serverId);

  if (cachedEntry) {
    const cacheAge = now - cachedEntry.cachedAt;
    if (
      cacheAge < MEMORY_CACHE_DURATION_MS &&
      (!emojiUsageEnabled || cachedEntry.emojisLoaded) &&
      (!stickerUsageEnabled || cachedEntry.stickersLoaded)
    ) {
      cacheHits++;
      return {
        emojis: emojiUsageEnabled ? cachedEntry.emojis : null,
        stickers: stickerUsageEnabled ? cachedEntry.stickers : null,
        customs: stickerUsageEnabled ? cachedEntry.customs : null,
      };
    }
  }

  cacheMisses++;

  try {
    if (emojiUsageEnabled) {
      await lazySyncGuildEmojis(guild, serverId);
    }
    if (stickerUsageEnabled) {
      await lazySyncGuildStickers(guild, serverId);
    }

    let emojis: ServerEmojiRow[] | null = null;
    let stickers: ServerStickerRow[] | null = null;
    let customs: CustomExpressionRow[] | null = null;

    if (emojiUsageEnabled) {
      emojis = await serverRepository.loadEmojis(serverId);
    }

    if (stickerUsageEnabled) {
      stickers = await serverRepository.loadStickersByInternalId(serverId);
      customs = await serverRepository.loadCustomExpressions(serverId);
    }

    cache.set(serverId, {
      emojis: emojis || [],
      stickers: stickers || [],
      customs: customs || [],
      emojisLoaded: emojiUsageEnabled,
      stickersLoaded: stickerUsageEnabled,
      cachedAt: now,
    });

    return { emojis, stickers, customs };
  } catch (error) {
    log.error(`[Emoji/Sticker Cache] Error loading data for server ${serverId}:`, error);

    if (cachedEntry) {
      log.warn(`[Emoji/Sticker Cache] Returning stale cache for server ${serverId} due to error`);
      return {
        emojis: emojiUsageEnabled ? cachedEntry.emojis : null,
        stickers: stickerUsageEnabled ? cachedEntry.stickers : null,
        // A stale whitelist can expose media after access was revoked, so customs fail closed.
        customs: null,
      };
    }

    return { emojis: null, stickers: null, customs: null };
  }
}

export function invalidateEmojiStickerCache(serverId: number): void {
  cache.delete(serverId);
  broadcastInvalidation("emojiSticker", [[String(serverId)]]);
}

export function clearEmojiStickerCache(): void {
  cache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

export function getEmojiStickerCacheStats(): {
  hits: number;
  misses: number;
  hitRate: string;
  cacheSize: number;
} {
  const total = cacheHits + cacheMisses;
  const hitRate = total > 0 ? `${((cacheHits / total) * 100).toFixed(2)}%` : "N/A";

  return {
    hits: cacheHits,
    misses: cacheMisses,
    hitRate,
    cacheSize: cache.size,
  };
}

registerInvalidation(
  "emojiSticker",
  z.tuple([invalidationDatabaseId]),
  ([server]) => invalidateEmojiStickerCache(server),
  clearEmojiStickerCache,
);
