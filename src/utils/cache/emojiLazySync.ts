import type { Guild } from "discord.js";
import { sql } from "../db/client";
import { log } from "../misc/logger";

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

		// 4. Sync to database
		await sql.transaction(async (tx) => {
			// 4a. Load existing emoji metadata to preserve it across refresh
			const existingEmojis = await tx<
				Array<{
					emoji_disc_id: string;
					emoji_desc: string | null;
					emotion_key: string | null;
				}>
			>`
				SELECT emoji_disc_id, emoji_desc, emotion_key
				FROM server_emojis
				WHERE server_id = ${serverId}
			`;
			const existingEmojiMetadata = new Map(
				existingEmojis.map((e) => [e.emoji_disc_id, e]),
			);

			// 4b. Map current emojis to database format for bulk upsert
			const emojiValues = currentEmojis.map((e) => {
				const existing = existingEmojiMetadata.get(e.id);
				const emotionKey =
					existing?.emotion_key && existing.emotion_key.trim().length > 0
						? existing.emotion_key
						: "unset";
				return {
					server_id: serverId,
					emoji_disc_id: e.id,
					emoji_name: e.name ?? "",
					emoji_desc: existing?.emoji_desc ?? "",
					emotion_key: emotionKey,
					is_animated: e.animated ?? false,
				};
			});

			log.info(
				`[Emoji Lazy Sync] Prepared ${emojiValues.length} emoji values for upsert. First 2: ${JSON.stringify(emojiValues.slice(0, 2), null, 2)}`,
			);
			log.info(
				`[Emoji Lazy Sync] Last 2 emoji values: ${JSON.stringify(emojiValues.slice(-2), null, 2)}`,
			);

			// 4c. Bulk upsert all current emojis
			if (emojiValues.length > 0) {
				log.info(`[Emoji Lazy Sync] Executing bulk INSERT for ${emojiValues.length} emojis...`);

				// Check count BEFORE inserts
				const [beforeCount] = await tx<Array<{ count: number }>>`
					SELECT COUNT(*) as count FROM server_emojis WHERE server_id = ${serverId}
				`;
				log.info(`[Emoji Lazy Sync] BEFORE inserts: ${beforeCount.count} emoji(s) exist`);

				// Use individual inserts in a loop for now to ensure reliability
				// TODO: Optimize with proper bulk insert once we understand Postgres.js syntax
				let successCount = 0;
				for (const emoji of emojiValues) {
					const result = await tx`
						INSERT INTO server_emojis (server_id, emoji_disc_id, emoji_name, emoji_desc, emotion_key, is_animated)
						VALUES (
							${emoji.server_id},
							${emoji.emoji_disc_id},
							${emoji.emoji_name},
							${emoji.emoji_desc},
							${emoji.emotion_key},
							${emoji.is_animated}
						)
						ON CONFLICT (server_id, emoji_disc_id) DO UPDATE SET
							emoji_name = EXCLUDED.emoji_name,
							emoji_desc = EXCLUDED.emoji_desc,
							emotion_key = EXCLUDED.emotion_key,
							is_animated = EXCLUDED.is_animated,
							updated_at = CURRENT_TIMESTAMP
						RETURNING server_emoji_id, emoji_name
					`;
					successCount++;

					// Log every 10th insert to track progress
					if (successCount % 10 === 0 || successCount <= 3) {
						const [midCount] = await tx<Array<{ count: number }>>`
							SELECT COUNT(*) as count FROM server_emojis WHERE server_id = ${serverId}
						`;
						log.info(`[Emoji Lazy Sync] After insert #${successCount} (${emoji.emoji_name}): DB has ${midCount.count} rows, INSERT returned ${result.length} row(s)`);
					}
				}

				log.info(`[Emoji Lazy Sync] Individual INSERTs completed: ${successCount}/${emojiValues.length} emojis`);

				// Create upsertedRows array for compatibility with existing log
				const upsertedRows = emojiValues;
				log.success(
					`Synced ${upsertedRows.length} emoji(s) to database for guild ${guild.name} (server_id: ${serverId})`,
				);
				log.info(
					`[Emoji Lazy Sync] Sample synced emojis: ${upsertedRows.slice(0, 5).map(r => r.emoji_name).join(', ')}`,
				);
			}

			// 4d. Delete emojis that no longer exist in Discord
			const currentEmojiIds = currentEmojis.map((e) => e.id);
			log.info(
				`[Emoji Lazy Sync] Cleaning up: Will keep ${currentEmojiIds.length} emoji IDs from Discord. Sample: ${currentEmojiIds.slice(0, 3).join(', ')}`,
			);

			// First get all existing emoji IDs to see what needs deletion
			const dbEmojis = await tx<Array<{ emoji_disc_id: string; emoji_name: string }>>`
				SELECT emoji_disc_id, emoji_name
				FROM server_emojis
				WHERE server_id = ${serverId}
			`;

			// Find which ones to delete (exist in DB but not in Discord)
			const currentIdSet = new Set(currentEmojiIds);
			const toDelete = dbEmojis.filter(e => !currentIdSet.has(e.emoji_disc_id));

			if (toDelete.length > 0) {
				log.info(`[Emoji Lazy Sync] Found ${toDelete.length} stale emoji(s) to delete: ${toDelete.slice(0, 3).map(e => e.emoji_name).join(', ')}`);

				// Delete them one by one to avoid array syntax issues
				for (const emoji of toDelete) {
					await tx`
						DELETE FROM server_emojis
						WHERE server_id = ${serverId} AND emoji_disc_id = ${emoji.emoji_disc_id}
					`;
				}

				log.warn(
					`Removed ${toDelete.length} stale emoji(s) from database for guild ${guild.name}`,
				);
			} else {
				log.info(`[Emoji Lazy Sync] No stale emojis to delete`);
			}

			// Handle edge case: if Discord has no emojis, delete all
			if (currentEmojiIds.length === 0) {
				// If there are no current emojis, delete all
				const { rowCount: deletedCount } = await tx`
					DELETE FROM server_emojis
					WHERE server_id = ${serverId}
				`;
				if (deletedCount > 0) {
					log.info(
						`Removed all ${deletedCount} emoji(s) from database for guild ${guild.name} (no emojis in guild)`,
					);
				}
			}

			// 4e. Verify data exists INSIDE transaction before commit
			const [txVerifyCount] = await tx<Array<{ count: number }>>`
				SELECT COUNT(*) as count
				FROM server_emojis
				WHERE server_id = ${serverId}
			`;
			log.info(
				`[Emoji Lazy Sync] PRE-COMMIT verification: Transaction sees ${txVerifyCount.count} emoji(s) for server_id ${serverId}`,
			);

			if (txVerifyCount.count !== currentEmojis.length) {
				log.error(
					`[Emoji Lazy Sync] CRITICAL: Pre-commit count mismatch! Expected ${currentEmojis.length}, got ${txVerifyCount.count}`,
				);
				throw new Error(
					`Emoji sync transaction integrity violation: expected ${currentEmojis.length} emojis, but transaction has ${txVerifyCount.count}`,
				);
			}
		});

		log.info("[Emoji Lazy Sync] Transaction completed successfully (should have committed)");

		// Verify sync by re-counting
		const [verifyCount] = await sql<Array<{ count: number }>>`
			SELECT COUNT(*) as count
			FROM server_emojis
			WHERE server_id = ${serverId}
		`;
		log.info(
			`[Emoji Lazy Sync] POST-COMMIT verification: Database now has ${verifyCount.count} emoji(s) for server_id ${serverId}`,
		);

		if (verifyCount.count !== currentEmojis.length) {
			log.error(
				`[Emoji Lazy Sync] CRITICAL: Post-commit count mismatch! Transaction committed but data is missing. Expected ${currentEmojis.length}, got ${verifyCount.count}`,
			);
		}

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

