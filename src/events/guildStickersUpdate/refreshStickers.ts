import { type Client, type Guild, Sticker } from "discord.js";
import { sql } from "@/utils/db/client";
import type { EventFunction, EventArg } from "../../types/discord/global"; // Rule 14
import type { ErrorContext } from "../../types/db/schema"; // Rule 14, Import ServerRow
import { log } from "../../utils/misc/logger"; // Rule 18
import { syncStickersToDatabase } from "../../utils/db/emojiStickerSync";
import { invalidateEmojiStickerCache } from "../../utils/cache/emojiStickerCache";
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

		// 4. Sync stickers to database using shared helper
		await sql.transaction(async (tx) => {
			// biome-ignore lint/style/noNonNullAssertion: serverId is guaranteed to exist after checks above
			await syncStickersToDatabase(tx, serverId!, currentStickers);
		});

		// 5. Invalidate in-memory cache to force refresh on next message
		// biome-ignore lint/style/noNonNullAssertion: serverId is guaranteed to exist after checks above
		invalidateEmojiStickerCache(serverId!);

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
