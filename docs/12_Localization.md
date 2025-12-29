# 12. Localization System (i18n)

This document explains how TomoriBot supports multiple languages.

## Overview

TomoriBot has built-in internationalization (i18n) supporting:
- **English** (en-US) - Default
- **Japanese** (ja) - Full translation

**Total Keys:** ~3000+ translation keys

## Architecture

```
┌─────────────────┐
│  Locale Files   │
│  - en-US.ts     │
│  - ja.ts        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Localizer     │  ←─── User Language Preference
│   (Runtime)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Translated Text │
└─────────────────┘
```

## Locale Files

### Location: `src/locales/`

```
locales/
├── en-US.ts    # English translations
└── ja.ts       # Japanese translations
```

### File Structure

Each locale file exports a key-value map:

```typescript
// src/locales/en-US.ts
export default {
  // General messages
  "general.welcome": "Welcome to TomoriBot!",
  "general.errors.not_found": "Not found",

  // Commands
  "commands.config.setup.description": "Initial bot setup",
  "commands.config.setup.success": "Setup completed successfully!",
  "commands.config.setup.already": "Bot is already set up!",

  // Errors
  "errors.permission_denied": "You don't have permission for this!",
  "errors.api_key_required": "Please set an API key first with /config apikey set",

  // ... 3000+ more keys
};
```

```typescript
// src/locales/ja.ts
export default {
  "general.welcome": "TomoriBotへようこそ！",
  "general.errors.not_found": "見つかりません",

  "commands.config.setup.description": "初期ボット設定",
  "commands.config.setup.success": "セットアップが完了しました！",
  "commands.config.setup.already": "ボットは既にセットアップされています！",

  "errors.permission_denied": "この操作の権限がありません！",
  "errors.api_key_required": "先に /config apikey set でAPIキーを設定してください",

  // ... 3000+ more keys
};
```

## Localizer API

**File:** `src/utils/text/localizer.ts`

### Get Translation

```typescript
function localizer(
  locale: string,
  key: string,
  variables?: Record<string, any>
): string
```

**Examples:**

```typescript
// Simple translation
localizer("en-US", "general.welcome")
// → "Welcome to TomoriBot!"

localizer("ja", "general.welcome")
// → "TomoriBotへようこそ！"

// With variables
localizer("en-US", "user.greeting", { name: "Alice" })
// → "Hello, Alice!"

localizer("ja", "user.greeting", { name: "アリス" })
// → "こんにちは、アリスさん！"
```

### Variable Substitution

Locale strings can contain placeholders:

```typescript
// en-US.ts
export default {
  "memory.count": "You have {count} memories",
  "reminder.scheduled": "Reminder set for {time} in {location}",
};

// Usage
localizer("en-US", "memory.count", { count: 5 })
// → "You have 5 memories"

localizer("en-US", "reminder.scheduled", {
  time: "2:00 PM",
  location: "Tokyo"
})
// → "Reminder set for 2:00 PM in Tokyo"
```

### Fallback Behavior

If a key doesn't exist in the requested locale, falls back to English:

```typescript
// Key exists in English but not Japanese
localizer("ja", "new.feature.description")
// → Returns English version as fallback
```

## User Language Preference

### Setting Language

Users can choose their preferred language:

```
/personal language preference:Japanese
```

This updates the `users` table:

```sql
UPDATE users
SET language_pref = 'ja'
WHERE user_disc_id = '123456789';
```

### Using Language Preference

All commands check user preference:

```typescript
export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow, // Contains language_pref
  locale: string
) {
  // Create translator function for this user
  const t = (key: string, vars?: Record<string, any>) =>
    localizer(userData.language_pref, key, vars);

  // Use in responses
  await interaction.reply(t("commands.config.success"));
}
```

## Command Localization

Discord supports localized command names and descriptions.

### Setting Command Localization

```typescript
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("setup")
    .setDescription("Initial bot setup")
    // Japanese localization
    .setNameLocalizations({ ja: "セットアップ" })
    .setDescriptionLocalizations({ ja: "初期ボット設定" })
    // Option localization
    .addStringOption(option =>
      option
        .setName("provider")
        .setDescription("AI provider to use")
        .setNameLocalizations({ ja: "プロバイダー" })
        .setDescriptionLocalizations({ ja: "使用するAIプロバイダー" })
    );
```

### How It Appears in Discord

**English User:**
```
/config setup provider:google
Description: Initial bot setup
```

**Japanese User:**
```
/config セットアップ プロバイダー:google
説明: 初期ボット設定
```

## AI Personality Localization

Bot personalities also localized in presets:

```typescript
// Default English Preset
{
  preset_name: "Default",
  preset_desc: "Friendly and helpful assistant",
  preset_language: "en-US",
  preset_attribute_list: [
    "Friendly and approachable",
    "Helpful and informative",
    "Uses casual but polite language"
  ]
}

// Default Japanese Preset
{
  preset_name: "デフォルト",
  preset_desc: "親しみやすく役立つアシスタント",
  preset_language: "ja",
  preset_attribute_list: [
    "フレンドリーで親しみやすい",
    "役立つ情報を提供する",
    "カジュアルだが丁寧な言葉遣い"
  ]
}
```

## Translation Key Naming Convention

Keys use dot notation for hierarchy:

```
category.subcategory.item
```

**Examples:**

```typescript
// General messages
"general.welcome"
"general.goodbye"
"general.errors.not_found"
"general.errors.permission_denied"

// Commands
"commands.config.setup.description"
"commands.config.setup.success"
"commands.config.setup.error"
"commands.teach.memory.description"

// Bot personality
"personality.friendly.greeting"
"personality.tsundere.greeting"

// Error messages
"errors.api.rate_limit"
"errors.db.connection_failed"
```

## Adding a New Locale

### Step 1: Create Locale File

```bash
touch src/locales/es.ts  # Spanish
```

### Step 2: Copy English Template

```typescript
// src/locales/es.ts
export default {
  "general.welcome": "¡Bienvenido a TomoriBot!",
  "general.errors.not_found": "No encontrado",

  "commands.config.setup.description": "Configuración inicial del bot",
  "commands.config.setup.success": "¡Configuración completada exitosamente!",

  // ... translate all keys
};
```

### Step 3: Register Locale

Edit `src/utils/text/localizer.ts`:

```typescript
const locales = {
  "en-US": await import("../../locales/en-US"),
  "ja": await import("../../locales/ja"),
  "es": await import("../../locales/es"), // Add new locale
};
```

### Step 4: Add to Language Choices

Edit commands that set language:

```typescript
.addStringOption(option =>
  option
    .setName("preference")
    .setDescription("Preferred language")
    .setRequired(true)
    .addChoices(
      { name: "English", value: "en" },
      { name: "日本語 (Japanese)", value: "ja" },
      { name: "Español (Spanish)", value: "es" } // New choice
    )
)
```

## Localization Best Practices

### 1. Always Use Keys, Never Hardcode

❌ **Bad:**
```typescript
await interaction.reply("Setup completed!");
```

✅ **Good:**
```typescript
await interaction.reply(t("commands.config.setup.success"));
```

### 2. Use Variables for Dynamic Content

❌ **Bad:**
```typescript
export default {
  "memory.count.1": "You have 1 memory",
  "memory.count.2": "You have 2 memories",
  "memory.count.3": "You have 3 memories",
};
```

✅ **Good:**
```typescript
export default {
  "memory.count": "You have {count} {count, plural, one {memory} other {memories}}"
};
```

### 3. Keep Context in Keys

❌ **Bad:**
```typescript
export default {
  "yes": "Yes",
  "no": "No",
};
```

✅ **Good:**
```typescript
export default {
  "dialog.confirm.yes": "Yes",
  "dialog.confirm.no": "No",
  "form.enabled.yes": "Enabled",
  "form.enabled.no": "Disabled",
};
```

### 4. Provide Context Comments

```typescript
export default {
  // Used in /config setup success message
  "commands.config.setup.success": "Setup completed!",

  // Error when user lacks permissions
  "errors.permission_denied": "You don't have permission!",
};
```

## Checking Translation Coverage

**Script:** `bun run check-locales`

**File:** `scripts/checkLocalizationKeys.ts`

Compares all locale files and reports:
- Missing keys in Japanese
- Extra keys not in English
- Inconsistent variable usage

**Output:**
```
Checking localization keys...

✓ All keys present in both locales

⚠️ Japanese missing keys:
  - commands.new.feature.description

ℹ️ Extra keys in Japanese (not in English):
  - commands.old.feature.description
```

## Dynamic Language Switching

Bot's personality language can differ from user's UI language:

```typescript
// User interface in English
userData.language_pref = "en";

// Bot personality in Japanese
state.config.preset_language = "ja";

// Result:
// - Command responses in English
// - Bot conversations in Japanese
```

## Next Steps

Read document 13 (Security & Privacy) to understand data protection!
