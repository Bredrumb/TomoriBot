# 11. Utils & Helpers

This document catalogs TomoriBot's utility functions and helper modules.

## Overview

The `src/utils/` directory contains reusable helper functions organized by category.

```
utils/
├── db/              # Database operations
├── discord/         # Discord-specific helpers
├── text/            # Text processing
├── security/        # Encryption & key management
├── cache/           # In-memory caching
├── image/           # Image processing
├── media/           # Media handling
├── provider/        # AI provider utilities
├── tools/           # Tool system helpers
├── mcp/             # MCP server management
└── misc/            # Logging, I/O, etc.
```

## Database Utils (`utils/db/`)

### `dbRead.ts` - Database Queries

**Purpose:** Read operations from database.

**Key Functions:**

```typescript
// Load complete server state
async function loadTomoriState(serverId: string): Promise<TomoriState | null>

// Load user data
async function loadUserRow(userDiscId: string): Promise<UserRow>

// Load server configuration
async function loadServerConfig(serverId: number): Promise<TomoriConfig>

// Load memories
async function loadServerMemories(serverId: number): Promise<string[]>
async function loadPersonalMemories(userId: number): Promise<string[]>

// Load emojis/stickers
async function loadServerEmojis(serverId: number): Promise<ServerEmoji[]>
async function loadServerStickers(serverId: number): Promise<ServerSticker[]>

// Load presets
async function loadAllPresets(): Promise<PresetRow[]>
async function loadPresetByName(name: string): Promise<PresetRow | null>

// Blacklist check
async function isBlacklisted(serverId: number, userDiscId: string): Promise<boolean>
```

### `dbWrite.ts` - Database Mutations

**Purpose:** Write operations to database.

**Key Functions:**

```typescript
// Server setup
async function setupServer(config: SetupConfig): Promise<void>

// Memory creation
async function createServerMemory(serverId: number, userId: number, content: string): Promise<void>
async function createPersonalMemory(userId: number, content: string): Promise<void>

// Memory deletion
async function deleteServerMemory(serverId: number, memoryId: number): Promise<void>
async function deletePersonalMemory(userId: number, memoryId: number): Promise<void>

// Configuration updates
async function updateServerConfig(serverId: number, updates: Partial<TomoriConfig>): Promise<void>

// User updates
async function updateUserNickname(userId: number, nickname: string): Promise<void>
async function updateUserLanguage(userId: number, language: string): Promise<void>

// Counter increment
async function incrementTomoriCounter(tomoriId: number): Promise<number>
```

### `cooldownsCleanup.ts` - Cooldown Management

**Purpose:** Clean up expired cooldowns.

```typescript
async function cleanupExpiredCooldowns(): Promise<{ success: boolean; deletedCount: number; error?: string }>
```

## Discord Utils (`utils/discord/`)

### `embedHelper.ts` - Embed Creation

**Purpose:** Create rich Discord embeds.

```typescript
// Create standard embed
function createStandardEmbed(options: {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: string;
  thumbnail?: string;
  image?: string;
}): EmbedBuilder

// Send embed
async function sendStandardEmbed(
  channel: TextChannel,
  embedOptions: EmbedOptions
): Promise<Message>
```

### `interactionHelper.ts` - Interaction Utilities

**Purpose:** Common interaction patterns.

```typescript
// Reply with embed
async function replyInfoEmbed(
  interaction: ChatInputCommandInteraction,
  title: string,
  description: string
): Promise<void>

// Reply with summary
async function replySummaryEmbed(
  interaction: ChatInputCommandInteraction,
  fields: Array<{ name: string; value: string }>
): Promise<void>

// Prompt with modal
async function promptWithRawModal(
  interaction: ChatInputCommandInteraction,
  title: string,
  fields: ModalField[]
): Promise<ModalSubmitInteraction>
```

### `StreamOrchestrator.ts` - Streaming Manager

**Purpose:** Handle real-time AI response streaming.

See document 10 (Streaming & Response System) for details.

### `permissionHelper.ts` - Permission Checks

**Purpose:** Validate Discord permissions.

```typescript
function hasManageGuildPermission(member: GuildMember): boolean
function hasSendMessagesPermission(channel: TextChannel, clientUser: User): boolean
function hasManageMessagesPermission(channel: TextChannel, clientUser: User): boolean
```

## Text Utils (`utils/text/`)

### `localizer.ts` - Internationalization

**Purpose:** Multi-language support.

```typescript
// Get translated string
function localizer(locale: string, key: string, vars?: Record<string, any>): string

// Initialize localizer (loads all locales)
async function initializeLocalizer(): Promise<void>

// Get supported locales
function getSupportedLocales(): string[] // ["en-US", "ja"]

// Get default bot name
function getDefaultBotName(locale: string): string
```

**Usage:**
```typescript
const t = (key: string) => localizer(userLocale, key);
await interaction.reply(t("commands.config.success"));
```

### `contextBuilder.ts` - AI Context Builder

**Purpose:** Build conversation context for AI.

```typescript
async function buildContext(
  state: TomoriState,
  messageHistory: Message[],
  availableTools: Tool[]
): Promise<{
  messages: AIMessage[];
  systemPrompt: string;
  tools: ToolDefinition[];
}>
```

Includes:
- Personality (from presets/attributes)
- Memories (server + personal)
- Message history
- Tool definitions
- Current date/time
- Server info

### `humanizer.ts` - Response Humanization

**Purpose:** Make AI responses more natural.

```typescript
async function humanizeResponse(
  text: string,
  degree: number // 0-3
): Promise<string>
```

### `youTubeUrlCleaner.ts` - YouTube URL Processing

**Purpose:** Extract and clean YouTube video IDs.

```typescript
function extractYouTubeVideoIds(text: string): string[]
function removeYouTubeUrls(text: string): string
```

### `emojiHelper.ts` - Emoji Detection & Manipulation

**Purpose:** Detect, extract, and filter emojis from text.

```typescript
// Count all emojis (Unicode + custom server emojis)
function countEmojis(text: string): number

// Extract unique emojis
function extractEmojis(text: string): string[]

// Extract only custom server emojis (:name: format)
function extractCustomEmojis(text: string): string[]

// Check for consecutive emoji repetition
function hasConsecutiveEmoji(text: string, emoji: string, threshold?: number): boolean

// Filter out specific custom emojis from text
function filterCustomEmojis(text: string, emojisToRemove: Set<string>): string
```

**Regex Patterns:**
- **All emojis:** Unicode emojis, skin tones, ZWJ sequences, custom `:name:`, emoticons (`:)`, `<3`)
- **Custom only:** `/:[a-zA-Z0-9_]+:/g` - Matches Discord server emojis in normalized format

### `emojiPenalty.ts` - Emoji Repetition Control

**Purpose:** Prevent excessive custom emoji usage through a two-layer system.

#### Layer 1: Frequency Penalty (Guidance)

Analyzes recent bot messages and injects LLM guidance when custom emoji usage exceeds threshold.

```typescript
// Check if penalty should be applied
function shouldApplyEmojiPenalty(
  contextItems: StructuredContextItem[],
  config?: EmojiPenaltyConfig
): boolean

// Generate penalty message to inject into context
function generateEmojiPenaltyMessage(botName: string): StructuredContextItem

// Main function - checks and applies penalty if needed
function applyEmojiPenaltyIfNeeded(
  contextItems: StructuredContextItem[],
  botName: string
): StructuredContextItem[]
```

**How it works:**
1. Scans last N bot messages in dialogue history
2. Counts **custom server emojis only** (ignores Unicode 😊, 👍)
3. If total > threshold, injects guidance message to LLM
4. LLM sees: *"[System: {bot} has been using emojis too frequently..."*

**Environment Variables:**
```bash
EMOJI_PENALTY_ENABLED=true        # Enable/disable (default: true)
EMOJI_PENALTY_LOOKBACK=3          # Messages to check (default: 3)
EMOJI_PENALTY_THRESHOLD=1         # Max custom emojis allowed (default: 1)
```

**Example:**
```
Last 3 messages: :ZoningOut:, :ZoningOut:, :ZoningOut:
Total: 3 custom emojis > 1 threshold → Penalty triggered ✅
```

#### Layer 2: Unique Emoji Enforcement (Hard Filter)

Post-generation filtering that removes duplicate custom emojis.

```typescript
// Get set of custom emojis used in recent messages
function getRecentlyUsedCustomEmojis(
  contextItems: StructuredContextItem[],
  config?: UniqueEmojiConfig
): Set<string>

// Filter duplicates from generated text
function filterDuplicateCustomEmojis(
  generatedText: string,
  contextItems: StructuredContextItem[]
): string
```

**How it works:**
1. Tracks custom emojis used in last N bot messages
2. After LLM generates response, scans for duplicates
3. Removes any custom emoji already used recently
4. Filters happen **before** Discord transformation (`:name:` → `<:name:ID>`)

**Environment Variables:**
```bash
EMOJI_UNIQUE_ENABLED=true         # Enable/disable (default: true)
EMOJI_UNIQUE_LOOKBACK=6           # Messages to track (default: 6)
```

**Example:**
```
Recent messages used: :ZoningOut:, :pepehands:
Generated: "Hello :ZoningOut: how are you?"
Filtered:  "Hello how are you?" ✅
```

**Integration Points:**
- **Frequency Penalty:** Applied in `tomoriChat.ts` after `buildContext()`
- **Unique Filter:** Applied in `StreamOrchestrator.sendBufferSegment()` before Discord send

**Why Two Layers?**
1. **Guidance (Layer 1):** Proactively prevents LLM from using emojis
2. **Filter (Layer 2):** Catches duplicates if LLM ignores guidance
3. **Custom only:** Doesn't restrict natural Unicode emoji usage (personality-friendly)

## Security Utils (`utils/security/`)

### `keyManager.ts` - Encryption Key Management

**Purpose:** Manage encryption keys with versioning.

```typescript
class KeyManager {
  // Get current key version
  getCurrentKeyVersion(): number

  // Get key by version
  getKey(version: number): Buffer

  // Get rotation status
  getRotationStatus(): {
    currentVersion: number;
    availableVersions: number[];
    rotationCapable: boolean;
  }
}

export const keyManager = new KeyManager(); // Singleton
```

### `crypto.ts` - Encryption/Decryption

**Purpose:** Encrypt/decrypt sensitive data.

```typescript
// Encrypt data
function encryptData(
  plaintext: string,
  contextId: string,
  keyVersion?: number
): Buffer

// Decrypt data
function decryptData(
  encrypted: Buffer,
  contextId: string,
  keyVersion?: number
): string

// API key specific helpers
function encryptApiKey(apiKey: string, serverId: number): Buffer
function decryptApiKey(encrypted: Buffer, serverId: number, keyVersion: number): string
```

Uses **libsodium** (XSalsa20-Poly1305) for authenticated encryption.

## Cache Utils (`utils/cache/`)

### `llmCache.ts` - LLM Configuration Cache

**Purpose:** Cache server configs to reduce DB queries.

```typescript
async function initializeLLMCache(): Promise<void>
async function getCachedConfig(serverId: number): Promise<TomoriConfig | null>
async function invalidateCache(serverId: number): Promise<void>
```

### `commandRegistry.ts` - Command Cache

**Purpose:** Map command paths to execute functions.

```typescript
function registerCommand(path: string[], executeFunction: CommandExecute): void
function getCommand(path: string[]): CommandExecute | undefined
```

## Image Utils (`utils/image/`)

### `avatarHelper.ts` - Avatar Processing

**Purpose:** Process and cache preset avatars.

```typescript
async function initializePresetAvatarCache(presets: PresetRow[]): Promise<void>
async function getPresetAvatar(presetName: string): Promise<string | null> // Base64
async function processAvatarImage(imagePath: string): Promise<string> // Convert to Base64
```

### `imageProcessor.ts` - Image Manipulation

**Purpose:** Resize, convert, and optimize images.

```typescript
async function resizeImage(buffer: Buffer, width: number, height: number): Promise<Buffer>
async function convertToFormat(buffer: Buffer, format: "png" | "jpg" | "webp"): Promise<Buffer>
```

Uses **sharp** for image processing.

## Media Utils (`utils/media/`)

### `videoHelper.ts` - Video Processing

**Purpose:** Extract frames from videos/GIFs.

```typescript
async function extractGifFrames(url: string, maxFrames: number): Promise<Buffer[]>
async function extractVideoThumbnail(url: string): Promise<Buffer>
```

### `youTubeHelper.ts` - YouTube Info

**Purpose:** Fetch YouTube video metadata.

```typescript
async function getYouTubeVideoInfo(videoId: string): Promise<{
  title: string;
  description: string;
  duration: number;
  viewCount: number;
  channelName: string;
}>
```

## Provider Utils (`utils/provider/`)

### `providerFactory.ts` - Provider Instantiation

**Purpose:** Create AI provider instances.

```typescript
async function getProviderForTomori(state: TomoriState): Promise<LLMProvider>

class ProviderFactory {
  static async createProvider(
    provider: string,
    apiKey: string,
    model: string
  ): Promise<LLMProvider>
}
```

## Tools Utils (`utils/tools/`)

### `featureFlagMapper.ts` - Feature Flag Mapping

**Purpose:** Map configs to feature flags.

```typescript
function configToFeatureFlags(config: TomoriConfig): Record<string, boolean>
function filterToolsByFeatureFlags(tools: string[], flags: Record<string, boolean>): string[]
```

## MCP Utils (`utils/mcp/`)

### `mcpManager.ts` - MCP Server Manager

**Purpose:** Manage Model Context Protocol servers.

```typescript
class MCPManager {
  async registerMCPServer(name: string, handler: MCPHandler): Promise<void>
  async getMCPTools(): Promise<MCPTool[]>
  isReady(): boolean
}

export function getMCPManager(): MCPManager // Singleton
```

## Misc Utils (`utils/misc/`)

### `logger.ts` - Logging System

**Purpose:** Colored console logging.

```typescript
const log = {
  info(message: string): void,
  success(message: string): void,
  warn(message: string): void,
  error(message: string, error?: Error): void,
  section(message: string): void, // Boxed header
};

enum ColorCode {
  Reset = "\x1b[0m",
  Red = "\x1b[31m",
  Green = "\x1b[32m",
  Yellow = "\x1b[33m",
  Blue = "\x1b[34m",
}
```

**Usage:**
```typescript
log.section("Starting Bot...");
log.success("Database connected!");
log.warn("API key not set");
log.error("Failed to load config", error);
```

### `ioHelper.ts` - File I/O

**Purpose:** File system operations.

```typescript
function getAllFiles(directory: string): string[] // Recursive file list
function readJsonFile<T>(path: string): T
function writeJsonFile<T>(path: string, data: T): void
```

## Common Patterns

### 1. Load State & Config

```typescript
const state = await loadTomoriState(serverId);
if (!state) {
  return; // Bot not set up
}

const config = state.config;
```

### 2. Localized Responses

```typescript
const user = await loadUserRow(interaction.user.id);
const t = (key: string) => localizer(user.language_pref, key);
await interaction.reply(t("commands.success"));
```

### 3. Error Logging

```typescript
try {
  await someOperation();
} catch (error) {
  log.error("Operation failed", error as Error);
  await interaction.reply("An error occurred!");
}
```

## Timers & Background Tasks

**Location:** `src/timers/`

### 1. Memory Monitor

**File:** `src/timers/memoryMonitor.ts`

**Purpose:** Monitor process memory usage and log warnings when memory usage is high.

```typescript
export function startMemoryMonitor() {
  setInterval(() => {
    const used = process.memoryUsage();
    const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);

    if (heapUsedMB > 500) {
      log.warn(`High memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB`);
    }
  }, 60000); // Check every minute
}
```

**Features:**
- Runs every 60 seconds
- Logs warnings when heap usage exceeds 500MB
- Helps identify memory leaks

### 2. Reminder Timer

**File:** `src/timers/reminderTimer.ts`

**Purpose:** Poll database for due reminders and send notifications.

```typescript
export function startReminderPolling() {
  setInterval(async () => {
    const dueReminders = await sql`
      SELECT * FROM reminders
      WHERE reminder_time <= NOW()
    `;

    for (const reminder of dueReminders) {
      await sendReminderNotification(reminder);
      await deleteReminder(reminder.reminder_id);
    }
  }, 60000); // Check every minute
}
```

**Features:**
- Polls every 60 seconds
- Finds reminders where `reminder_time <= NOW()`
- Sends Discord notification to user
- Deletes reminder after sending

**Why Polling Instead of Cron?**
- Simpler deployment (no external dependencies)
- Works on all platforms (Windows, Linux, macOS)
- Easy to test and debug
- Minimal overhead (only runs when reminders exist)

## Next Steps

Read document 12 (Localization System) to understand multi-language support!
