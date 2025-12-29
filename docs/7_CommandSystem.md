# 7. Command System

This document explains how TomoriBot's slash command system works.

## Overview

TomoriBot uses Discord's **slash commands** (application commands) organized in a hierarchical structure.

**Total Commands:** 60+ subcommands across 15 categories

## Command Structure

### Hierarchy

```
/command-group subcommand [options]
```

Examples:
```
/config setup
/config apikey set provider:google key:abc123
/teach memory personal input:"I love pizza"
/persona create
```

### File Organization

Commands are organized by category in folders:

```
commands/
├── config/               # /config
│   ├── setup.ts          # /config setup
│   ├── rename.ts         # /config rename
│   ├── temperature.ts    # /config temperature
│   ├── model.ts          # /config model
│   ├── apikey/
│   │   ├── set.ts        # /config apikey set
│   │   └── delete.ts     # /config apikey delete
│   └── braveapi/
│       ├── set.ts        # /config braveapi set
│       └── delete.ts     # /config braveapi delete
├── teach/                # /teach
│   ├── attribute.ts
│   ├── sampledialogue.ts
│   └── memory/
│       ├── personal.ts   # /teach memory personal
│       └── server.ts     # /teach memory server
├── forget/               # /forget
│   └── ...
├── persona/              # /persona
├── tool/                 # /tool (bot utilities)
├── help/                 # /help
└── ...
```

## Command File Structure

Every command file exports:

```typescript
export const configureSubcommand = (subcommand) => {
  return subcommand
    .setName("setup")
    .setDescription("Initial bot setup")
    .setNameLocalizations({ ja: "セットアップ" })
    .setDescriptionLocalizations({ ja: "初期ボット設定" })
    .addStringOption(option =>
      option
        .setName("option_name")
        .setDescription("Option description")
        .setRequired(true)
    );
};

export async function execute(client, interaction, userData, locale) {
  // Command implementation
}
```

## Command Categories

### 1. `/config` - Bot Configuration

Configure bot settings for your server.

**Subcommands:**
- `setup` - Initial bot setup (required first)
- `rename` - Change bot's nickname
- `model` - Select AI model (text generation)
- `model image` - Select image generation model
- `temperature` - Adjust response randomness
- `timezone` - Set server timezone offset
- `permissions` - Toggle feature flags
- `humanizer` - Configure response humanization degree
- `prompt change` - Set custom system prompt (December 2025)
- `prompt clear` - Remove custom system prompt
- `prompt preset` - Apply preset system prompt
- `apikey set/delete` - Manage main API key
- `braveapi set/delete` - Manage Brave Search key

**Examples:**
```
/config temperature value:1.8
/config timezone offset:540     # JST (+9:00)
/config prompt change prompt:"Be very concise and direct"
```

**Location:** `src/commands/config/*`

### 2. `/teach` - Add Memories & Personality

Teach TomoriBot information.

**Subcommands:**
- `memory personal` - Add personal fact about user
- `memory server` - Add server-wide fact
- `attribute` - Add personality trait
- `sampledialogue` - Add example conversation

**Example:**
```
/teach memory personal input:"My favorite color is blue"
```

**Location:** `src/commands/teach/*`

### 3. `/forget` - Remove Memories

Delete previously taught information.

**Subcommands:**
- `memory personal` - Remove personal memory
- `memory server` - Remove server memory
- `attribute` - Remove personality trait
- `sampledialogue` - Remove sample dialogue

**Location:** `src/commands/forget/*`

### 4. `/persona` - Personality Management

Manage bot personalities/presets.

**Subcommands:**
- `create` - Create new persona from scratch
- `generate` - AI-generate persona from description
- `import` - Load preset persona
- `export` - Export current persona
- `default` - Reset to default preset

**Example:**
```
/persona import preset:Tsundere
```

**Location:** `src/commands/persona/*`

### 5. `/data` - Data Management

Export or delete user data (GDPR compliance).

**Subcommands:**
- `export` - Get all your data as JSON
- `import` - Import previously exported data
- `delete` - Delete all your data

**Location:** `src/commands/data/*`

### 6. `/personal` - User Preferences

Personal user settings (cross-server).

**Subcommands:**
- `nickname` - Set your nickname
- `language` - Set preferred language
- `privacy` - Opt out of data collection

**Location:** `src/commands/personal/*`

### 7. `/server` - Server Permissions

Server-level permission management.

**Subcommands:**
- `blacklist` - Block users from personalization
- `avatar` - Set server-specific avatar
- `trigger add/delete` - Manage trigger words
- `autotrigger channels` - Set auto-response channels
- `autotrigger threshold` - Set message count for auto-trigger
- `memberpermissions` - Configure member permissions

**Location:** `src/commands/server/*`

### 8. `/tool` - Bot Utilities

Bot management commands.

**Subcommands:**
- `ping` - Check bot latency
- `status` - View bot statistics
- `refresh` - Re-register slash commands

**Location:** `src/commands/tool/*`

### 9. `/help` - Documentation

In-Discord help.

**Subcommands:**
- `features` - Overview of features
- `setup` - Setup guide
- `apikey` - API key help
- `memory` - Memory system guide
- `customization` - Customization options
- `data` - Data management help

**Location:** `src/commands/help/*`

### 10. `/bot` - Direct Bot Actions

Direct actions for bot (manager-only).

**Subcommands:**
- `respond` - Force bot to respond in channel
- `reason` - Show reasoning for last response

**Location:** `src/commands/bot/*`

### 11. `/contribute` - GitHub Contribution

Link to GitHub repository for contributions.

**Subcommand:**
- `github` - Show GitHub repository link and contribution guidelines

**Example:**
```
/contribute github
```

**Location:** `src/commands/contribute/*`

### 12. `/donate` - Support Development

Link to Ko-fi for donations.

**Subcommand:**
- `kofi` - Show Ko-fi donation link

**Example:**
```
/donate kofi
```

**Location:** `src/commands/donate/*`

### 13. `/generate` - Content Generation

Generate images using AI diffusion models.

**Subcommand:**
- `image` - Generate image from text prompt or source image

**Example:**
```
/generate image prompt:"A sunset over mountains"
```

**Location:** `src/commands/generate/*`

### 14. `/legal` - Legal Information

Terms of service, privacy policy, and license information.

**Subcommands:**
- `terms` - Terms of Service
- `privacy` - Privacy Policy
- `license` - Software license

**Location:** `src/commands/legal/*`

### 15. `/support` - Support Links

Links to support resources and community.

**Location:** `src/commands/support/*`

## Command Registration

Commands are registered automatically on bot startup.

**File:** `src/events/clientReady/01_registercommands.ts`

**Process:**
1. Scan all `src/commands/` folders
2. Load command modules
3. Build SlashCommandBuilder for each category
4. Register with Discord API

**Command Tree Example:**

```typescript
const configCommand = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Configure TomoriBot")
  .addSubcommand(subcommand => configureSubcommand(subcommand)) // setup.ts
  .addSubcommand(subcommand => configureSubcommand(subcommand)) // rename.ts
  .addSubcommandGroup(group =>
    group
      .setName("apikey")
      .setDescription("Manage API key")
      .addSubcommand(...) // set.ts
      .addSubcommand(...) // delete.ts
  );
```

## Command Execution Flow

```
1. User runs /config setup
   ↓
2. Discord fires interactionCreate event
   ↓
3. handleCommands.ts receives interaction
   ↓
4. Parse command path: ["config", "setup"]
   ↓
5. Load module: src/commands/config/setup.ts
   ↓
6. Check permissions (guild-only, manager-only)
   ↓
7. Apply cooldown (rate limiting)
   ↓
8. Call execute(client, interaction, userData, locale)
   ↓
9. Command updates database, replies to user
```

## Creating a New Command

### Step 1: Choose Location

Determine category and create file:

```bash
# For /config newfeature
touch src/commands/config/newfeature.ts

# For /config group subcommand
mkdir -p src/commands/config/group
touch src/commands/config/group/subcommand.ts
```

### Step 2: Implement Command

```typescript
import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import type { UserRow } from "../../types/db/schema";
import { localizer } from "../../utils/text/localizer";
import { log } from "../../utils/misc/logger";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("newfeature")
    .setDescription("Description of new feature")
    .setNameLocalizations({ ja: "新機能" })
    .setDescriptionLocalizations({ ja: "新機能の説明" })
    .addStringOption(option =>
      option
        .setName("input")
        .setDescription("Input value")
        .setRequired(true)
    );

export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string
): Promise<void> {
  try {
    const input = interaction.options.getString("input", true);

    // Your logic here

    await interaction.reply({
      content: localizer(userData.language_pref, "commands.newfeature.success"),
      ephemeral: true
    });
  } catch (error) {
    log.error("Command failed", error as Error);
    await interaction.reply({
      content: "An error occurred!",
      ephemeral: true
    });
  }
}
```

### Step 3: Add Localization

Edit `src/locales/en-US.ts`:

```typescript
export default {
  // ... existing keys
  "commands.newfeature.success": "Feature configured successfully!",
  "commands.newfeature.error": "Failed to configure feature.",
};
```

### Step 4: Restart & Test

1. Restart bot: `bun run dev`
2. Commands auto-register on startup
3. Test in Discord: `/config newfeature`

If commands don't appear:
```
/tool refresh
```

## Command Options

### String Option

```typescript
.addStringOption(option =>
  option
    .setName("text")
    .setDescription("Enter text")
    .setRequired(true)
    .setMaxLength(100)
)
```

### Integer Option

```typescript
.addIntegerOption(option =>
  option
    .setName("count")
    .setDescription("Enter number")
    .setMinValue(1)
    .setMaxValue(10)
)
```

### Boolean Option

```typescript
.addBooleanOption(option =>
  option
    .setName("enabled")
    .setDescription("Enable feature?")
)
```

### Choice Option

```typescript
.addStringOption(option =>
  option
    .setName("provider")
    .setDescription("Select AI provider")
    .setRequired(true)
    .addChoices(
      { name: "Google Gemini", value: "google" },
      { name: "NovelAI", value: "novelai" }
    )
)
```

## Permission Checks

### Guild-Only Commands

```typescript
if (!interaction.guild) {
  await interaction.reply({
    content: "This command only works in servers!",
    ephemeral: true
  });
  return;
}
```

### Manager-Only Commands

```typescript
if (!interaction.memberPermissions?.has("ManageGuild")) {
  await interaction.reply({
    content: "You need Manage Server permission!",
    ephemeral: true
  });
  return;
}
```

## Cooldowns

Implemented in `handleCommands.ts`:

```typescript
const cooldownKey = `${interaction.user.id}:${commandCategory}`;
const cooldownMs = 3000; // 3 seconds

// Check if user is on cooldown
if (await isOnCooldown(cooldownKey)) {
  await interaction.reply({
    content: "You're using commands too quickly!",
    ephemeral: true
  });
  return;
}

// Set cooldown
await setCooldown(cooldownKey, cooldownMs);
```

## Next Steps

Read document 8 (AI Providers) to understand how commands interact with AI!
