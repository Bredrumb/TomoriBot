import type { Guild } from "discord.js";
import { sql } from "../db/client";
import { log } from "../misc/logger";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";

/**
 * Lazy sync emojis for a guild - only fetches from Discord if needed
 *
 * This function implements lazy loading for emojis:
 * 1. Checks if emojis exist in DB for this server
 * 2. Checks if they were synced recently (within CACHE_DURATION)
 * 3. If stale or missing, fetches from Discord API and syncs to DB
 *
 * This avoids expensive startup fetches while ensuring fresh data.
 *
 * @param guild - Discord guild to sync emojis for
 * @param serverId - Internal database server ID
 * @param forceFetch - Force fetch even if cache is fresh (default: false)
 * @returns True if sync was performed, false if cache was fresh
 */
export async function lazySyncGuildEmojis(guild: Guild, serverId: number, forceFetch = false): Promise<boolean> {
  try {
    const lastSync = await serverRepository.getEmojiSyncStatus(serverId);

    const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
    const now = new Date();
    const cachedEmojiCount = lastSync.count;

    // Smart count mismatch detection
    // Check if Discord.js has emojis cached (from GUILD_CREATE or previous fetch)
    const discordCachePopulated = guild.emojis.cache.size > 0;
    let hasCountMismatch = false;
    let guildEmojiCount = guild.emojis.cache.size;

    if (discordCachePopulated) {
      hasCountMismatch = Math.abs(guildEmojiCount - cachedEmojiCount) > 2;
    } else if (cachedEmojiCount > 0) {
      // Discord cache is EMPTY but DB has emojis - suspicious!
      // This indicates bot restart/rejoin - fetch to verify count
      log.info(
        `Discord emoji cache empty but DB has ${cachedEmojiCount} emojis for ${guild.name} - fetching to verify count`,
      );
      await guild.emojis.fetch();
      guildEmojiCount = guild.emojis.cache.size;
      hasCountMismatch = Math.abs(guildEmojiCount - cachedEmojiCount) > 2;
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
        ? `count mismatch (guild: ${guildEmojiCount}, DB: ${cachedEmojiCount})`
        : lastSync.count === 0
          ? "no emojis in DB"
          : "cache stale";

    log.info(`Lazy fetching emojis for guild ${guild.name} (${guild.id})... Reason: ${refreshReason}`);
    log.info(`[Emoji Lazy Sync] Using server_id: ${serverId}`);

    // Fetch emojis from Discord API (if not already fetched in step 3)
    if (!discordCachePopulated || (discordCachePopulated && hasCountMismatch)) {
      await guild.emojis.fetch();
    }
    const currentEmojis = Array.from(guild.emojis.cache.values());

    log.info(`Fetched ${currentEmojis.length} emoji(s) from Discord for guild ${guild.name}`);

    await sql.transaction(async (tx) => {
      await serverRepository.syncEmojis(tx, serverId, currentEmojis);
    });

    log.info("[Emoji Lazy Sync] Transaction completed successfully");

    return true;
  } catch (error) {
    log.error(`Failed to lazy sync emojis for guild ${guild.name} (${guild.id}):`, error, {
      serverId,
      errorType: "EmojiLazySyncError",
      metadata: { guildId: guild.id },
    });
    return false;
  }
}
