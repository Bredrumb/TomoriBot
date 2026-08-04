import type { Guild } from "discord.js";
import { sql, withTransientDbRetry } from "../db/client";
import { log } from "../misc/logger";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";

/**
 * Lazy sync stickers for a guild - only fetches from Discord if needed
 *
 * This function implements lazy loading for stickers:
 * 1. Checks if stickers exist in DB for this server
 * 2. Checks if they were synced recently (within CACHE_DURATION)
 * 3. If stale or missing, fetches from Discord API and syncs to DB
 *
 * This avoids expensive startup fetches while ensuring fresh data.
 *
 * @param guild - Discord guild to sync stickers for
 * @param serverId - Internal database server ID
 * @param forceFetch - Force fetch even if cache is fresh (default: false)
 * @returns True if sync was performed, false if cache was fresh
 */
export async function lazySyncGuildStickers(guild: Guild, serverId: number, forceFetch = false): Promise<boolean> {
  try {
    const lastSync = await serverRepository.getStickerSyncStatus(serverId);

    const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
    const now = new Date();
    const cachedStickerCount = lastSync.count;

    // Smart count mismatch detection
    // Check if Discord.js has stickers cached (from GUILD_CREATE or previous fetch)
    const discordCachePopulated = guild.stickers.cache.size > 0;
    let hasCountMismatch = false;
    let guildStickerCount = guild.stickers.cache.size;

    if (discordCachePopulated) {
      hasCountMismatch = Math.abs(guildStickerCount - cachedStickerCount) > 2;
    } else if (cachedStickerCount > 0) {
      // Discord cache is EMPTY but DB has stickers - suspicious!
      // This indicates bot restart/rejoin - fetch to verify count
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

    // Fetch stickers from Discord API (if not already fetched in step 3)
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
