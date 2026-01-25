import { sql } from "@/utils/db/client";
import type {
	ChannelWhitelistRow,
	CooldownType,
} from "@/types/db/schema";
import type { WhitelistCheckResult } from "@/types/misc/channelWhitelist";
import { log } from "@/utils/misc/logger";

/**
 * Check if a channel is whitelisted and get its cooldown settings
 * @param serverDiscId - Discord server ID (snowflake) or user ID for DMs
 * @param channelDiscId - Discord channel ID (snowflake)
 * @returns WhitelistCheckResult with whitelist status and settings
 */
export async function checkChannelWhitelist(
	serverDiscId: string,
	channelDiscId: string,
): Promise<WhitelistCheckResult> {
	try {
		// 1. Get server database ID
		const [serverRow] = await sql`
			SELECT server_id FROM servers WHERE server_disc_id = ${serverDiscId}
		`;

		if (!serverRow) {
			// Server not in database - no whitelist
			return {
				hasActiveWhitelist: false,
				isChannelWhitelisted: false,
			};
		}

		const serverId = serverRow.server_id as number;

		// 2. Check if server has ANY whitelist entries
		const [countRow] = await sql`
			SELECT COUNT(*) as count FROM channel_whitelist WHERE server_id = ${serverId}
		`;

		const whitelistCount = Number.parseInt(
			countRow?.count as string,
			10,
		);
		const hasActiveWhitelist = whitelistCount > 0;

		if (!hasActiveWhitelist) {
			// No whitelist entries - all channels allowed with global settings
			return {
				hasActiveWhitelist: false,
				isChannelWhitelisted: false,
			};
		}

		// 3. Check if specific channel is whitelisted
		const [channelRow] = await sql`
			SELECT cooldown_type, cooldown_length
			FROM channel_whitelist
			WHERE server_id = ${serverId} AND channel_disc_id = ${channelDiscId}
		`;

		if (!channelRow) {
			// Whitelist exists but this channel is NOT in it - block
			return {
				hasActiveWhitelist: true,
				isChannelWhitelisted: false,
			};
		}

		// 4. Channel is whitelisted - return its settings
		return {
			hasActiveWhitelist: true,
			isChannelWhitelisted: true,
			channelCooldownType: channelRow.cooldown_type as CooldownType,
			channelCooldownLength: channelRow.cooldown_length as number,
		};
	} catch (error) {
		log.warn("Failed to check channel whitelist, failing open", {
			errorType: "ChannelWhitelistCheckError",
			metadata: { serverDiscId, channelDiscId, error },
		});

		// Fail open - no whitelist enforcement on error
		return {
			hasActiveWhitelist: false,
			isChannelWhitelisted: false,
		};
	}
}

/**
 * Add or update a channel in the whitelist with custom cooldown settings
 * @param serverId - Database server ID
 * @param channelDiscId - Discord channel ID (snowflake)
 * @param cooldownType - Cooldown type for this channel
 * @param cooldownLength - Cooldown length in seconds (0-86400)
 * @returns The upserted channel whitelist row
 */
export async function upsertChannelWhitelist(
	serverId: number,
	channelDiscId: string,
	cooldownType: CooldownType,
	cooldownLength: number,
): Promise<ChannelWhitelistRow> {
	const [result] = await sql`
		INSERT INTO channel_whitelist (server_id, channel_disc_id, cooldown_type, cooldown_length)
		VALUES (${serverId}, ${channelDiscId}, ${cooldownType}, ${cooldownLength})
		ON CONFLICT (server_id, channel_disc_id)
		DO UPDATE SET
			cooldown_type = EXCLUDED.cooldown_type,
			cooldown_length = EXCLUDED.cooldown_length,
			updated_at = CURRENT_TIMESTAMP
		RETURNING *
	`;

	if (!result) {
		throw new Error("Failed to upsert channel whitelist");
	}

	return result as ChannelWhitelistRow;
}

/**
 * Remove a channel from the whitelist
 * @param serverId - Database server ID
 * @param channelDiscId - Discord channel ID (snowflake)
 * @returns True if a row was deleted, false if not found
 */
export async function removeChannelWhitelist(
	serverId: number,
	channelDiscId: string,
): Promise<boolean> {
	const result = await sql`
		DELETE FROM channel_whitelist
		WHERE server_id = ${serverId} AND channel_disc_id = ${channelDiscId}
	`;

	return result.count > 0;
}

/**
 * Get all whitelisted channels for a server
 * @param serverId - Database server ID
 * @returns Array of channel whitelist rows
 */
export async function getAllWhitelistChannels(
	serverId: number,
): Promise<ChannelWhitelistRow[]> {
	const result = await sql`
		SELECT * FROM channel_whitelist
		WHERE server_id = ${serverId}
		ORDER BY created_at ASC
	`;

	return result as ChannelWhitelistRow[];
}
