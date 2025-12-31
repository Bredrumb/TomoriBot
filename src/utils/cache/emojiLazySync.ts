import type { Guild } from "discord.js";
import { sql } from "../db/client";
import { log } from "../misc/logger";
import { syncEmojisToDatabase } from "../db/emojiStickerSync";

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
export async function lazySyncGuildEmojis(
	guild: Guild,
	serverId: number,
	forceFetch = false,
): Promise<boolean> {
	try {
		// 1. Check when emojis were last synced for this server
		const [lastSync] = await sql<Array<{ last_updated: Date; emoji_count: number }>>`
			SELECT
				MAX(updated_at) as last_updated,
				COUNT(*) as emoji_count
			FROM server_emojis
			WHERE server_id = ${serverId}
		`;

		// 2. Determine if we need to fetch
		const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
		const now = new Date();
		// Sanity check: if cache has very few emojis but guild actually has many, force refresh
		const guildEmojiCount = guild.emojis.cache.size;
		const cachedEmojiCount = lastSync?.emoji_count || 0;
		const hasCountMismatch = guildEmojiCount > 5 && cachedEmojiCount < 5;

		const needsFetch = forceFetch ||
			!lastSync ||
			lastSync.emoji_count === 0 ||
			!lastSync.last_updated ||
			hasCountMismatch ||
			(now.getTime() - new Date(lastSync.last_updated).getTime()) > CACHE_DURATION_MS;

		if (!needsFetch) {
			log.info(
				`Emoji cache is fresh for guild ${guild.name} (${guild.id}). Last synced: ${lastSync.last_updated}, Count: ${lastSync.emoji_count}`,
			);
			return false;
		}

		// 3. Fetch emojis from Discord API
		const refreshReason = forceFetch
			? "forced"
			: hasCountMismatch
				? `count mismatch (guild: ${guildEmojiCount}, DB: ${cachedEmojiCount})`
				: lastSync?.emoji_count === 0
					? "no emojis in DB"
					: "cache stale";

		log.info(
			`Lazy fetching emojis for guild ${guild.name} (${guild.id})... Reason: ${refreshReason}`,
		);
		log.info(`[Emoji Lazy Sync] Using server_id: ${serverId}`);

		await guild.emojis.fetch();
		const currentEmojis = Array.from(guild.emojis.cache.values());

		log.info(
			`Fetched ${currentEmojis.length} emoji(s) from Discord for guild ${guild.name}`,
		);

		// 4. Sync to database using shared helper
		await sql.transaction(async (tx) => {
			await syncEmojisToDatabase(tx, serverId, currentEmojis);
		});

		log.info("[Emoji Lazy Sync] Transaction completed successfully");

		return true;
	} catch (error) {
		log.error(
			`Failed to lazy sync emojis for guild ${guild.name} (${guild.id}):`,
			error,
			{
				serverId,
				errorType: "EmojiLazySyncError",
				metadata: { guildId: guild.id },
			},
		);
		// Don't throw - allow the bot to continue with possibly stale data
		return false;
	}
}

