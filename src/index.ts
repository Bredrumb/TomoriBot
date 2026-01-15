import { Client, GatewayIntentBits, Partials } from "discord.js";
import { config } from "dotenv";
import { sql } from "@/utils/db/client";
import { log } from "./utils/misc/logger";
import path from "node:path";
import { createServer } from "node:http";
import eventHandler from "./handlers/eventHandler";
import { initializeLocalizer } from "./utils/text/localizer";
import { getAppSecrets } from "./utils/security/secretsManager";
import { keyManager } from "./utils/security/keyManager";
import { healthTracker } from "./utils/misc/healthTracker";

config({ quiet: true });

// Load secrets from AWS Secrets Manager (production) or .env (development)
log.section("Loading Application Secrets...");
const secrets = await getAppSecrets();

// Assign secrets to process.env for backwards compatibility with existing code
process.env.DISCORD_TOKEN = secrets.DISCORD_TOKEN;
process.env.POSTGRES_HOST = secrets.POSTGRES_HOST;
process.env.POSTGRES_PORT = secrets.POSTGRES_PORT;
process.env.POSTGRES_USER = secrets.POSTGRES_USER;
process.env.POSTGRES_PASSWORD = secrets.POSTGRES_PASSWORD;
process.env.POSTGRES_DB = secrets.POSTGRES_DB;
process.env.CRYPTO_SECRET = secrets.CRYPTO_SECRET;

// Auto-detect and assign key versions (CRYPTO_SECRET_V1, V2, V3, etc.)
if (secrets.CRYPTO_SECRET_V1) {
	process.env.CRYPTO_SECRET_V1 = secrets.CRYPTO_SECRET_V1;
}
if (secrets.CRYPTO_SECRET_V2) {
	process.env.CRYPTO_SECRET_V2 = secrets.CRYPTO_SECRET_V2;
}
if (secrets.CRYPTO_SECRET_V3) {
	process.env.CRYPTO_SECRET_V3 = secrets.CRYPTO_SECRET_V3;
}

// Optional webhook URL
if (secrets.DISCORD_WEBHOOK_URL) {
	process.env.DISCORD_WEBHOOK_URL = secrets.DISCORD_WEBHOOK_URL;
}

log.success(
	`Secrets loaded successfully from ${(process.env.RUN_ENV || "development") === "production" && process.env.TEST_PRODUCTION !== "true" ? "AWS Secrets Manager" : ".env file"}`,
);

// Initialize encryption key manager AFTER secrets are loaded
// Dynamically import keyManager NOW, after process.env is populated
keyManager.initialize();

const rotationStatus = keyManager.getRotationStatus();
log.success(
	`Encryption key manager initialized: V${rotationStatus.currentVersion} active, ` +
		`${rotationStatus.availableVersions.length} version(s) available, ` +
		`rotation ${rotationStatus.rotationCapable ? "enabled" : "disabled"}`,
);

// Database client is now initialized in @/utils/db/client.ts
// SSL configuration and connection setup is handled there based on environment

// Build intents array - conditionally include GuildPresences for non-production only
const intents = [
	GatewayIntentBits.Guilds,
	GatewayIntentBits.GuildMembers,
	GatewayIntentBits.GuildMessages,
	GatewayIntentBits.MessageContent,
	GatewayIntentBits.GuildVoiceStates,
	GatewayIntentBits.DirectMessages,
	GatewayIntentBits.GuildMessageReactions,
	GatewayIntentBits.GuildExpressions,
];

// GuildPresences intent only available in non-production (rejected for production approval)
if ((process.env.RUN_ENV || "development") !== "production") {
	intents.push(GatewayIntentBits.GuildPresences);
}

const client = new Client({
	intents,
	partials: [Partials.Channel, Partials.Message],
	/**
	 * Cache sweepers prevent unbounded memory growth by automatically removing old cached data.
	 * These settings optimize memory usage while maintaining recent data for performance.
	 */
	sweepers: {
		/**
		 * Message sweeper: Removes messages older than 30 minutes, runs every hour.
		 * Keeps recent conversation context while preventing message cache bloat.
		 */
		messages: {
			interval: 3600, // Run sweep every 1 hour (in seconds)
			lifetime: 1800, // Keep messages for 30 minutes (in seconds)
		},
		/**
		 * User sweeper: Removes bot users from cache, runs every hour.
		 * Keeps real users cached for faster lookups while removing unnecessary bot data.
		 */
		users: {
			interval: 3600, // Run sweep every 1 hour (in seconds)
			filter: () => (user) => user.bot,
		},
	},
});

/**
 * Handle Discord client errors to prevent crashes from malformed error objects
 */
client.on("error", (error) => {
	log.error("Discord client error occurred", error);
});

client.on("shardError", (error) => {
	log.error("Discord WebSocket shard error occurred", error);
});

/**
 * Handle process-level uncaught errors to prevent crashes
 */
process.on("uncaughtException", (error) => {
	log.error("Uncaught exception occurred", error);
	// Don't exit process for WebSocket errors - let Discord.js reconnect
	if (error.message?.includes("error is not an Object")) {
		log.warn("WebSocket error caught - Discord.js will attempt to reconnect");
		return;
	}
	process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
	log.error("Unhandled promise rejection", reason, {
		errorType: "UnhandledPromiseRejection",
		metadata: { promise: promise.toString() },
	});
});

log.section("Initializing Database...");

// Small delay in development to reduce hot-reload conflicts
if ((process.env.RUN_ENV || "development") !== "production") {
	await new Promise((resolve) => setTimeout(resolve, 500));
}

/**
 * Initialize database schema and seed data with retry logic for development hot-reloading
 * @param maxRetries - Maximum number of retry attempts
 * @param delayMs - Delay between retries in milliseconds
 */
async function initializeDatabase(
	maxRetries = 3,
	delayMs = 1000,
): Promise<void> {
	const schemaPath = path.join(import.meta.dir, "db", "schema.sql");
	const seedPath = path.join(import.meta.dir, "db", "seed.sql");

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			// Initialize schema
			await sql.file(schemaPath);
			log.success("PostgreSQL database schema verified");

			// Initialize seed data
			await sql.file(seedPath);
			log.success("PostgreSQL database seed verified");

			return; // Success - exit retry loop
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);

			// Check if this is a concurrency error that might resolve with retry
			const isConcurrencyError =
				errorMessage.includes("tuple concurrently updated") ||
				errorMessage.includes("could not serialize access") ||
				errorMessage.includes("deadlock detected");

			if (isConcurrencyError && attempt < maxRetries) {
				log.warn(
					`Database initialization attempt ${attempt} failed due to concurrency (retrying in ${delayMs}ms): ${errorMessage}`,
				);
				await new Promise((resolve) => setTimeout(resolve, delayMs));
			} else {
				// Non-retryable error or max retries exceeded
				log.error(
					`PostgreSQL database initialization failed after ${attempt} attempts:`,
					err,
				);
				process.exit(1);
			}
		}
	}
}

await initializeDatabase();

// Clean up expired cooldowns on startup (development alternative to pg_cron)
log.section("Cleaning up expired cooldowns...");
try {
	const { cleanupExpiredCooldowns } = await import(
		"./utils/db/cooldownsCleanup"
	);
	const cleanupResult = await cleanupExpiredCooldowns();
	if (cleanupResult.success) {
		log.success(
			`Cooldowns cleanup completed: ${cleanupResult.deletedCount} expired entries removed`,
		);
	} else {
		log.warn(`Cooldowns cleanup failed: ${cleanupResult.error}`);
	}
} catch (error) {
	log.warn("Error during startup cooldowns cleanup:", error);
	// Non-critical error - continue startup
}

// Attempt to set up pg_cron for production environments (non-critical)
try {
	const host = process.env.POSTGRES_HOST || "localhost";
	const port = Number.parseInt(process.env.POSTGRES_PORT || "5432", 10);

	if (!host || Number.isNaN(port)) {
		log.warn("Could not determine database host/port for pg_cron setup");
	} else {
		// 1. First check if the pg_cron extension is available
		const [extensionCheck] = await sql`
			SELECT EXISTS (
				SELECT 1 FROM pg_available_extensions
				WHERE name = 'pg_cron'
			) as available
		`;

		if (!extensionCheck?.available) {
			log.warn(
				"pg_cron extension not available - using startup cleanup method",
			);
		} else {
			// 2. Enable pg_cron extension
			await sql`CREATE EXTENSION IF NOT EXISTS pg_cron;`;

			// 3. Schedule the cleanup function with a unique jobname
			// First, try to delete any existing job with the same name to ensure idempotency
			// This works across all pg_cron versions without relying on specific constraints
			await sql`
				DELETE FROM cron.job
				WHERE jobname = 'tomoribot_cooldown_cleanup'
			`;

			// 4. Insert the new/updated job
			await sql`
				INSERT INTO cron.job (jobname, schedule, command, nodename, nodeport, database, username)
				VALUES (
					'tomoribot_cooldown_cleanup',
					'0 * * * *', -- Run at the start of every hour
					'SELECT cleanup_expired_cooldowns();',
					${host},
					${port},
					current_database(),
					current_user
				)
			`;
			log.success(
				`pg_cron job for cooldown cleanup scheduled/verified for ${host}:${port}`,
			);
		}
	}
} catch (err) {
	log.info(
		`pg_cron setup failed (non-critical): ${err instanceof Error ? err.message : err}`,
	);
	log.info("Cooldown cleanup will be handled by startup method instead");
}

// Initialize modular tool system
log.section("Initializing Tool Registry...");
try {
	const { initializeTools } = await import("./tools/toolInitializer");
	await initializeTools();
	log.success("Tool registry initialized successfully");
} catch (error) {
	log.error("Failed to initialize tool registry", error as Error);
	process.exit(1);
}

// Initialize localization
log.section("Initializing Locales...");
await initializeLocalizer();

// Initialize LLM configuration cache
log.section("Initializing LLM Configuration Cache...");
try {
	const { initializeLLMCache } = await import("./utils/cache/llmCache");
	await initializeLLMCache();
	log.success("LLM configuration cache initialized successfully");
} catch (error) {
	log.warn("Failed to initialize LLM cache (non-critical)", error);
	// Non-critical error - bot will fall back to database queries
}

// Initialize OpenRouter capability cache
log.section("Initializing OpenRouter Capability Cache...");
try {
	const { initializeOpenRouterCapabilityCache } = await import(
		"./utils/cache/openrouterCapabilityCache"
	);
	await initializeOpenRouterCapabilityCache();
	log.success("OpenRouter capability cache initialized successfully");
} catch (error) {
	log.warn(
		"Failed to initialize OpenRouter capability cache (non-critical) - " +
			"will fall back to database flags",
		error,
	);
	// Non-critical error - bot will use database flags as fallback
}

// Initialize preset avatar cache
log.section("Initializing Preset Avatar Cache...");
try {
	const { loadAllPresets } = await import("./utils/db/dbRead");
	const { initializePresetAvatarCache } = await import(
		"./utils/image/avatarHelper"
	);

	const presets = await loadAllPresets();
	if (presets && presets.length > 0) {
		await initializePresetAvatarCache(presets);
		log.success("Preset avatar cache initialized successfully");
	} else {
		log.warn(
			"No presets found to cache - avatar cache will be empty (non-critical)",
		);
	}
} catch (error) {
	log.warn("Failed to initialize preset avatar cache (non-critical)", error);
	// Non-critical error - bot can still function without cached avatars
}

// Starts the event handler, which also runs important 'ready' functions
// such as registering or updating of commands upon startup
eventHandler(client);

// Initialize health tracker after client is ready
client.once("clientReady", () => {
	healthTracker.initialize(client);
	log.success("Health tracker initialized");
});

// Initialize reminder timer system (fallback for when pg_cron is not available)
log.section("Initializing Reminder System...");
try {
	const { initializeReminderTimer } = await import("./timers/reminderTimer");

	// Start reminder timer after client is ready
	client.once("clientReady", () => {
		initializeReminderTimer(client);
		log.success("Reminder system initialized with 1-minute polling");
	});
} catch (error) {
	log.error("Failed to initialize reminder system", error as Error);
	// Non-critical error - reminders won't work but bot can still function
}

// Initialize memory monitoring system
log.section("Initializing Memory Monitor...");
try {
	const { initializeMemoryMonitor } = await import("./timers/memoryMonitor");

	// Start memory monitor after client is ready
	client.once("clientReady", () => {
		initializeMemoryMonitor();
		log.success("Memory monitoring system initialized");
	});
} catch (error) {
	log.error("Failed to initialize memory monitor", error as Error);
	// Non-critical error - memory monitoring won't work but bot can still function
}

// Initialize quota cleanup system
log.section("Initializing Upload Quota System...");
try {
	const { initializeQuotaCleanup } = await import(
		"./utils/security/rateLimiter"
	);

	initializeQuotaCleanup();
	log.success("Upload quota tracking system initialized");
} catch (error) {
	log.error("Failed to initialize quota cleanup system", error as Error);
	// Non-critical error - quota tracking won't work but bot can still function
}

// Initialize health check server (production only - for AWS ECS monitoring)
if ((process.env.RUN_ENV || "development") === "production") {
	log.section("Initializing Health Check Server...");

	/**
	 * Health check endpoint for AWS ECS to monitor bot responsiveness
	 * Returns 200 OK only when ALL conditions are met:
	 * 1. Event loop is responsive (HTTP server can answer)
	 * 2. Discord client is in READY state (connected and functional)
	 * 3. WebSocket heartbeat is healthy (ping < 5 seconds)
	 * 4. Discord events are being received (activity within last 2 minutes)
	 *
	 * If any check fails (zombie state, frozen event loop, disconnected WebSocket),
	 * this endpoint will return 503 or timeout, triggering AWS to kill and restart the container.
	 */
	const healthCheckServer = createServer((req, res) => {
		// Only respond to GET /health
		if (req.method === "GET" && req.url === "/health") {
			// Get comprehensive health status from health tracker
			const healthStatus = healthTracker.getHealthStatus();

			if (healthStatus.healthy) {
				// All checks passed - return 200 OK
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						status: "healthy",
						reason: healthStatus.reason,
						discord: {
							connected: healthStatus.details.clientReady,
							websocketPing: healthStatus.details.websocketPing,
							timeSinceLastActivity: healthStatus.details.timeSinceLastActivity,
						},
						timestamp: new Date().toISOString(),
					}),
				);
			} else {
				// Health check failed - return 503 Service Unavailable
				res.writeHead(503, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						status: "unhealthy",
						reason: healthStatus.reason,
						discord: {
							connected: healthStatus.details.clientReady,
							websocketPing: healthStatus.details.websocketPing,
							timeSinceLastActivity: healthStatus.details.timeSinceLastActivity,
						},
						timestamp: new Date().toISOString(),
					}),
				);
			}
		} else {
			// Invalid endpoint
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("Not Found");
		}
	});

	// Bind to localhost only (not externally accessible)
	healthCheckServer.listen(3000, "127.0.0.1", () => {
		log.success("Health check server listening on http://127.0.0.1:3000/health");
	});

	// Handle health check server errors
	healthCheckServer.on("error", (error) => {
		log.error("Health check server error", error);
	});
}

// Login Bot using Discord Token
client.login(process.env.DISCORD_TOKEN);
