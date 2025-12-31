import type { Guild } from "discord.js";
import { sql } from "../db/client";
import { log } from "../misc/logger";

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
export async function lazySyncGuildStickers(
	guild: Guild,
	serverId: number,
	forceFetch = false,
): Promise<boolean> {
	try {
		// 1. Check when stickers were last synced for this server
		const [lastSync] = await sql<Array<{ last_updated: Date; sticker_count: number }>>`
			SELECT
				MAX(updated_at) as last_updated,
				COUNT(*) as sticker_count
			FROM server_stickers
			WHERE server_id = ${serverId}
		`;

		// 2. Determine if we need to fetch
		const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
		const now = new Date();
		// Sanity check: if cache has very few stickers but guild actually has many, force refresh
		const guildStickerCount = guild.stickers.cache.size;
		const cachedStickerCount = lastSync?.sticker_count || 0;
		const hasCountMismatch = guildStickerCount > 5 && cachedStickerCount < 5;

		const needsFetch = forceFetch ||
			!lastSync ||
			lastSync.sticker_count === 0 ||
			!lastSync.last_updated ||
			hasCountMismatch ||
			(now.getTime() - new Date(lastSync.last_updated).getTime()) > CACHE_DURATION_MS;

		if (!needsFetch) {
			log.info(
				`Sticker cache is fresh for guild ${guild.name} (${guild.id}). Last synced: ${lastSync.last_updated}, Count: ${lastSync.sticker_count}`,
			);
			return false;
		}

		// 3. Fetch stickers from Discord API
		const refreshReason = forceFetch
			? "forced"
			: hasCountMismatch
				? `count mismatch (guild: ${guildStickerCount}, DB: ${cachedStickerCount})`
				: lastSync?.sticker_count === 0
					? "no stickers in DB"
					: "cache stale";

		log.info(
			`Lazy fetching stickers for guild ${guild.name} (${guild.id})... Reason: ${refreshReason}`,
		);
		log.info(`[Sticker Lazy Sync] Using server_id: ${serverId}`);

		await guild.stickers.fetch();
		const currentStickers = Array.from(guild.stickers.cache.values());

		log.info(
			`Fetched ${currentStickers.length} sticker(s) from Discord for guild ${guild.name}`,
		);

		// 4. Sync to database
		await sql.transaction(async (tx) => {
			// 4a. Load existing sticker metadata to preserve it across refresh
			const existingStickers = await tx<
				Array<{
					sticker_disc_id: string;
					sticker_desc: string | null;
					emotion_key: string | null;
				}>
			>`
				SELECT sticker_disc_id, sticker_desc, emotion_key
				FROM server_stickers
				WHERE server_id = ${serverId}
			`;
			const existingStickerMetadata = new Map(
				existingStickers.map((s) => [s.sticker_disc_id, s]),
			);

			// 4b. Map current stickers to database format for upsert
			const stickerValues = currentStickers.map((s) => {
				const existing = existingStickerMetadata.get(s.id);
				const emotionKey =
					existing?.emotion_key && existing.emotion_key.trim().length > 0
						? existing.emotion_key
						: "unset";
				return {
					server_id: serverId,
					sticker_disc_id: s.id,
					sticker_name: s.name,
					sticker_desc: existing?.sticker_desc ?? s.description ?? "",
					emotion_key: emotionKey,
					sticker_format: s.format,
				};
			});

			log.info(
				`[Sticker Lazy Sync] Prepared ${stickerValues.length} sticker values for upsert.`,
			);

			// 4c. Upsert all current stickers (individual inserts to avoid Postgres.js bulk syntax issues)
			if (stickerValues.length > 0) {
				log.info(`[Sticker Lazy Sync] Executing INSERT for ${stickerValues.length} stickers...`);

				let successCount = 0;
				for (const sticker of stickerValues) {
					await tx`
						INSERT INTO server_stickers (server_id, sticker_disc_id, sticker_name, sticker_desc, emotion_key, sticker_format)
						VALUES (
							${sticker.server_id},
							${sticker.sticker_disc_id},
							${sticker.sticker_name},
							${sticker.sticker_desc},
							${sticker.emotion_key},
							${sticker.sticker_format}
						)
						ON CONFLICT (server_id, sticker_disc_id) DO UPDATE SET
							sticker_name = EXCLUDED.sticker_name,
							sticker_desc = EXCLUDED.sticker_desc,
							emotion_key = EXCLUDED.emotion_key,
							sticker_format = EXCLUDED.sticker_format,
							updated_at = CURRENT_TIMESTAMP
					`;
					successCount++;
				}

				log.success(
					`Synced ${successCount} sticker(s) to database for guild ${guild.name} (server_id: ${serverId})`,
				);
			}

			// 4d. Delete stickers that no longer exist in Discord
			const currentStickerIds = currentStickers.map((s) => s.id);

			// Get all existing sticker IDs from DB
			const dbStickers = await tx<Array<{ sticker_disc_id: string; sticker_name: string }>>`
				SELECT sticker_disc_id, sticker_name
				FROM server_stickers
				WHERE server_id = ${serverId}
			`;

			// Find which ones to delete (exist in DB but not in Discord)
			const currentIdSet = new Set(currentStickerIds);
			const toDelete = dbStickers.filter(s => !currentIdSet.has(s.sticker_disc_id));

			if (toDelete.length > 0) {
				// Delete them one by one to avoid array syntax issues
				for (const sticker of toDelete) {
					await tx`
						DELETE FROM server_stickers
						WHERE server_id = ${serverId} AND sticker_disc_id = ${sticker.sticker_disc_id}
					`;
				}
				log.warn(
					`Removed ${toDelete.length} stale sticker(s) from database for guild ${guild.name}`,
				);
			}

			// Handle edge case: if Discord has no stickers, delete all
			if (currentStickerIds.length === 0) {
				const { rowCount: deletedCount } = await tx`
					DELETE FROM server_stickers
					WHERE server_id = ${serverId}
				`;
				if (deletedCount > 0) {
					log.info(
						`Removed all ${deletedCount} sticker(s) from database for guild ${guild.name} (no stickers in guild)`,
					);
				}
			}
		});

		// Verify sync by re-counting
		const [verifyCount] = await sql<Array<{ count: number }>>`
			SELECT COUNT(*) as count
			FROM server_stickers
			WHERE server_id = ${serverId}
		`;
		log.info(
			`[Sticker Lazy Sync] Verification: Database now has ${verifyCount.count} sticker(s) for server_id ${serverId}`,
		);

		return true;
	} catch (error) {
		log.error(
			`Failed to lazy sync stickers for guild ${guild.name} (${guild.id}):`,
			error,
			{
				serverId,
				errorType: "StickerLazySyncError",
				metadata: { guildId: guild.id },
			},
		);
		// Don't throw - allow the bot to continue with possibly stale data
		return false;
	}
}
