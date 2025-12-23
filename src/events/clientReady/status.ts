import { type ActivityOptions, ActivityType, type Client } from "discord.js";
import pkg from "../../../package.json";
import { log } from "../../utils/misc/logger";
import { getMCPManager } from "../../utils/mcp/mcpManager";
import { sql } from "@/utils/db/client";

// Cycle delay in milliseconds (1 minute)
const CYCLE_DELAY = 60000;

// Tomori's birthday (May 11)
const BIRTHDAY_MONTH = 4; // 0-indexed (April = 3, May = 4)
const BIRTHDAY_DAY = 11;

/**
 * Checks if today is Tomori's birthday (May 11).
 * @returns {boolean} True if today is May 11, false otherwise.
 */
function isTomoriBirthday(): boolean {
	const now = new Date();
	return now.getMonth() === BIRTHDAY_MONTH && now.getDate() === BIRTHDAY_DAY;
}

/**
 * Gets the server count from the database (including all servers and DM channels).
 * Falls back to Discord cache count on error.
 * @param client - The Discord client instance for fallback count.
 * @returns {Promise<number>} The number of servers.
 */
async function getServerCount(client: Client): Promise<number> {
	try {
		// Query database for total server count (includes DMs)
		const result = await sql<[{ count: string }]>`
			SELECT COUNT(*) as count
			FROM servers
		`;

		// sql returns count as string, parse to number
		const count = Number.parseInt(result[0]?.count || "0", 10);
		return count;
	} catch (error) {
		// Fall back to Discord cache if database query fails
		log.warn("Failed to get server count from database, using cache", {
			errorType: "DatabaseQueryError",
			metadata: { error },
		});
		return client.guilds.cache.size;
	}
}

/**
 * Sets the bot's status and logs startup information.
 * Waits for MCP initialization to complete before finalizing startup.
 * @param client - The Discord client instance.
 * @returns Promise<void>
 */
const handler = async (client: Client): Promise<void> => {
	log.section(`Launching ${client.user?.tag} on Discord...`);

	// Wait for MCP initialization to complete before finalizing startup
	const mcpManager = getMCPManager();

	// Wait for MCP manager to be ready (with a reasonable timeout)
	const mcpTimeout = 10000; // 10 seconds timeout
	const startTime = Date.now();

	while (!mcpManager.isReady() && Date.now() - startTime < mcpTimeout) {
		await new Promise((resolve) => setTimeout(resolve, 100)); // Wait 100ms between checks
	}

	if (mcpManager.isReady()) {
		const connectedCount = mcpManager.getConnectedServerCount();
		log.info(`MCP systems ready with ${connectedCount} server(s) connected`);
	} else {
		log.warn("MCP initialization timeout - proceeding with startup anyway");
	}

	log.success(`${client.user?.tag} up and running!`);

	log.section("Listening for error and info logs...");
	log.info(`Time started: [${new Date().toLocaleTimeString()}]`);

	const birthdayStatus: ActivityOptions = {
		name: "Celebrating my birthday!",
		type: ActivityType.Streaming,
		url: "https://www.youtube.com/shorts/eS9g6cnF7Z8", // Required for Streaming type
	};

	/**
	 * Updates the bot's status based on whether it's Tomori's birthday.
	 * If it's May 11, shows birthday status; otherwise rotates through normal statuses.
	 * Fetches server count from database for accurate status display.
	 * Skips setting status if not in production environment.
	 */
	async function updateStatus(): Promise<void> {
		if (!client.user) return;

		// 1. Skip status updates in non-production environments
		const isProduction = process.env.NODE_ENV === "production";
		if (!isProduction) {
			return;
		}

		// 2. Check if today is Tomori's birthday
		if (isTomoriBirthday()) {
			// 3. Set birthday status
			client.user.setActivity(birthdayStatus);
		} else {
			// 4. Get current server count from database
			const serverCount = await getServerCount(client);

			// 5. Build normal status options with current server count
			const normalStatus: ActivityOptions[] = [
				{
					name: `Image Generation Update! (v${pkg.version})`,
					type: ActivityType.Playing,
				},
				{
					name: `Listening for /help in ${serverCount} servers`,
					type: ActivityType.Listening,
				},
			];

			// 6. Normal status rotation
			if (normalStatus.length > 0) {
				const random = Math.floor(Math.random() * normalStatus.length);
				client.user.setActivity(normalStatus[random]);
			}
		}
	}

	// Set initial status on startup
	await updateStatus();

	// Update status every cycle (5 minutes)
	setInterval(() => {
		void updateStatus(); // Use void to indicate intentional fire-and-forget
	}, CYCLE_DELAY);
};

export default handler;
