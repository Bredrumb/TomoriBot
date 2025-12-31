import { type Client, type Guild, GuildEmoji } from "discord.js"; // Import GuildEmoji
import { sql } from "@/utils/db/client";
import type { EventFunction, EventArg } from "../../types/discord/global"; // Rule 14
import type { ErrorContext } from "../../types/db/schema"; // Rule 14
import { log } from "../../utils/misc/logger"; // Rule 18
import { syncEmojisToDatabase } from "../../utils/db/emojiStickerSync";
import { invalidateEmojiStickerCache } from "../../utils/cache/emojiStickerCache";

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

		// 4. Sync emojis to database using shared helper
		await sql.transaction(async (tx) => {
			// biome-ignore lint/style/noNonNullAssertion: serverId is guaranteed to exist after checks above
			await syncEmojisToDatabase(tx, serverId!, currentEmojis);
		});

		// 5. Invalidate in-memory cache to force refresh on next message
		// biome-ignore lint/style/noNonNullAssertion: serverId is guaranteed to exist after checks above
		invalidateEmojiStickerCache(serverId!);

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
