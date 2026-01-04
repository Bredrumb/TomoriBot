# 4. Entry Point & Initialization Flow

This document provides a detailed walkthrough of `src/index.ts`, TomoriBot's entry point, explaining what happens from startup to when the bot is fully online.

## File Location

**Path:** `/home/user/TomoriSide/src/index.ts`

This is the file that runs when you execute `bun run dev` or `bun run start`.

## Initialization Overview

The initialization process follows this sequence:

1. **Environment Setup** - Load config and secrets
2. **Security Init** - Initialize encryption key manager
3. **Database Connection** - Connect to PostgreSQL
4. **Schema Initialization** - Run migrations and seed data
5. **Cleanup Tasks** - Remove expired cooldowns, set up cron
6. **Tool Registry** - Register all available tools
7. **Localization** - Load translation files
8. **Caching** - Initialize in-memory caches
9. **Event Listeners** - Attach Discord event handlers
10. **Reminder System** - Start reminder polling
11. **Discord Login** - Connect to Discord and go online

Let's walk through each section in detail.

## Section-by-Section Breakdown

### 1. Imports and Dependencies

```typescript
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { config } from "dotenv";
import { sql } from "bun";
import { log } from "./utils/misc/logger";
import path from "node:path";
import eventHandler from "./handlers/eventHandler";
import { initializeLocalizer } from "./utils/text/localizer";
import { keyManager } from "./utils/security/keyManager";
```

**Key Imports:**
- **discord.js**: Discord API library (Client, intents, partials)
- **dotenv**: Loads environment variables from `.env`
- **bun**: Bun's built-in SQL client for PostgreSQL
- **log**: Custom logging utility with colored output
- **eventHandler**: Sets up all Discord event listeners
- **keyManager**: Handles encryption key management

### 2. Load Environment Variables

```typescript
config();
```

**Purpose:** Loads variables from `.env` file into `process.env`.

**Loaded Variables:**
- `DISCORD_TOKEN` - Bot authentication
- `CRYPTO_SECRET` - Encryption key for API keys
- `POSTGRES_*` - Database connection details
- `DEFAULT_BOTNAME` - Bot's display name
- `BASE_TRIGGER_WORDS` - Words that trigger the bot

**Why First?** All subsequent code depends on these environment variables.

### 3. Initialize Encryption Key Manager

```typescript
log.section("Initializing Encryption Key Manager...");
const rotationStatus = keyManager.getRotationStatus();
log.success(
  `Encryption key manager initialized: V${rotationStatus.currentVersion} active, ` +
  `${rotationStatus.availableVersions.length} version(s) available, ` +
  `rotation ${rotationStatus.rotationCapable ? "enabled" : "disabled"}`
);
```

**What Happens:**
1. `keyManager` auto-initializes when imported (singleton pattern)
2. Derives encryption key from `CRYPTO_SECRET`
3. Sets up key versioning system (V1, V2, etc.)
4. Logs current status

**Output Example:**
```
┌──────────────────────────────────────────────────┐
│ Initializing Encryption Key Manager...          │
└──────────────────────────────────────────────────┘
✓ Encryption key manager initialized: V1 active, 1 version(s) available, rotation disabled
```

**Why Important:** All API keys stored in the database are encrypted with this key.

### 4. Build PostgreSQL Connection URL

```typescript
function getPostgresUrl(): string {
  // If POSTGRES_URL is provided, use it directly (backwards compatibility)
  if (process.env.POSTGRES_URL) {
    return process.env.POSTGRES_URL;
  }

  // Otherwise, build URL from components
  const host = process.env.POSTGRES_HOST || "localhost";
  const port = process.env.POSTGRES_PORT || "5432";
  const user = process.env.POSTGRES_USER || "postgres";
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DB || "tomodb";

  if (!password) {
    throw new Error(
      "Database password must be provided via POSTGRES_PASSWORD or POSTGRES_URL"
    );
  }

  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

const postgresUrl = getPostgresUrl();
const dbUrl = new URL(postgresUrl);
process.env.DATABASE_URL = postgresUrl; // Set for other modules

const dbHost = dbUrl.hostname;
const dbPort = parseInt(dbUrl.port || "5432", 10);
```

**Flexibility:** Supports two configuration methods:
1. **Component-based** (recommended): Individual vars like `POSTGRES_HOST`, `POSTGRES_PORT`, etc.
2. **URL-based** (legacy): Single `POSTGRES_URL` like `postgresql://user:pass@host:5432/db`

**Error Handling:** Throws immediately if password is missing - no point continuing without DB.

### 5. Create Discord Client

```typescript
// Build intents array - conditionally include GuildPresences for non-production only
const intents = [
  GatewayIntentBits.Guilds,              // Access server info
  GatewayIntentBits.GuildMembers,        // Access member list (privileged)
  GatewayIntentBits.GuildMessages,       // Read server messages
  GatewayIntentBits.MessageContent,      // Read message text (privileged)
  GatewayIntentBits.GuildVoiceStates,    // Voice channel info
  GatewayIntentBits.DirectMessages,      // DM support
  GatewayIntentBits.GuildMessageReactions, // React to messages
  GatewayIntentBits.GuildExpressions,    // Access emojis/stickers
];

// GuildPresences intent only available in non-production (rejected for production approval)
if ((process.env.RUN_ENV || "development") !== "production") {
  intents.push(GatewayIntentBits.GuildPresences);
}

const client = new Client({
  intents,
  partials: [Partials.Channel, Partials.Message], // Handle uncached data
});
```

**Intents Explained:**
- **Intents** tell Discord which events you want to receive
- **Privileged Intents** (MessageContent, GuildMembers, GuildPresences) must be enabled in Discord Developer Portal
- **Partials** allow handling events for uncached channels/messages (like DMs)
- **Environment-specific Intents**: GuildPresences is only loaded in development/testing environments

**Why These Intents?**
- `MessageContent` - Required to read message text for chat (privileged, approved)
- `GuildMembers` - Required to access member info (privileged, approved)
- `GuildExpressions` - Needed for emoji/sticker features
- `GuildPresences` - Optional, for seeing user status (privileged, only available in non-production)

### 6. Error Handling Setup

```typescript
client.on("error", (error) => {
  log.error("Discord client error occurred", error);
});

client.on("shardError", (error) => {
  log.error("Discord WebSocket shard error occurred", error);
});

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
    metadata: { promise: promise.toString() }
  });
});
```

**Error Types:**
1. **Discord Client Errors**: Connection issues, API errors
2. **Shard Errors**: WebSocket connection problems
3. **Uncaught Exceptions**: Synchronous errors not caught by try/catch
4. **Unhandled Rejections**: Promises without .catch()

**Why Special WebSocket Handling?**
- Discord.js sometimes throws malformed error objects
- These would normally crash the bot
- We catch them and let Discord.js handle reconnection

### 7. Database Initialization with Retry Logic

```typescript
log.section("Initializing Database...");

// Small delay in development to reduce hot-reload conflicts
if (process.env.NODE_ENV !== "production") {
  await new Promise(resolve => setTimeout(resolve, 500));
}

async function initializeDatabase(maxRetries = 3, delayMs = 1000): Promise<void> {
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
          `Database initialization attempt ${attempt} failed due to concurrency (retrying in ${delayMs}ms): ${errorMessage}`
        );
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        // Non-retryable error or max retries exceeded
        log.error(
          `PostgreSQL database initialization failed after ${attempt} attempts:`,
          err
        );
        process.exit(1);
      }
    }
  }
}

await initializeDatabase();
```

**Key Features:**
1. **Idempotent**: `schema.sql` uses `CREATE TABLE IF NOT EXISTS` and `add_column_if_not_exists()`
2. **Retry Logic**: Handles race conditions during hot-reload in development
3. **Development Delay**: 500ms delay prevents concurrent schema runs
4. **Concurrency Detection**: Retries on deadlock/serialization errors

**What Gets Created:**
- All tables (servers, users, tomoris, configs, memories, etc.)
- Indexes for performance
- Triggers for `updated_at` timestamps
- Helper functions for migrations
- Default presets (seed data)

### 8. Cooldown Cleanup

```typescript
log.section("Cleaning up expired cooldowns...");
try {
  const { cleanupExpiredCooldowns } = await import("./utils/db/cooldownsCleanup");
  const cleanupResult = await cleanupExpiredCooldowns();
  if (cleanupResult.success) {
    log.success(
      `Cooldowns cleanup completed: ${cleanupResult.deletedCount} expired entries removed`
    );
  } else {
    log.warn(`Cooldowns cleanup failed: ${cleanupResult.error}`);
  }
} catch (error) {
  log.warn("Error during startup cooldowns cleanup:", error);
  // Non-critical error - continue startup
}
```

**Purpose:** Delete old cooldown entries from the database.

**Cooldowns Used For:**
- Rate limiting commands (prevent spam)
- Temporary bans or restrictions
- Feature usage limits

**Why Non-Critical:** Bot can still function; cleanup just saves DB space.

### 9. pg_cron Setup (Optional)

```typescript
if (!postgresUrl) {
  log.warn("POSTGRES_URL not found in .env. Skipping cron job scheduling.");
} else {
  try {
    // Check if pg_cron extension is available
    const [extensionCheck] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_available_extensions
        WHERE name = 'pg_cron'
      ) as available
    `;

    if (!extensionCheck?.available) {
      log.warn("pg_cron extension not available - using startup cleanup method");
    } else {
      // Enable pg_cron extension
      await sql`CREATE EXTENSION IF NOT EXISTS pg_cron;`;

      // Schedule hourly cleanup function
      await sql`
        INSERT INTO cron.job (schedule, command, nodename, nodeport, database, username)
        VALUES (
          '0 * * * *', -- Run at the start of every hour
          'SELECT cleanup_expired_cooldowns();',
          ${dbHost},
          ${dbPort},
          current_database(),
          current_user
        )
        ON CONFLICT (command, database, username, nodename, nodeport)
        DO UPDATE SET schedule = EXCLUDED.schedule;
      `;
      log.success(`pg_cron job for cooldown cleanup scheduled`);
    }
  } catch (err) {
    log.info(`pg_cron setup failed (non-critical): ${err.message}`);
    log.info("Cooldown cleanup will be handled by startup method instead");
  }
}
```

**What is pg_cron?**
- PostgreSQL extension for scheduled tasks (like Linux cron)
- Runs SQL commands on a schedule

**Why Optional?**
- Not all PostgreSQL installations have pg_cron
- Startup cleanup is sufficient for most deployments
- Production servers can use pg_cron for efficiency

### 10. Initialize Tool Registry

```typescript
log.section("Initializing Tool Registry...");
try {
  const { initializeTools } = await import("./tools/toolInitializer");
  await initializeTools();
  log.success("Tool registry initialized successfully");
} catch (error) {
  log.error("Failed to initialize tool registry", error);
  process.exit(1);
}
```

**What Happens:**
1. Scans `src/tools/functionCalls/` for tool files
2. Imports each tool module
3. Registers tools in the centralized `ToolRegistry`
4. Validates tool structure

**Registered Tools:**
- Memory tool (self-teaching)
- Reminder tool
- Sticker/emoji tools
- YouTube video info
- Profile picture peek
- Message pinning
- And more...

**Critical:** If tool registry fails, bot cannot function properly.

### 11. Initialize Localization

```typescript
log.section("Initializing Locales...");
await initializeLocalizer();
```

**What Happens:**
1. Loads `src/locales/en-US.ts`
2. Loads `src/locales/ja.ts`
3. Builds translation maps
4. Sets default language (English)

**Output Example:**
```
✓ Localizer initialized with 2 locale(s): en-US, ja
```

### 12. Initialize LLM Configuration Cache

```typescript
log.section("Initializing LLM Configuration Cache...");
try {
  const { initializeLLMCache } = await import("./utils/cache/llmCache");
  await initializeLLMCache();
  log.success("LLM configuration cache initialized successfully");
} catch (error) {
  log.warn("Failed to initialize LLM cache (non-critical)", error);
  // Non-critical error - bot will fall back to database queries
}
```

**Purpose:** Cache server configurations in memory to avoid repeated DB queries.

**Cached Data:**
- API provider (Google/NovelAI)
- Model name
- Temperature setting
- Humanizer options
- Feature flags

**Why Non-Critical:** On failure, bot queries DB directly (slower but functional).

### 13. Initialize Preset Avatar Cache

```typescript
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
}
```

**Purpose:** Pre-load and process preset avatar images.

**Presets:**
- Default personality avatars stored in `src/db/img/`
- Converted to Base64 for embedding
- Processed for optimal Discord display

**Why Non-Critical:** Avatars can be loaded on-demand if cache fails.

### 14. Attach Event Listeners

```typescript
eventHandler(client);
```

**What Happens:**
1. `eventHandler()` reads the `eventFolderMap` (maps Discord events to handler folders)
2. For each event (messageCreate, interactionCreate, etc.):
   - Scans the corresponding folder for handler files
   - Attaches a listener to the Discord client
   - When event fires, runs all handlers in alphabetical order

**Example:**
```
Event: "messageCreate"
Folder: src/events/messageCreate/
Files:
  - jpTrans.ts          (handles Japanese translation)
  - tomoriChat.ts       (handles AI chat responses)
```

### 15. Initialize Reminder System

```typescript
log.section("Initializing Reminder System...");
try {
  const { initializeReminderTimer } = await import("./timers/reminderTimer");

  // Start reminder timer after client is ready
  client.once("clientReady", () => {
    initializeReminderTimer(client);
    log.success("Reminder system initialized with fallback polling");
  });
} catch (error) {
  log.error("Failed to initialize reminder system", error);
  // Non-critical error - reminders won't work but bot can still function
}
```

**What is Reminder Timer?**
- Polls the database every minute for due reminders
- Sends reminder messages to users
- Fallback for when pg_cron is unavailable

**Why After clientReady?**
- Needs Discord client to send messages
- Ensures bot is fully connected before starting polls

### 16. Login to Discord

```typescript
client.login(process.env.DISCORD_TOKEN);
```

**What Happens:**
1. Authenticates with Discord API using bot token
2. Establishes WebSocket connection
3. Fires "clientReady" event when connection is complete

**This is Non-Blocking:** Code execution completes here, but event listeners remain active.

## The clientReady Event

After login completes, Discord fires the `clientReady` event. TomoriBot has three handlers in `src/events/clientReady/`:

### 1. `01_registercommands.ts` (runs first)

```typescript
// Registers all slash commands with Discord
// Scans src/commands/ folders
// Updates Discord's command registry
```

### 2. `02_registerMCPs.ts` (runs second)

```typescript
// Registers Model Context Protocol servers
// Sets up Brave Search, DuckDuckGo, Fetch MCP servers
// Connects to external tool providers
```

### 3. `03_initCommandRegistry.ts` (runs third)

```typescript
// Builds internal command registry
// Maps command names to their execute functions
// Used by interactionCreate handler
```

### 4. `status.ts` (runs fourth)

```typescript
// Sets bot's Discord status
// Logs "TomoriBot is now online!"
```

### 5. Post-Ready Initialization

After command registration, additional systems are initialized:

```typescript
// Start memory monitoring (timers/memoryMonitor.ts)
// Monitors process memory usage and logs warnings
startMemoryMonitor();

// Initialize upload quota cleanup
// Cleans up expired file upload quotas
initializeQuotaCleanup();

// Start reminder polling system
// Checks for due reminders every minute
startReminderPolling();
```

**Naming Convention:** Files prefixed with numbers (`01_`, `02_`) run in that order due to alphabetical sorting.

## Startup Timeline

Here's the complete timeline with approximate durations:

```
T+0ms      : Load .env
T+10ms     : Initialize encryption key manager
T+50ms     : Connect to PostgreSQL
T+200ms    : Run schema migrations
T+300ms    : Run seed data
T+350ms    : Clean up cooldowns
T+400ms    : Attempt pg_cron setup (optional)
T+500ms    : Initialize tool registry
T+700ms    : Load localization files
T+800ms    : Initialize LLM cache
T+900ms    : Initialize avatar cache
T+950ms    : Attach event listeners
T+1000ms   : Login to Discord
T+2000ms   : Discord connection established
T+2100ms   : clientReady event fires
T+2200ms   : Register slash commands
T+2500ms   : Register MCP servers
T+2600ms   : Initialize command registry
T+2700ms   : Set Discord status
T+2750ms   : Start memory monitoring
T+2800ms   : Initialize upload quota cleanup
T+2850ms   : Start reminder polling system
T+2900ms   : Log "TomoriBot is now online!"
```

**Total:** ~2.9 seconds from start to fully operational (in development mode).

## Common Startup Issues

### Issue: "Database connection failed"

**Cause:** Incorrect PostgreSQL credentials or server not running.

**Fix:**
1. Verify PostgreSQL is running: `sudo service postgresql status`
2. Check `.env` credentials match your database
3. Test connection: `psql -U <user> -d <database>`

### Issue: "Missing DISCORD_TOKEN"

**Cause:** `.env` file doesn't have `DISCORD_TOKEN`.

**Fix:**
1. Copy `.env.example` to `.env`
2. Add your bot token from Discord Developer Portal

### Issue: "Tool registry initialization failed"

**Cause:** Syntax error in a tool file, or missing dependencies.

**Fix:**
1. Check the error message for which tool file failed
2. Run `bun run check` to check for TypeScript errors
3. Ensure all dependencies are installed: `bun install`

### Issue: "Commands not showing in Discord"

**Cause:** Bot doesn't have `applications.commands` scope, or commands failed to register.

**Fix:**
1. Check bot invite URL includes `applications.commands` scope
2. Re-invite bot with correct scopes
3. Run `/tool refresh` to force command re-registration

## Next Steps

Now that you understand the initialization flow:

1. **Read "Database Schema"** (document 5) to see what gets created during initialization
2. **Explore "Event System"** (document 6) to understand what happens after startup
3. **Study "Tool System"** (document 9) to see how tool registry works

You now know exactly what happens from `bun run dev` to "TomoriBot is now online!" 🎉
