import { type ActivityOptions, ActivityType, type Client } from "discord.js";
import pkg from "../../../package.json";
import { log } from "../../utils/misc/logger";
import { getMCPManager } from "../../utils/mcp/mcpManager";

// Cycle delay in milliseconds (300000ms = 5 minutes)
const CYCLE_DELAY = 300000;

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

	const normalStatus: ActivityOptions[] = [
		{
			name: `v${pkg.version}`,
			type: ActivityType.Playing,
		},
		{
			name: "/help",
			type: ActivityType.Listening,
		},
		{
			name: `over ${client.guilds.cache.size} servers`,
			type: ActivityType.Watching,
		},
	];

	const birthdayStatus: ActivityOptions = {
		name: "my birthday today!",
		type: ActivityType.Streaming,
		url: "https://www.youtube.com/shorts/eS9g6cnF7Z8", // Required for Streaming type
	};

	/**
	 * Updates the bot's status based on whether it's Tomori's birthday.
	 * If it's May 11, shows birthday status; otherwise rotates through normal statuses.
	 */
	function updateStatus(): void {
		if (!client.user) return;

		// 1. Check if today is Tomori's birthday
		if (isTomoriBirthday()) {
			// 2. Set birthday status
			client.user.setActivity(birthdayStatus);
		} else {
			// 3. Normal status rotation
			if (normalStatus.length > 0) {
				const random = Math.floor(Math.random() * normalStatus.length);
				client.user.setActivity(normalStatus[random]);
			}
		}
	}

	// Set initial status on startup
	updateStatus();

	// Update status every cycle (5 minutes)
	setInterval(() => {
		updateStatus();
	}, CYCLE_DELAY);
};

export default handler;
