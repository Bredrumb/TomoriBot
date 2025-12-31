import type { GuildEmoji, Sticker } from "discord.js";
import { log } from "../misc/logger";

// Type for transaction callback parameter from sql.transaction()
// Using any since the transaction type is complex and internal to Bun's SQL library
// biome-ignore lint/suspicious/noExplicitAny: transaction type is complex and internal
type TransactionSql = any;

/**
 * Metadata from existing database entries
 * Used to preserve user-generated descriptions and emotion keys during sync
 */
interface ExistingMetadata {
	emoji_desc?: string | null;
	sticker_desc?: string | null;
	emotion_key?: string | null;
}

/**
 * Configuration for generic sync function
 * Defines table structure and mapping logic for emojis or stickers
 */
interface SyncConfig<TDiscord, TDatabase> {
	tableName: string; // 'server_emojis' | 'server_stickers'
	idColumnName: string; // 'emoji_disc_id' | 'sticker_disc_id'
	nameColumnName: string; // 'emoji_name' | 'sticker_name'
	descColumnName: string; // 'emoji_desc' | 'sticker_desc'
	conflictColumns: string[]; // Columns for ON CONFLICT clause

	/**
	 * Map Discord object to database row format
	 * @param item - Discord emoji or sticker object
	 * @param existing - Existing metadata from database (if any)
	 * @param serverId - Internal database server ID
	 * @returns Database row object ready for insert
	 */
	mapToDatabase: (
		item: TDiscord,
		existing: ExistingMetadata | undefined,
		serverId: number,
	) => TDatabase;

	/**
	 * Extract Discord snowflake ID from item
	 * @param item - Discord emoji or sticker object
	 * @returns Discord snowflake ID string
	 */
	getDiscordId: (item: TDiscord) => string;
}

/**
 * Generic sync function for emojis and stickers
 * Handles metadata preservation, bulk upsert, stale item cleanup, and verification
 *
 * @param tx - PostgreSQL transaction object
 * @param serverId - Internal database server ID
 * @param currentItems - Array of current items from Discord API
 * @param config - Configuration object for table structure and mapping
 * @returns Number of items synced successfully
 */
async function syncItemsToDatabase<TDiscord, TDatabase extends Record<string, unknown>>(
	tx: TransactionSql,
	serverId: number,
	currentItems: TDiscord[],
	config: SyncConfig<TDiscord, TDatabase>,
): Promise<number> {
	// 1. Load existing metadata to preserve user-generated descriptions and emotion keys
	const existingItems = await tx.unsafe(`
		SELECT ${config.idColumnName}, ${config.descColumnName}, emotion_key
		FROM ${config.tableName}
		WHERE server_id = ${serverId}
	`);

	// 2. Build metadata map for quick lookup (Discord ID → metadata)
	const existingMetadata = new Map<string, ExistingMetadata>(
		existingItems.map((item: { [key: string]: string | null }) => [
			item[config.idColumnName] as string,
			item as ExistingMetadata,
		]),
	);

	// 3. Map Discord items to database format, preserving existing metadata
	const dbItems = currentItems.map((item) => {
		const discordId = config.getDiscordId(item);
		const existing = existingMetadata.get(discordId);
		return config.mapToDatabase(item, existing, serverId);
	});

	log.info(
		`[Sync] Prepared ${dbItems.length} ${config.tableName} for upsert`,
	);

	// 4. Bulk upsert all current items using Bun's native bulk insert
	if (dbItems.length > 0) {
		// 4a. Check count BEFORE bulk insert (for debugging)
		const [beforeCount] = await tx.unsafe(`
			SELECT COUNT(*) as count FROM ${config.tableName} WHERE server_id = ${serverId}
		`);
		log.info(
			`[Sync] BEFORE bulk insert: ${beforeCount.count} ${config.tableName} exist`,
		);

		// 4b. Perform bulk upsert using individual INSERT statements
		// Note: Tried UNNEST and sql(array) but both have issues with transaction context
		// Individual inserts are slower but more reliable for now
		for (const item of dbItems) {
			if (config.tableName === "server_emojis") {
				await tx`
					INSERT INTO server_emojis (
						server_id, emoji_disc_id, emoji_name,
						emoji_desc, emotion_key, is_animated
					)
					VALUES (
						${item.server_id}, ${item.emoji_disc_id}, ${item.emoji_name},
						${item.emoji_desc}, ${item.emotion_key}, ${item.is_animated}
					)
					ON CONFLICT (server_id, emoji_disc_id) DO UPDATE SET
						emoji_name = EXCLUDED.emoji_name,
						emoji_desc = EXCLUDED.emoji_desc,
						emotion_key = EXCLUDED.emotion_key,
						is_animated = EXCLUDED.is_animated,
						updated_at = CURRENT_TIMESTAMP
				`;
			} else {
				await tx`
					INSERT INTO server_stickers (
						server_id, sticker_disc_id, sticker_name,
						sticker_desc, emotion_key, sticker_format
					)
					VALUES (
						${item.server_id}, ${item.sticker_disc_id}, ${item.sticker_name},
						${item.sticker_desc}, ${item.emotion_key}, ${item.sticker_format}
					)
					ON CONFLICT (server_id, sticker_disc_id) DO UPDATE SET
						sticker_name = EXCLUDED.sticker_name,
						sticker_desc = EXCLUDED.sticker_desc,
						emotion_key = EXCLUDED.emotion_key,
						sticker_format = EXCLUDED.sticker_format,
						updated_at = CURRENT_TIMESTAMP
				`;
			}
		}

		// 4c. Check count AFTER bulk insert (for verification)
		const [afterCount] = await tx.unsafe(`
			SELECT COUNT(*) as count FROM ${config.tableName} WHERE server_id = ${serverId}
		`);
		log.success(
			`[Sync] AFTER bulk insert: ${afterCount.count} ${config.tableName} in database`,
		);
	}

	// 5. Delete items that no longer exist in Discord (stale cleanup)
	const currentDiscordIds = currentItems.map(config.getDiscordId);

	if (currentDiscordIds.length > 0) {
		// Get all existing IDs from database
		const dbItemsForCleanup = await tx.unsafe(`
			SELECT ${config.idColumnName}, ${config.nameColumnName}
			FROM ${config.tableName}
			WHERE server_id = ${serverId}
		`);

		// Find items to delete (exist in DB but not in Discord)
		const currentIdSet = new Set(currentDiscordIds);
		const toDelete = dbItemsForCleanup.filter(
			(item: { [key: string]: string }) => !currentIdSet.has(item[config.idColumnName]),
		);

		if (toDelete.length > 0) {
			log.info(
				`[Sync] Found ${toDelete.length} stale ${config.tableName} to delete`,
			);

			// Delete them one by one (avoiding array syntax issues)
			// Use separate queries for emojis vs stickers to avoid SQL injection
			if (config.tableName === "server_emojis") {
				for (const item of toDelete) {
					await tx`
						DELETE FROM server_emojis
						WHERE server_id = ${serverId}
						AND emoji_disc_id = ${item[config.idColumnName]}
					`;
				}
			} else {
				for (const item of toDelete) {
					await tx`
						DELETE FROM server_stickers
						WHERE server_id = ${serverId}
						AND sticker_disc_id = ${item[config.idColumnName]}
					`;
				}
			}

			log.warn(
				`[Sync] Removed ${toDelete.length} stale ${config.tableName}`,
			);
		}
	} else {
		// Edge case: Discord has no items, delete all from database
		let deletedCount = 0;
		if (config.tableName === "server_emojis") {
			const result = await tx`
				DELETE FROM server_emojis
				WHERE server_id = ${serverId}
			`;
			deletedCount = result.count || 0;
		} else {
			const result = await tx`
				DELETE FROM server_stickers
				WHERE server_id = ${serverId}
			`;
			deletedCount = result.count || 0;
		}

		if (deletedCount > 0) {
			log.info(
				`[Sync] Removed all ${deletedCount} ${config.tableName} (none in Discord)`,
			);
		}
	}

	// 6. Pre-commit verification (ensures data integrity before commit)
	const [verifyCount] = await tx.unsafe(`
		SELECT COUNT(*) as count
		FROM ${config.tableName}
		WHERE server_id = ${serverId}
	`);

	log.info(
		`[Sync] PRE-COMMIT verification: ${verifyCount.count} ${config.tableName} in transaction`,
	);

	// 7. Verify count matches expected (throw error to trigger rollback if mismatch)
	// Convert to number to ensure type safety in comparison
	const actualCount = Number(verifyCount.count);
	const expectedCount = currentItems.length;

	if (actualCount !== expectedCount) {
		log.error(
			`[Sync] CRITICAL: Pre-commit count mismatch! Expected ${expectedCount}, got ${actualCount}`,
		);
		throw new Error(
			`Sync transaction integrity violation: expected ${expectedCount} items, but transaction has ${actualCount}`,
		);
	}

	return currentItems.length;
}

/**
 * Syncs emojis from Discord to database
 * Preserves existing metadata (emoji_desc, emotion_key)
 *
 * @param tx - PostgreSQL transaction object
 * @param serverId - Internal database server ID
 * @param currentEmojis - Array of current emojis from Discord API
 * @returns Number of emojis synced successfully
 */
export async function syncEmojisToDatabase(
	tx: TransactionSql,
	serverId: number,
	currentEmojis: GuildEmoji[],
): Promise<number> {
	const config: SyncConfig<
		GuildEmoji,
		{
			server_id: number;
			emoji_disc_id: string;
			emoji_name: string;
			emoji_desc: string;
			emotion_key: string;
			is_animated: boolean;
		}
	> = {
		tableName: "server_emojis",
		idColumnName: "emoji_disc_id",
		nameColumnName: "emoji_name",
		descColumnName: "emoji_desc",
		conflictColumns: ["server_id", "emoji_disc_id"],

		mapToDatabase: (emoji, existing, sid) => {
			const emotionKey =
				existing?.emotion_key && existing.emotion_key.trim().length > 0
					? existing.emotion_key
					: "unset";

			return {
				server_id: sid,
				emoji_disc_id: emoji.id,
				emoji_name: emoji.name ?? "",
				emoji_desc: (existing?.emoji_desc as string) ?? "",
				emotion_key: emotionKey,
				is_animated: emoji.animated ?? false,
			};
		},

		getDiscordId: (emoji) => emoji.id,
	};

	return syncItemsToDatabase(tx, serverId, currentEmojis, config);
}

/**
 * Syncs stickers from Discord to database
 * Preserves existing metadata (sticker_desc, emotion_key)
 *
 * @param tx - PostgreSQL transaction object
 * @param serverId - Internal database server ID
 * @param currentStickers - Array of current stickers from Discord API
 * @returns Number of stickers synced successfully
 */
export async function syncStickersToDatabase(
	tx: TransactionSql,
	serverId: number,
	currentStickers: Sticker[],
): Promise<number> {
	const config: SyncConfig<
		Sticker,
		{
			server_id: number;
			sticker_disc_id: string;
			sticker_name: string;
			sticker_desc: string;
			emotion_key: string;
			sticker_format: number;
		}
	> = {
		tableName: "server_stickers",
		idColumnName: "sticker_disc_id",
		nameColumnName: "sticker_name",
		descColumnName: "sticker_desc",
		conflictColumns: ["server_id", "sticker_disc_id"],

		mapToDatabase: (sticker, existing, sid) => {
			const emotionKey =
				existing?.emotion_key && existing.emotion_key.trim().length > 0
					? existing.emotion_key
					: "unset";

			return {
				server_id: sid,
				sticker_disc_id: sticker.id,
				sticker_name: sticker.name,
				sticker_desc: (existing?.sticker_desc as string) ?? sticker.description ?? "",
				emotion_key: emotionKey,
				sticker_format: sticker.format,
			};
		},

		getDiscordId: (sticker) => sticker.id,
	};

	return syncItemsToDatabase(tx, serverId, currentStickers, config);
}
