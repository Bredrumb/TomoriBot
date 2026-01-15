import { PermissionFlagsBits, type Message, type GuildMember } from "discord.js";
import { sql } from "@/utils/db/client";
import { CooldownType, type TomoriConfigRow } from "@/types/db/schema";
import { log } from "@/utils/misc/logger";

/**
 * Cooldown category prefixes for message triggers.
 * Uses existing cooldowns table with creative key strategy:
 * - Per-User: user_disc_id = actual user, category = __msg_trigger__{server_id}
 * - Per-Channel: user_disc_id = channel_id, category = __msg_trigger_channel__
 * - Server-Wide: user_disc_id = server_id, category = __msg_trigger_server__
 */
const MSG_TRIGGER_USER_PREFIX = "__msg_trigger__";
const MSG_TRIGGER_CHANNEL_CATEGORY = "__msg_trigger_channel__";
const MSG_TRIGGER_SERVER_CATEGORY = "__msg_trigger_server__";

/**
 * Result of a cooldown check operation
 */
export interface CooldownCheckResult {
	isOnCooldown: boolean;
	remainingSeconds: number;
	cooldownType: CooldownType;
}

/**
 * Generates the appropriate cooldown key pair based on cooldown type.
 * @param cooldownType - The type of cooldown configured
 * @param userDiscId - Discord user ID
 * @param channelDiscId - Discord channel ID
 * @param serverDiscId - Discord server/guild ID
 * @returns Object with entityId (maps to user_disc_id) and category (maps to command_category)
 */
function getCooldownKeyPair(
	cooldownType: CooldownType,
	userDiscId: string,
	channelDiscId: string,
	serverDiscId: string,
): { entityId: string; category: string } {
	switch (cooldownType) {
		case CooldownType.PER_USER:
			// Per-user: track by user, scoped to server
			return {
				entityId: userDiscId,
				category: `${MSG_TRIGGER_USER_PREFIX}${serverDiscId}`,
			};
		case CooldownType.PER_CHANNEL:
			// Per-channel: track by channel
			return {
				entityId: channelDiscId,
				category: MSG_TRIGGER_CHANNEL_CATEGORY,
			};
		case CooldownType.SERVER_WIDE:
		case CooldownType.STRICT_SERVER_WIDE:
			// Server-wide: track by server
			return {
				entityId: serverDiscId,
				category: MSG_TRIGGER_SERVER_CATEGORY,
			};
		default:
			// OFF or unknown - should never reach here if properly guarded
			return {
				entityId: userDiscId,
				category: `${MSG_TRIGGER_USER_PREFIX}${serverDiscId}`,
			};
	}
}

/**
 * Checks if a user is exempt from server-wide cooldowns (type 3).
 * Server managers (users with ManageGuild permission) are exempt from non-strict server-wide cooldowns.
 * @param member - Guild member to check
 * @param cooldownType - The cooldown type configured
 * @returns True if the user is exempt from the cooldown
 */
export function isExemptFromCooldown(
	member: GuildMember | null,
	cooldownType: CooldownType,
): boolean {
	// Only type 3 (SERVER_WIDE) has exemptions; type 4 (STRICT) has no exemptions
	if (cooldownType !== CooldownType.SERVER_WIDE) {
		return false;
	}

	// Check if user has ManageGuild permission
	if (member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
		return true;
	}

	return false;
}

/**
 * Checks if a message trigger is on cooldown.
 * @param message - The Discord message that triggered the bot
 * @param config - The Tomori config containing cooldown settings
 * @returns CooldownCheckResult with cooldown status and remaining time
 */
export async function checkMessageTriggerCooldown(
	message: Message,
	config: TomoriConfigRow,
): Promise<CooldownCheckResult> {
	const cooldownType = config.cooldown_type ?? CooldownType.OFF;

	// If cooldowns are off, not on cooldown
	if (cooldownType === CooldownType.OFF) {
		return {
			isOnCooldown: false,
			remainingSeconds: 0,
			cooldownType,
		};
	}

	// Check if user is exempt from this cooldown type
	const member = message.member;
	if (isExemptFromCooldown(member, cooldownType)) {
		return {
			isOnCooldown: false,
			remainingSeconds: 0,
			cooldownType,
		};
	}

	// Get the appropriate keys for this cooldown type
	const serverDiscId = message.guildId ?? message.author.id;
	const { entityId, category } = getCooldownKeyPair(
		cooldownType,
		message.author.id,
		message.channelId,
		serverDiscId,
	);

	try {
		// Check if cooldown exists and is still active
		const now = Date.now();
		const [cooldown] = await sql`
			SELECT expiry_time
			FROM cooldowns
			WHERE user_disc_id = ${entityId}
			AND command_category = ${category}
			AND expiry_time > ${now}
		`;

		if (!cooldown) {
			return {
				isOnCooldown: false,
				remainingSeconds: 0,
				cooldownType,
			};
		}

		const remainingMs = Number(cooldown.expiry_time) - now;
		const remainingSeconds = Math.ceil(remainingMs / 1000);

		return {
			isOnCooldown: true,
			remainingSeconds,
			cooldownType,
		};
	} catch (error) {
		// Log error but fail-open to prevent blocking legitimate users
		log.warn("Failed to check message trigger cooldown", {
			entityId,
			category,
			cooldownType,
			error: error instanceof Error ? error.message : "Unknown error",
		});
		return {
			isOnCooldown: false,
			remainingSeconds: 0,
			cooldownType,
		};
	}
}

/**
 * Sets the cooldown after a successful message trigger response.
 * @param message - The Discord message that triggered the bot
 * @param config - The Tomori config containing cooldown settings
 */
export async function setMessageTriggerCooldown(
	message: Message,
	config: TomoriConfigRow,
): Promise<void> {
	const cooldownType = config.cooldown_type ?? CooldownType.OFF;

	// If cooldowns are off, nothing to set
	if (cooldownType === CooldownType.OFF) {
		return;
	}

	// Get cooldown duration in milliseconds
	const cooldownLengthSeconds = config.cooldown_length ?? 5;
	const cooldownDurationMs = cooldownLengthSeconds * 1000;

	// Get the appropriate keys for this cooldown type
	const serverDiscId = message.guildId ?? message.author.id;
	const { entityId, category } = getCooldownKeyPair(
		cooldownType,
		message.author.id,
		message.channelId,
		serverDiscId,
	);

	const expiryTime = Date.now() + cooldownDurationMs;

	try {
		await sql`
			INSERT INTO cooldowns (user_disc_id, command_category, expiry_time)
			VALUES (${entityId}, ${category}, ${expiryTime})
			ON CONFLICT (user_disc_id, command_category) DO UPDATE
			SET expiry_time = ${expiryTime}
		`;
	} catch (error) {
		// Log but don't throw - cooldown failures shouldn't break message handling
		log.warn("Failed to set message trigger cooldown", {
			entityId,
			category,
			cooldownType,
			error: error instanceof Error ? error.message : "Unknown error",
		});
	}
}

/**
 * Gets the locale key for the cooldown type footer text.
 * @param cooldownType - The cooldown type
 * @returns The locale key for the footer text
 */
export function getCooldownTypeFooterKey(cooldownType: CooldownType): string {
	switch (cooldownType) {
		case CooldownType.PER_USER:
			return "general.message_cooldown_footer_per_user";
		case CooldownType.PER_CHANNEL:
			return "general.message_cooldown_footer_per_channel";
		case CooldownType.SERVER_WIDE:
			return "general.message_cooldown_footer_server_wide";
		case CooldownType.STRICT_SERVER_WIDE:
			return "general.message_cooldown_footer_strict";
		default:
			return "general.message_cooldown_footer_per_user";
	}
}
