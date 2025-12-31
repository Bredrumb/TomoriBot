import { type Client, type Guild, GuildEmoji } from "discord.js"; // Import GuildEmoji
import { sql } from "@/utils/db/client";
import type { EventFunction, EventArg } from "../../types/discord/global"; // Rule 14
import type { ErrorContext } from "../../types/db/schema"; // Rule 14
import { log } from "../../utils/misc/logger"; // Rule 18

/**
 * Rule 1: JSDoc comment for exported function
 * Handles emoji create, delete, and update events by refreshing the guild's emoji list in the database.
 * @param _client - Discord client instance (unused)
 * @param args - Event arguments (expected: GuildEmoji or [GuildEmoji, GuildEmoji])
 */
const handleGuildEmojisUpdate: EventFunction = async (
	_client: Client,
	...args: EventArg[]
): Promise<void> => {
	// 1. Identify the GuildEmoji and Guild from the event arguments
	// The first argument should always be a GuildEmoji object for these events
	const emoji = args[0];
	if (!(emoji instanceof GuildEmoji) || !emoji.guild) {
		log.warn(
			"guildEmojisUpdate event triggered without a valid GuildEmoji or Guild.",
			{ args },
		);
		return; // Cannot proceed without guild info
	}
	const guild: Guild = emoji.guild;
	log.info(`Emoji change detected in guild: ${guild.name} (${guild.id})`);

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
				`Received emoji update for guild ${guild.id} but server is not registered in DB. Skipping refresh.`,
			);
			return; // Server not setup, nothing to refresh
		}
		// biome-ignore lint/style/noNonNullAssertion: Row existence guarantees server_id is present (Rule 8)
		serverId = serverRow.server_id!; // Assign the found server ID

		// 3. Fetch the current complete list of emojis from Discord API
		// CRITICAL: Must fetch() to ensure cache is complete - cache may be incomplete on startup
		await guild.emojis.fetch();
		const currentEmojis = Array.from(guild.emojis.cache.values());
		log.info(
			`Fetched and cached ${currentEmojis.length} emojis for guild ${guild.id}. Refreshing DB...`,
		);

		// 4. Perform database update within a transaction (Rule 15)
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
					emoji_name: e.name ?? "", // Use name, default to empty string if null
					emoji_desc: existing?.emoji_desc ?? "",
					emotion_key: emotionKey, // Preserve existing emotion key
					is_animated: e.animated ?? false, // Use animated property
				};
			});

			// 4c. Upsert all current emojis (individual inserts to avoid Postgres.js bulk syntax issues)
			if (emojiValues.length > 0) {
				let successCount = 0;
				for (const emoji of emojiValues) {
					await tx`
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
					`;
					successCount++;
				}
				log.info(
					`Upserted ${successCount} emoji entries for server ${serverId}.`,
				);
			}

			// 4d. Delete emojis that no longer exist in Discord
			const currentEmojiIds = currentEmojis.map((e) => e.id);

			// Get all existing emoji IDs from DB
			const dbEmojis = await tx<Array<{ emoji_disc_id: string; emoji_name: string }>>`
				SELECT emoji_disc_id, emoji_name
				FROM server_emojis
				WHERE server_id = ${serverId}
			`;

			// Find which ones to delete (exist in DB but not in Discord)
			const currentIdSet = new Set(currentEmojiIds);
			const toDelete = dbEmojis.filter(e => !currentIdSet.has(e.emoji_disc_id));

			if (toDelete.length > 0) {
				// Delete them one by one to avoid array syntax issues
				for (const emoji of toDelete) {
					await tx`
						DELETE FROM server_emojis
						WHERE server_id = ${serverId} AND emoji_disc_id = ${emoji.emoji_disc_id}
					`;
				}
				log.info(
					`Removed ${toDelete.length} stale emoji entries for server ${serverId}.`,
				);
			}

			// Handle edge case: if Discord has no emojis, delete all
			if (currentEmojiIds.length === 0) {
				// If there are no current emojis, delete all
				const { rowCount: deletedCount } = await tx`
					DELETE FROM server_emojis
					WHERE server_id = ${serverId}
				`;
				log.info(
					`Removed all ${deletedCount} emoji entries for server ${serverId} (no emojis in guild).`,
				);
			}
		});

		log.success(
			`Successfully refreshed emojis for guild ${guild.id} (Server ID: ${serverId}).`,
		);
	} catch (error) {
		// Rule 22: Log error with context
		const context: ErrorContext = {
			serverId: serverId, // Use the serverId if found, otherwise undefined
			errorType: "EmojiRefreshError", // Specific error type
			metadata: { guildId: guild.id, eventArgsCount: args.length },
		};
		await log.error(
			`Failed to refresh emojis for guild ${guild.id}`,
			error,
			context,
		);
	}
};

export default handleGuildEmojisUpdate;
