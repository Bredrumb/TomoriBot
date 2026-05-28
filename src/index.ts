import { Client, GatewayIntentBits, Partials } from "discord.js";
import { config } from "dotenv";
import { sql } from "@/utils/db/client";
import { initializeDatabase } from "@/utils/db/initializeDatabase";
import { log } from "./utils/misc/logger";
import { createServer } from "node:http";
import eventHandler from "./handlers/eventHandler";
import { initializeLocalizer } from "./utils/text/localizer";
import { getAppSecrets } from "./utils/security/secretsManager";
import { keyManager } from "./utils/security/keyManager";
import { healthTracker } from "./utils/misc/healthTracker";

config({ quiet: true });

// Bind to PORT immediately so Cloud Run's startup probe passes before the rest of init runs.
// Returns 503 until Discord is connected; Cloud Run only requires the port to be bound, not 200.
if ((process.env.RUN_ENV || "development") === "production") {
  const healthPort = parseInt(process.env.PORT ?? "8080", 10);

  /**
   * Health check endpoint for container platform health monitoring (Cloud Run / AWS ECS).
   * Returns 200 OK only when ALL conditions are met:
   * 1. Event loop is responsive (HTTP server can answer)
   * 2. Discord client is in READY state (connected and functional)
   * 3. WebSocket heartbeat is healthy (ping < 5 seconds)
   *
   * Returns 503 during startup (before Discord connects) — this is expected and safe.
   * The container platform only requires the port to be bound, not 200, during startup.
   */
  const healthCheckServer = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const healthStatus = healthTracker.getHealthStatus();

      if (healthStatus.healthy) {
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
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  });

  healthCheckServer.listen(healthPort, "0.0.0.0", () => {
    log.success(`Health check server listening on http://0.0.0.0:${healthPort}/health`);
  });

  healthCheckServer.on("error", (error) => {
    log.error("Health check server error", error);
  });
}

// Load secrets from GCP Secret Manager (production) or .env (development)
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

if (secrets.AVATAR_S3_BUCKET) {
  process.env.AVATAR_S3_BUCKET = secrets.AVATAR_S3_BUCKET;
}
if (secrets.AVATAR_S3_REGION) {
  process.env.AVATAR_S3_REGION = secrets.AVATAR_S3_REGION;
}
if (secrets.AVATAR_S3_PREFIX) {
  process.env.AVATAR_S3_PREFIX = secrets.AVATAR_S3_PREFIX;
}
if (secrets.AVATAR_PUBLIC_BASE_URL) {
  process.env.AVATAR_PUBLIC_BASE_URL = secrets.AVATAR_PUBLIC_BASE_URL;
}
if (secrets.CHARREF_S3_BUCKET) {
  process.env.CHARREF_S3_BUCKET = secrets.CHARREF_S3_BUCKET;
}
if (secrets.CHARREF_S3_REGION) {
  process.env.CHARREF_S3_REGION = secrets.CHARREF_S3_REGION;
}
if (secrets.CHARREF_S3_PREFIX) {
  process.env.CHARREF_S3_PREFIX = secrets.CHARREF_S3_PREFIX;
}
if (secrets.CHARREF_PUBLIC_BASE_URL) {
  process.env.CHARREF_PUBLIC_BASE_URL = secrets.CHARREF_PUBLIC_BASE_URL;
}

// Optional Matrix Appservice Bridge credentials
if (secrets.MATRIX_HOMESERVER_URL) {
  process.env.MATRIX_HOMESERVER_URL = secrets.MATRIX_HOMESERVER_URL;
}
if (secrets.MATRIX_ACCESS_TOKEN) {
  process.env.MATRIX_ACCESS_TOKEN = secrets.MATRIX_ACCESS_TOKEN;
}
if (secrets.MATRIX_BOT_USER_ID) {
  process.env.MATRIX_BOT_USER_ID = secrets.MATRIX_BOT_USER_ID;
}
if (secrets.MATRIX_SERVER_NAME) {
  process.env.MATRIX_SERVER_NAME = secrets.MATRIX_SERVER_NAME;
}
if (secrets.MATRIX_HS_TOKEN) {
  process.env.MATRIX_HS_TOKEN = secrets.MATRIX_HS_TOKEN;
}
if (secrets.MATRIX_APPSERVICE_PUBLIC_URL) {
  process.env.MATRIX_APPSERVICE_PUBLIC_URL = secrets.MATRIX_APPSERVICE_PUBLIC_URL;
}

// Optional Top.gg integration token
if (secrets.TOPGG_TOKEN) {
  process.env.TOPGG_TOKEN = secrets.TOPGG_TOKEN;
}

// Optional infrastructure config — must be set before any module reads MEMORY_PROTECTION()
if (secrets.CONTAINER_MEMORY_LIMIT_MB) {
  process.env.CONTAINER_MEMORY_LIMIT_MB = secrets.CONTAINER_MEMORY_LIMIT_MB;
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

try {
  await initializeDatabase();
} catch {
  process.exit(1);
}

// Clean up expired cooldowns on startup (development alternative to pg_cron)
log.section("Cleaning up expired cooldowns...");
try {
  const { cleanupExpiredCooldowns } = await import("./utils/db/cooldownsCleanup");
  const cleanupResult = await cleanupExpiredCooldowns();
  if (cleanupResult.success) {
    log.success(`Cooldowns cleanup completed: ${cleanupResult.deletedCount} expired entries removed`);
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
      log.warn("pg_cron extension not available - using startup cleanup method");
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
      log.success(`pg_cron job for cooldown cleanup scheduled/verified for ${host}:${port}`);
    }
  }
} catch (err) {
  log.info(`pg_cron setup failed (non-critical): ${err instanceof Error ? err.message : err}`);
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
  const { initializeOpenRouterCapabilityCache } = await import("./utils/cache/openrouterCapabilityCache");
  await initializeOpenRouterCapabilityCache();
  log.success("OpenRouter capability cache initialized successfully");
} catch (error) {
  log.warn(
    "Failed to initialize OpenRouter capability cache (non-critical) - " + "will fall back to database flags",
    error,
  );
  // Non-critical error - bot will use database flags as fallback
}

// Initialize preset avatar cache
log.section("Initializing Preset Avatar Cache...");
try {
  const { loadAllPresets } = await import("./utils/db/dbRead");
  const { initializePresetAvatarCache } = await import("./utils/image/avatarHelper");

  const presets = await loadAllPresets();
  if (presets && presets.length > 0) {
    await initializePresetAvatarCache(presets);
    log.success("Preset avatar cache initialized successfully");
  } else {
    log.warn("No presets found to cache - avatar cache will be empty (non-critical)");
  }
} catch (error) {
  log.warn("Failed to initialize preset avatar cache (non-critical)", error);
  // Non-critical error - bot can still function without cached avatars
}

// Initialize Matrix bridge (optional — silent no-op if credentials not configured)
log.section("Initializing Matrix Bridge...");
try {
  const { initializeMatrixClient } = await import("./utils/matrix");
  await initializeMatrixClient(client);
} catch (error) {
  // Safely extract message/stack before passing to logger — the bridge error object
  // contains circular references that crash JSON serialization inside log.warn()
  const safeMsg = error instanceof Error ? error.message : String(error);
  const safeStack = error instanceof Error ? error.stack : undefined;
  log.warn(`Matrix bridge initialization failed (non-critical): ${safeMsg}\n${safeStack ?? ""}`);
  // Non-critical error — bot functions normally without the Matrix bridge
}

// Starts the event handler, which also runs important 'ready' functions
// such as registering or updating of commands upon startup
eventHandler(client);

// Initialize health tracker after client is ready
client.once("clientReady", () => {
  healthTracker.initialize(client);
  log.success("Health tracker initialized");
});

// Initialize shared scheduled work coordinator for reminders and random triggers
log.section("Initializing Scheduled Work Coordinator...");
try {
  const { initializeScheduledWorkCoordinator } = await import("./timers/scheduledWorkCoordinator");

  // Start scheduled work after client is ready
  client.once("clientReady", () => {
    initializeScheduledWorkCoordinator(client);
    log.success("Scheduled work coordinator initialized");
  });
} catch (error) {
  log.error("Failed to initialize scheduled work coordinator", error as Error);
  // Non-critical error - reminders and random triggers won't work but bot can still function
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

// Initialize cache metrics logger - periodic size snapshots of every in-memory cache
// Emits one structured log.metric() line per interval so CloudWatch can graph growth
// over time and correlate with RSS. See src/timers/cacheMetricsLogger.ts for query examples.
log.section("Initializing Cache Metrics Logger...");
try {
  const { initializeCacheMetricsLogger } = await import("./timers/cacheMetricsLogger");

  client.once("clientReady", () => {
    initializeCacheMetricsLogger(client);
    log.success("Cache metrics logger initialized");
  });
} catch (error) {
  log.error("Failed to initialize cache metrics logger", error as Error);
  // Non-critical error - diagnostics won't work but bot can still function
}

// Initialize quota cleanup system
log.section("Initializing Upload Quota System...");
try {
  const { initializeQuotaCleanup } = await import("./utils/security/rateLimiter");

  initializeQuotaCleanup();
  log.success("Upload quota tracking system initialized");
} catch (error) {
  log.error("Failed to initialize quota cleanup system", error as Error);
  // Non-critical error - quota tracking won't work but bot can still function
}

// Login Bot using Discord Token
client.login(process.env.DISCORD_TOKEN);
