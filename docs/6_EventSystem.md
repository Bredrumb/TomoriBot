# 6. Event System

This document explains how TomoriBot's event-driven architecture works.

## Overview

TomoriBot responds to Discord events using a **centralized event handler** that maps Discord events to handler modules.

**File:** `src/handlers/eventHandler.ts`

## How Events Work

### 1. Event Flow

```
Discord Event → eventHandler → Handler Folder → Handler Files → Execute
```

Example:
```
User sends "tomori hello"
  ↓
Discord fires "messageCreate" event
  ↓
eventHandler routes to src/events/messageCreate/
  ↓
Runs jpTrans.ts, then tomoriChat.ts (alphabetical order)
  ↓
Bot responds with AI message
```

### 2. Event Folder Mapping

Events are mapped in `eventHandler.ts`:

```typescript
const eventFolderMap = {
  messageCreate: "messageCreate",       // New message
  interactionCreate: "interactionCreate", // Slash command
  clientReady: "clientReady",           // Bot startup complete
  guildCreate: "guildCreate",           // Bot added to server
  guildMemberAdd: "guildMemberAdd",     // User joins server
  emojiCreate: "guildEmojisUpdate",     // Emoji added/updated/deleted
  emojiDelete: "guildEmojisUpdate",
  emojiUpdate: "guildEmojisUpdate",
  stickerCreate: "guildStickersUpdate", // Sticker added/updated/deleted
  stickerDelete: "guildStickersUpdate",
  stickerUpdate: "guildStickersUpdate",
  rateLimit: "rateLimit",                // Discord API rate limit hit
};
```

**Key Insight:** Multiple events can map to the same handler folder!

## Event Handlers

### Location: `src/events/`

```
events/
├── messageCreate/
│   ├── jpTrans.ts         # Japanese translation detection
│   └── tomoriChat.ts      # AI chat responses
├── interactionCreate/
│   └── handleCommands.ts  # Slash command execution
├── clientReady/
│   ├── 01_registercommands.ts  # Register slash commands
│   ├── 02_registerMCPs.ts      # Register MCP servers
│   ├── 03_initCommandRegistry.ts # Build command registry
│   └── status.ts                # Set bot status
├── guildCreate/
│   └── addBot.ts          # Initialize new server
├── guildMemberAdd/
│   └── newUser.ts         # Welcome new user
├── guildEmojisUpdate/
│   └── refreshEmojis.ts   # Update emoji cache
├── guildStickersUpdate/
│   └── refreshStickers.ts # Update sticker cache
└── rateLimit/
    └── rateLimitLogger.ts # Log Discord API rate limits
```

### Naming Convention

Files in event folders run in **alphabetical order**. Use number prefixes for ordering:
- `01_first.ts`
- `02_second.ts`
- `03_third.ts`

## Important Event Handlers

### 1. `messageCreate/tomoriChat.ts` - AI Chat Handler

**Purpose:** Main AI conversation handler.

**Trigger Detection:**
1. Check if message mentions bot
2. Check for trigger words (from config)
3. Check auto-trigger threshold
4. Check if user is blacklisted

**Process:**
1. Load server config, user data, memories
2. Build context for AI (personality, history, tools)
3. Stream AI response using provider
4. Handle tool calls during streaming
5. Save conversation if self-teaching enabled

**Location:** `src/events/messageCreate/tomoriChat.ts:1`

### 2. `interactionCreate/handleCommands.ts` - Slash Commands

**Purpose:** Execute slash commands.

**Process:**
1. Parse command path (e.g., "config > apikey > set")
2. Load command module from `src/commands/`
3. Validate permissions (guild-only, manager-only)
4. Apply cooldowns
5. Execute command
6. Log errors if any

**Location:** `src/events/interactionCreate/handleCommands.ts:1`

### 3. `clientReady/*.ts` - Initialization Handlers

**Purpose:** Tasks that run when bot is ready.

**Handlers:**
- `01_registercommands.ts`: Register/update slash commands
- `02_registerMCPs.ts`: Connect to MCP servers
- `03_initCommandRegistry.ts`: Build internal command map
- `status.ts`: Set Discord presence

**Why Numbered?** They must run in this order.

### 4. `guildCreate/addBot.ts` - New Server Setup

**Purpose:** Initialize data when bot joins new server.

**Actions:**
- Create server entry in database
- Set up default configuration
- Log join event

### 5. `guildEmojisUpdate/refreshEmojis.ts` - Emoji Sync

**Purpose:** Keep emoji database in sync with Discord.

**Triggers:** `emojiCreate`, `emojiDelete`, `emojiUpdate`

**Actions:**
- Fetch current emojis from Discord
- Update `server_emojis` table
- Categorize by emotion keys

## Creating a New Event Handler

### Step 1: Determine Event Name

See [Discord.js Events](https://discord.js.org/docs/packages/discord.js/main/Client:Class#Events) for available events.

Examples:
- `messageUpdate` - Message edited
- `messageReactionAdd` - Reaction added
- `voiceStateUpdate` - User joins/leaves voice

### Step 2: Create Handler Folder

```bash
mkdir -p src/events/messageReactionAdd
```

### Step 3: Add Event Mapping

Edit `src/handlers/eventHandler.ts`:

```typescript
const eventFolderMap = {
  // ... existing mappings
  messageReactionAdd: "messageReactionAdd",
};
```

### Step 4: Create Handler File

`src/events/messageReactionAdd/handleReaction.ts`:

```typescript
import type { Client, MessageReaction, User } from "discord.js";
import { log } from "../../utils/misc/logger";

/**
 * Handle message reactions
 */
export default async function handleReaction(
  client: Client,
  reaction: MessageReaction,
  user: User
): Promise<void> {
  try {
    log.info(`User ${user.tag} reacted with ${reaction.emoji.name}`);

    // Your handler logic here

  } catch (error) {
    log.error("Error handling reaction", error as Error);
  }
}
```

### Step 5: Restart Bot

Hot reload will pick up the new handler automatically in dev mode!

## Event Handler Best Practices

### 1. Error Handling

Always wrap in try/catch:
```typescript
export default async function handler(client, ...args) {
  try {
    // Your logic
  } catch (error) {
    log.error("Handler failed", error as Error);
  }
}
```

### 2. Early Returns

Check prerequisites early:
```typescript
if (!interaction.guild) {
  return; // DM not supported
}

if (message.author.bot) {
  return; // Ignore bots
}
```

### 3. Async Operations

Use `await` for database and API calls:
```typescript
const state = await loadTomoriState(serverId);
await sendReply(message, response);
```

### 4. Performance

Avoid heavy operations in event handlers:
```typescript
// Bad: Blocks event loop
const allMessages = await channel.messages.fetch({ limit: 1000 });

// Good: Fetch only what you need
const recentMessages = await channel.messages.fetch({ limit: 10 });
```

## Common Patterns

### Pattern 1: Load State from Database

```typescript
const tomoriState = await loadTomoriState(serverId);
if (!tomoriState) {
  await interaction.reply("Run /config setup first!");
  return;
}
```

### Pattern 2: Check Permissions

```typescript
if (!interaction.memberPermissions?.has("ManageGuild")) {
  await interaction.reply("You need Manage Server permission!");
  return;
}
```

### Pattern 3: Localization

```typescript
const user = await loadUserRow(interaction.user.id);
const t = (key: string) => localizer(user.language_pref, key);
await interaction.reply(t("commands.success"));
```

## Event Order Guarantees

Discord.js guarantees:
- Events fire in the order they occur
- Handlers within a folder run alphabetically
- `clientReady` always fires after connection

## Next Steps

Read document 7 (Command System) to understand slash command implementation!
