import type { Client, RateLimitData } from "discord.js";
import { log } from "@/utils/misc/logger";

/**
 * Handles Discord API rate limit events for monitoring and logging.
 * Logs rate limit details to help identify when the bot approaches API limits.
 * @param _client - The Discord client instance (unused but required by event signature).
 * @param rateLimitData - Rate limit information from Discord API.
 */
export default async (
	_client: Client,
	rateLimitData: RateLimitData,
): Promise<void> => {
	// Log rate limit event with all relevant details
	log.rateLimit("Discord API rate limit hit", {
		timeToReset: `${rateLimitData.timeToReset}ms`,
		limit: rateLimitData.limit,
		method: rateLimitData.method,
		url: rateLimitData.url,
		route: rateLimitData.route,
		global: rateLimitData.global,
	});
};
