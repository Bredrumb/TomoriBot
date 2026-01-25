import type { CooldownType } from "@/types/db/schema";

/**
 * Result of checking channel whitelist status
 * Used to determine if a channel should be allowed to trigger the bot
 * and what cooldown settings to apply
 */
export interface WhitelistCheckResult {
	/**
	 * Whether this server has ANY active whitelist entries
	 * If true, ONLY whitelisted channels can trigger the bot
	 */
	hasActiveWhitelist: boolean;

	/**
	 * Whether the specific channel is in the whitelist
	 * Only relevant if hasActiveWhitelist is true
	 */
	isChannelWhitelisted: boolean;

	/**
	 * Channel-specific cooldown type (if whitelisted)
	 * Overrides global cooldown settings
	 */
	channelCooldownType?: CooldownType;

	/**
	 * Channel-specific cooldown length in seconds (if whitelisted)
	 * 0 = instant (no cooldown), 1-86400 = cooldown duration
	 * Overrides global cooldown settings
	 */
	channelCooldownLength?: number;
}
