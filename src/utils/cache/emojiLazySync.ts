import type { Guild } from "discord.js";
import { sql, withTransientDbRetry } from "../db/client";
import { log } from "../misc/logger";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";

export async function lazySyncGuildEmojis(guild: Guild, serverId: number, forceFetch = false): Promise<boolean> {
  try {
    const lastSync = await serverRepository.getEmojiSyncStatus(serverId);

    const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
    const now = new Date();
    const cachedEmojiCount = lastSync.count;

    const discordCachePopulated = guild.emojis.cache.size > 0;
    let hasCountMismatch = false;
    let guildEmojiCount = guild.emojis.cache.size;

    if (discordCachePopulated) {
      hasCountMismatch = Math.abs(guildEmojiCount - cachedEmojiCount) > 2;
    } else if (cachedEmojiCount > 0) {
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

    if (!discordCachePopulated || (discordCachePopulated && hasCountMismatch)) {
      await guild.emojis.fetch();
    }
    const currentEmojis = Array.from(guild.emojis.cache.values());

    log.info(`Fetched ${currentEmojis.length} emoji(s) from Discord for guild ${guild.name}`);

    await withTransientDbRetry(
      () =>
        sql.transaction(async (tx) => {
          await serverRepository.syncEmojis(tx, serverId, currentEmojis);
        }),
      `lazy sync emojis for guild ${guild.id}`,
    );

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
