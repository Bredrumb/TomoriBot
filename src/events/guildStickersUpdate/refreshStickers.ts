import { type Client, type Guild, Sticker } from "discord.js";
import { sql } from "@/utils/db/client";
import type { EventFunction, EventArg } from "../../types/discord/global"; // Rule 14
import type { ErrorContext } from "../../types/db/schema"; // Rule 14, Import ServerRow
import { log } from "../../utils/misc/logger"; // Rule 18
// Removed loadServerState import

/**
 * Rule 1: JSDoc comment for exported function
 * Handles sticker create, delete, and update events by refreshing the guild's sticker list in the database.
 * @param _client - Discord client instance (unused)
 * @param args - Event arguments (expected: Sticker or [Sticker, Sticker])
 */
const handleGuildStickersUpdate: EventFunction = async (
	_client: Client,
	...args: EventArg[]
): Promise<void> => {
	// 1. Identify the Sticker and Guild from the event arguments
	const sticker = args[0];
	if (!(sticker instanceof Sticker) || !sticker.guild) {
		log.warn(
			"guildStickersUpdate event triggered without a valid Sticker or Guild.",
			{ args },
		);
		return; // Cannot proceed without guild info
	}
	const guild: Guild = sticker.guild;
	log.info(`Sticker change detected in guild: ${guild.name} (${guild.id})`);

	let serverId: number | undefined; // Variable to hold the internal server ID

	try {
		// 2. Check if server is registered and get internal server_id (Rule 4, 16)
		const [serverRow] = await sql`
            SELECT server_id
            FROM servers
            WHERE server_disc_id = ${guild.id}
            LIMIT 1
        `;

		if (!serverRow || !serverRow.server_id) {
			log.warn(
				`Received sticker update for guild ${guild.id} but server is not registered in DB. Skipping refresh.`,
			);
			return; // Server not setup, nothing to refresh
		}
		// biome-ignore lint/style/noNonNullAssertion: Row existence guarantees server_id is present (Rule 8)
		serverId = serverRow.server_id!; // Assign the found server ID

		// 3. Fetch the current complete list of stickers from Discord API
		// CRITICAL: Must fetch() to ensure cache is complete - cache may be incomplete on startup
		await guild.stickers.fetch();
		const currentStickers = Array.from(guild.stickers.cache.values());
		log.info(
			`Fetched and cached ${currentStickers.length} stickers for guild ${guild.id}. Refreshing DB...`,
		);

		// 4. Perform database update within a transaction (Rule 15)
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

			// 4b. Map current stickers to database format for bulk upsert
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

			// 4c. Upsert all current stickers (individual inserts to avoid Postgres.js bulk syntax issues)
			if (stickerValues.length > 0) {
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
				log.info(
					`Upserted ${successCount} sticker entries for server ${serverId}.`,
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
				log.info(
					`Removed ${toDelete.length} stale sticker entries for server ${serverId}.`,
				);
			}

			// Handle edge case: if Discord has no stickers, delete all
			if (currentStickerIds.length === 0) {
				// If there are no current stickers, delete all
				const { rowCount: deletedCount } = await tx`
					DELETE FROM server_stickers
					WHERE server_id = ${serverId}
				`;
				log.info(
					`Removed all ${deletedCount} sticker entries for server ${serverId} (no stickers in guild).`,
				);
			}
		});

		log.success(
			`Successfully refreshed stickers for guild ${guild.id} (Server ID: ${serverId}).`,
		);
	} catch (error) {
		// Rule 22: Log error with context
		// serverId might be undefined if the initial SELECT failed
		const context: ErrorContext = {
			serverId: serverId, // Use the serverId if found, otherwise undefined
			errorType: "StickerRefreshError",
			metadata: { guildId: guild.id, eventArgsCount: args.length },
		};
		await log.error(
			`Failed to refresh stickers for guild ${guild.id}`,
			error,
			context,
		);
	}
};

export default handleGuildStickersUpdate;
