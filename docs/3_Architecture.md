# 3. Architecture Overview

This document explains TomoriBot's high-level architecture, design patterns, and how the major components fit together.

## Architectural Principles

TomoriBot is built on several key architectural principles:

### 1. **Modular Design**
Each major feature is isolated into its own module with clear boundaries. You can understand and modify one part without needing to know the entire system.

### 2. **Event-Driven Architecture**
The bot responds to Discord events (messages, reactions, commands, etc.) through a centralized event handling system.

### 3. **Provider Abstraction**
AI providers (Google Gemini, NovelAI, OpenRouter) are abstracted behind a common interface, making it easy to swap or add providers.

### 4. **Centralized Tool Registry**
All tools (function calls, MCP servers, REST APIs) are registered in a single registry with feature flags and permissions.

### 5. **Type Safety First**
TypeScript with strict mode ensures compile-time safety and excellent developer experience.

### 6. **Database-Centric State**
PostgreSQL is the source of truth for all persistent state (configs, memories, users, etc.).

## High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         Discord API                         │
└────────────────┬────────────────────────────────────────────┘
                 │ (Events & Gateway)
                 │
┌────────────────▼─────────────────────────────────────────────┐
│                    Discord.js Client                         │
│                     (src/index.ts)                           │
└────────────┬──────────────────────────┬──────────────────────┘
             │                          │
             │ Events                   │ Commands
             │                          │
┌────────────▼─────────────┐  ┌─────────▼───────────────┐
│    Event Handler         │  │   Command Handler       │
│  (src/handlers/)         │  │  (src/events/           │
│                          │  │   interactionCreate/)   │
└────────┬─────────────────┘  └─────────┬───────────────┘
         │                              │
         │ Dispatches                   │ Executes
         │                              │
┌────────▼──────────────┐    ┌──────────▼─────────────────┐
│  Event Handlers       │    │  Command Modules           │
│  (src/events/*/       │    │  (src/commands/*/          │
│   - messageCreate     │    │   - /config                │
│   - clientReady       │    │   - /teach                 │
│   - guildCreate       │    │   - /forget                │
│   - etc...)           │    │   - /persona               │
└───────┬───────────────┘    └──────────┬─────────────────┘
        │                               │
        │ Calls AI for chat             │ Updates DB
        │                               │
┌───────▼────────────────────────────────▼──────────────────┐
│              AI Provider Layer                            │
│  - Google Provider (src/providers/google/)                │
│  - NovelAI Provider (src/providers/novelai/)              │
│  - OpenRouter Provider (src/providers/openrouter/)        │
│  - Stream Adapters, Tool Adapters                         │
└───────┬───────────────────────────────┬───────────────────┘
        │                               │
        │ Uses Tools                    │ Queries State
        │                               │
┌───────▼──────────────────┐   ┌────────▼──────────────────┐
│   Tool Registry          │   │   PostgreSQL Database     │
│   (src/tools/)           │   │   (src/db/)               │
│   - Function Calls       │   │   - servers               │
│   - MCP Servers          │   │   - users                 │
│   - REST APIs            │   │   - tomoris               │
│   - Feature Flags        │   │   - configs               │
└──────────────────────────┘   │   - memories              │
                               │   - presets               │
                               └───────────────────────────┘
```

## Directory Structure & Responsibilities

```
src/
├── index.ts                    # Entry point - initializes everything
├── handlers/                   # Core request/event routing
│   └── eventHandler.ts         # Maps Discord events to handlers
├── events/                     # Event-specific handlers
│   ├── messageCreate/          # Handle incoming messages
│   ├── interactionCreate/      # Handle slash commands
│   ├── clientReady/            # Bot initialization tasks
│   ├── guildCreate/            # New server setup
│   └── ...                     # Other Discord events
├── commands/                   # Slash command definitions
│   ├── config/                 # Configuration commands
│   ├── teach/                  # Memory teaching commands
│   ├── forget/                 # Memory deletion commands
│   ├── persona/                # Personality management
│   └── ...                     # 14 command categories total
├── providers/                  # AI provider implementations
│   ├── google/                 # Google Gemini integration
│   │   ├── googleProvider.ts   # Main provider class
│   │   ├── googleStreamAdapter.ts   # Streaming responses
│   │   └── googleToolAdapter.ts     # Tool/function calling
│   ├── novelai/                # NovelAI integration
│   │   ├── novelaiProvider.ts
│   │   ├── novelaiStreamAdapter.ts
│   │   └── novelaiToolAdapter.ts
│   ├── openrouter/             # OpenRouter integration
│   │   ├── openrouterProvider.ts
│   │   ├── openrouterStreamAdapter.ts
│   │   └── openrouterToolAdapter.ts
│   └── utils/                  # Shared provider utilities
│       └── structuredOutput.ts # Structured output helpers
├── tools/                      # Tool system (function calls & integrations)
│   ├── toolRegistry.ts         # Central tool registration
│   ├── toolInitializer.ts      # Auto-discovery & registration
│   ├── functionCalls/          # Built-in function tools
│   │   ├── memoryTool.ts       # Self-teaching memories
│   │   ├── reminderTool.ts     # Set/manage reminders
│   │   ├── stickerTool.ts      # Send stickers
│   │   ├── generateImageTool.ts # Image generation
│   │   ├── pinMessageTool.ts   # Pin messages
│   │   └── ...                 # 10 built-in tools total
│   ├── mcpServers/             # Model Context Protocol servers
│   │   ├── brave-search/       # Brave web search
│   │   ├── duckduckgo-search/  # DuckDuckGo search
│   │   └── fetch/              # Generic URL fetching
│   └── restAPIs/               # Direct REST API integrations
│       └── brave/              # Brave Search REST API
├── utils/                      # Shared utilities
│   ├── db/                     # Database helpers
│   ├── discord/                # Discord-specific utilities
│   ├── text/                   # Text processing (i18n, parsing)
│   ├── security/               # Encryption, key management
│   ├── cache/                  # In-memory caching
│   ├── image/                  # Image processing (avatars, GIFs)
│   ├── media/                  # Media handling (YouTube, etc.)
│   ├── provider/               # Provider utilities
│   ├── tools/                  # Tool utilities
│   └── misc/                   # Logging, I/O, etc.
├── timers/                     # Background timers & scheduled tasks
│   ├── memoryMonitor.ts        # Memory usage monitoring
│   └── reminderTimer.ts        # Reminder polling system
├── db/                         # Database schema & seed data
│   ├── schema.sql              # Table definitions, migrations
│   ├── seed.sql                # Default presets & data
│   └── img/                    # Preset avatar images
├── locales/                    # Internationalization
│   ├── en-US.ts                # English translations
│   └── ja.ts                   # Japanese translations
└── types/                      # TypeScript type definitions
    ├── discord/                # Discord-related types
    ├── provider/               # AI provider types
    ├── db/                     # Database types
    ├── tool/                   # Tool system types
    └── ...                     # Other type categories
```

## Core Architectural Patterns

### 1. Event-Driven Pattern

**File:** `src/handlers/eventHandler.ts`

TomoriBot uses an event-driven architecture to respond to Discord events:

```typescript
// Event mapping (simplified)
const eventFolderMap = {
  messageCreate: "messageCreate",      // User sends a message
  interactionCreate: "interactionCreate",  // User runs slash command
  clientReady: "clientReady",          // Bot finished initializing
  guildCreate: "guildCreate",          // Bot added to new server
  // ... more events
};

// For each event, attach listener that runs all handlers in folder
client.on(eventName, async (...args) => {
  for (const eventFile of eventFiles) {
    await eventFunction(client, ...args);
  }
});
```

**Key Benefits:**
- Easy to add new event handlers - just create a file in the right folder
- Handlers run in alphabetical order (you can prefix with numbers like `01_`, `02_`)
- Each handler is isolated and can be tested independently
- Multiple handlers can respond to the same event

### 2. Provider Abstraction Pattern

**Files:** `src/providers/google/`, `src/providers/novelai/`

Each AI provider implements a common interface:

```typescript
interface AIProvider {
  // Generate streaming response
  streamChatCompletion(messages, config): AsyncGenerator;

  // Generate non-streaming response
  generateChatCompletion(messages, config): Promise<Response>;

  // Get tool adapter for function calling
  getToolAdapter(): ToolAdapter;
}
```

**Components:**
- **Provider** (`googleProvider.ts`): Main class that talks to API
- **Stream Adapter** (`googleStreamAdapter.ts`): Converts API stream to Discord messages
- **Tool Adapter** (`googleToolAdapter.ts`): Handles function calling for tools

**Key Benefits:**
- Swap AI providers without changing core bot logic
- Add new providers by implementing the interface
- Provider-specific quirks are isolated

### 3. Tool Registry Pattern

**File:** `src/tools/toolRegistry.ts`

All tools (built-in, MCP, REST APIs) are registered in a centralized singleton:

```typescript
// Register a tool
ToolRegistry.registerTool({
  name: "set_reminder",
  description: "Set a reminder for later",
  category: "productivity",
  parameters: { /* JSON schema */ },
  execute: async (args, context) => { /* implementation */ },
  isAvailableFor: (provider) => true,
  requiresFeatureFlag: "reminder_tool_enabled"
});

// Get available tools for a provider
const tools = ToolRegistry.getAvailableTools("google", context);

// Execute a tool
const result = await ToolRegistry.executeTool("set_reminder", args, context);
```

**Features:**
- **Feature Flags**: Control which tools are available per server/config
- **Permissions**: Check Discord permissions before execution
- **Execution History**: Track tool usage for debugging
- **MCP Integration**: Seamlessly mix built-in tools with MCP server tools
- **Provider Filtering**: Tools can specify which providers support them

### 4. Command Structure Pattern

**Files:** `src/commands/*/*`

Commands are organized hierarchically by category:

```
commands/
├── config/
│   ├── setup.ts          → /config setup
│   ├── rename.ts         → /config rename
│   ├── apikey/
│   │   ├── set.ts        → /config apikey set
│   │   └── delete.ts     → /config apikey delete
│   └── braveapi/
│       ├── set.ts        → /config braveapi set
│       └── delete.ts     → /config braveapi delete
```

Each command file exports:
```typescript
export default {
  data: new SlashCommandSubcommandBuilder()
    .setName("setup")
    .setDescription("Initial bot setup")
    .setNameLocalizations({ ja: "セットアップ" })
    .setDescriptionLocalizations({ ja: "初期ボット設定" }),

  async execute(interaction, t) {
    // Command implementation
  }
};
```

**Auto-Registration:** On startup, `src/events/clientReady/01_registercommands.ts` scans all command files and registers them with Discord.

### 5. Database Migration Pattern

**File:** `src/db/schema.sql`

TomoriBot uses **idempotent migrations** - the schema file can run multiple times safely:

```sql
-- Helper function for adding columns
CREATE OR REPLACE FUNCTION add_column_if_not_exists(
    _table TEXT,
    _column TEXT,
    _datatype TEXT
) RETURNS VOID AS $$
  -- Only adds column if it doesn't already exist
$$;

-- Create table (idempotent)
CREATE TABLE IF NOT EXISTS servers (...);

-- Add new column (migration, also idempotent)
SELECT add_column_if_not_exists('servers', 'is_dm_channel', 'BOOLEAN', 'false');
```

**Benefits:**
- No separate migration tracking system needed
- Schema file is always the source of truth
- Safe to run on every startup
- Easy to add new columns/features

### 6. Streaming Response Pattern

**Files:** `src/providers/*/streamAdapter.ts`, `src/utils/discord/StreamOrchestrator.ts`

TomoriBot streams AI responses in real-time:

```
AI Provider → Stream Adapter → StreamOrchestrator → Discord Message
    ↓              ↓                  ↓                      ↓
  Chunks    Convert to text    Buffer & manage      Edit message
                               chunks              every ~500ms
```

**StreamOrchestrator** handles:
- Buffering text chunks
- Detecting code blocks (to avoid breaking formatting)
- Simulating "typing" indicator
- Editing Discord message incrementally
- Timeout handling (2 min inactivity limit)

### 7. Localization Pattern

**Files:** `src/locales/en-US.ts`, `src/locales/ja.ts`, `src/utils/text/localizer.ts`

All user-facing text is localized:

```typescript
// In locale file
export default {
  "commands.config.setup.success": "Bot setup completed!",
  "commands.config.setup.already": "Bot is already set up!"
};

// In command code
const t = await getTranslator(userPreferredLanguage);
await interaction.reply(t("commands.config.setup.success"));
```

**Key Features:**
- User-level language preference
- Fallback to English if translation missing
- Support for placeholders: `t("message.count", { count: 5 })`
- Command names and descriptions are localized

### 8. Security & Encryption Pattern

**Files:** `src/utils/security/keyManager.ts`, `src/utils/security/encryptedData.ts`

API keys and sensitive data are encrypted using libsodium:

```typescript
// Storing an API key
const encrypted = encryptData(apiKey, serverId);
await sql`INSERT INTO llm_configurations (api_key) VALUES (${encrypted})`;

// Retrieving an API key
const row = await sql`SELECT api_key FROM llm_configurations WHERE ...`;
const apiKey = decryptData(row.api_key, serverId);
```

**Key Versioning:**
- Each server has a key version (defaults to V1)
- Key manager supports multiple versions simultaneously
- Enables zero-downtime key rotation
- Audit trail for key usage

## Data Flow Examples

### Example 1: User Sends a Message

```
1. User: "tomori hello!"
   ↓
2. Discord fires "messageCreate" event
   ↓
3. eventHandler.ts routes to src/events/messageCreate/tomoriChat.ts
   ↓
4. tomoriChat.ts checks:
   - Is trigger word present? ("tomori")
   - Is user blacklisted?
   - Is bot already responding?
   ↓
5. Load context from database:
   - Server config (model, temperature, etc.)
   - User nickname, language preference
   - Personal & server memories
   - Active persona
   ↓
6. Build AI prompt with:
   - System instructions (personality, behavior)
   - Tool definitions (available tools)
   - Conversation history
   ↓
7. Call AI provider (e.g., Google Gemini):
   provider.streamChatCompletion(messages, config)
   ↓
8. StreamOrchestrator receives chunks:
   - Buffers text
   - Detects tool calls
   - Edits Discord message every ~500ms
   ↓
9. If tool call detected:
   - Execute tool via ToolRegistry
   - Send result back to AI
   - AI continues generating response
   ↓
10. Response complete:
    - Save conversation to memory (if enabled)
    - Log to database
    - Clean up typing indicators
```

### Example 2: User Runs /teach Command

```
1. User: /teach memory personal input:"Tomori, I like pizza"
   ↓
2. Discord fires "interactionCreate" event
   ↓
3. eventHandler routes to src/events/interactionCreate/handleCommands.ts
   ↓
4. handleCommands.ts:
   - Parses command: "teach > memory > personal"
   - Loads command module: src/commands/teach/memory/personal.ts
   - Calls execute(interaction, translator)
   ↓
5. personal.ts:
   - Validates input (not too long, not empty)
   - Loads server config to get API key
   - Calls AI provider to extract structured memory:
     Input: "I like pizza"
     Output: { subject: "User", attribute: "food preference", value: "likes pizza" }
   ↓
6. Store in database:
   INSERT INTO memories (server_id, user_id, memory_text, ...)
   ↓
7. Reply to user:
   "✅ Personal memory added successfully!"
```

## Initialization Sequence

When TomoriBot starts (`bun run dev`), here's what happens (from `src/index.ts`):

```
1. Load environment variables (.env)
   ↓
2. Initialize encryption key manager
   - Load or generate CRYPTO_SECRET
   - Set up key versioning
   ↓
3. Connect to PostgreSQL
   - Build connection URL from env vars
   - Test connection
   ↓
4. Run database migrations
   - Execute src/db/schema.sql (idempotent)
   - Execute src/db/seed.sql (default presets)
   ↓
5. Clean up expired cooldowns
   - Delete old rate limit entries
   - Attempt to set up pg_cron (optional)
   ↓
6. Initialize tool registry
   - Scan src/tools/functionCalls/
   - Register all tools
   ↓
7. Initialize localization
   - Load en-US.ts and ja.ts
   - Build translation maps
   ↓
8. Initialize caches
   - LLM configuration cache
   - Preset avatar cache
   ↓
9. Set up event listeners
   - Call eventHandler(client)
   - Map all Discord events to handlers
   ↓
10. Login to Discord
    - client.login(process.env.DISCORD_TOKEN)
    ↓
11. On "clientReady" event:
    - Register slash commands with Discord
    - Register MCP servers
    - Initialize command registry
    - Start reminder polling system
    - Start memory monitoring system
    - Initialize upload quota cleanup
    - Log "TomoriBot is now online!"
```

## Design Decisions & Rationale

### Why Bun Instead of Node.js?
- **Faster startup**: Development hot-reload is nearly instant
- **Built-in SQL**: `bun:sql` provides type-safe PostgreSQL queries
- **Modern runtime**: Native TypeScript support, faster than Node.js

### Why PostgreSQL Instead of MongoDB/SQLite?
- **ACID compliance**: Critical for financial/user data
- **Advanced features**: pg_cron for scheduled tasks, full-text search
- **Scalability**: Can handle millions of memories/messages
- **Encryption**: libsodium integration for encrypted columns

### Why Provider Abstraction?
- **Flexibility**: Switch between Gemini (free), NovelAI (paid), and OpenRouter (multi-model) easily
- **Testing**: Mock providers for unit tests
- **Multi-model Access**: OpenRouter provides access to GPT, Claude, and other models through a single API
- **Future-proof**: Easy to add more providers as needed

### Why Tool Registry Instead of Hardcoded Tools?
- **Modularity**: Add new tools without modifying core code
- **Feature Flags**: Enable/disable tools per server
- **MCP Support**: Seamlessly integrate external tool servers
- **Debugging**: Centralized execution history and logging

### Why Idempotent Migrations?
- **Simplicity**: No migration tracking database needed
- **Reliability**: Safe to run multiple times
- **Development**: Easier to iterate on schema changes

## Next Steps

Now that you understand the architecture:

1. **Read "Entry Point & Initialization"** (document 4) for a line-by-line walkthrough of `index.ts`
2. **Explore "Database Schema"** (document 5) to understand the data model
3. **Study specific systems** (documents 6-13) based on what you're working on

Understanding this architecture is key to working effectively with TomoriBot. Everything follows these patterns!
