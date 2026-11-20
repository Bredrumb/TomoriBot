import type { Guild } from "discord.js";
import { sql, withTransientDbRetry } from "../db/client";
import { log } from "../misc/logger";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";

export async function lazySyncGuildStickers(guild: Guild, serverId: number, forceFetch = false): Promise<boolean> {
  try {
    const lastSync = await serverRepository.getStickerSyncStatus(serverId);

    const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
    const now = new Date();
    const cachedStickerCount = lastSync.count;

    const discordCachePopulated = guild.stickers.cache.size > 0;
    let hasCountMismatch = false;
    let guildStickerCount = guild.stickers.cache.size;

    if (discordCachePopulated) {
      hasCountMismatch = Math.abs(guildStickerCount - cachedStickerCount) > 2;
    } else if (cachedStickerCount > 0) {
      log.info(
        `Discord sticker cache empty but DB has ${cachedStickerCount} stickers for ${guild.name} - fetching to verify count`,
      );
      await guild.stickers.fetch();
      guildStickerCount = guild.stickers.cache.size;
      hasCountMismatch = Math.abs(guildStickerCount - cachedStickerCount) > 2;
    }

    const needsFetch =
      forceFetch ||
      lastSync.count === 0 ||
      !lastSync.lastUpdated ||
      hasCountMismatch ||
      now.getTime() - new Date(lastSync.lastUpdated).getTime() > CACHE_DURATION_MS;

    if (!needsFetch) {
      return false;
    }

    const refreshReason = forceFetch
      ? "forced"
      : hasCountMismatch
        ? `count mismatch (guild: ${guildStickerCount}, DB: ${cachedStickerCount})`
        : lastSync.count === 0
          ? "no stickers in DB"
          : "cache stale";

    log.info(`Lazy fetching stickers for guild ${guild.name} (${guild.id})... Reason: ${refreshReason}`);
    log.info(`[Sticker Lazy Sync] Using server_id: ${serverId}`);

    if (!discordCachePopulated || (discordCachePopulated && hasCountMismatch)) {
      await guild.stickers.fetch();
    }
    const currentStickers = Array.from(guild.stickers.cache.values());

    log.info(`Fetched ${currentStickers.length} sticker(s) from Discord for guild ${guild.name}`);

    await withTransientDbRetry(
      () =>
        sql.transaction(async (tx) => {
          await serverRepository.syncStickers(tx, serverId, currentStickers);
        }),
      `lazy sync stickers for guild ${guild.id}`,
    );

    log.info("[Sticker Lazy Sync] Transaction completed successfully");

    return true;
  } catch (error) {
    log.error(`Failed to lazy sync stickers for guild ${guild.name} (${guild.id}):`, error, {
      serverId,
      errorType: "StickerLazySyncError",
      metadata: { guildId: guild.id },
    });
    return false;
  }
}
