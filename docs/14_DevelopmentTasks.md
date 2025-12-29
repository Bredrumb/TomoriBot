# 14. Common Development Tasks

This document provides practical guides for common development tasks when working on TomoriBot.

## Table of Contents

1. [Adding a New Slash Command](#adding-a-new-slash-command)
2. [Adding a New Event Handler](#adding-a-new-event-handler)
3. [Creating a New Tool](#creating-a-new-tool)
4. [Adding a New Database Column](#adding-a-new-database-column)
5. [Adding a New Locale (Language)](#adding-a-new-locale)
6. [Adding a New AI Provider](#adding-a-new-ai-provider)
7. [Adding a New Feature Flag](#adding-a-new-feature-flag)
8. [Adding a New Personality Preset](#adding-a-new-personality-preset)

---

## Adding a New Slash Command

### Goal
Create `/greet hello` command that sends a greeting.

### Step 1: Create Command File

```bash
mkdir -p src/commands/greet
touch src/commands/greet/hello.ts
```

### Step 2: Implement Command

```typescript
// src/commands/greet/hello.ts
import type {
  ChatInputCommandInteraction,
  Client,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import type { UserRow } from "../../types/db/schema";
import { localizer } from "../../utils/text/localizer";
import { log } from "../../utils/misc/logger";

export const configureSubcommand = (
  subcommand: SlashCommandSubcommandBuilder
) =>
  subcommand
    .setName("hello")
    .setDescription("Send a friendly greeting")
    .setNameLocalizations({ ja: "こんにちは" })
    .setDescriptionLocalizations({ ja: "挨拶を送信" })
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("Name to greet")
        .setRequired(false)
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string
): Promise<void> {
  try {
    const name = interaction.options.getString("name") || interaction.user.username;

    const t = (key: string, vars?: Record<string, any>) =>
      localizer(userData.language_pref, key, vars);

    await interaction.reply({
      content: t("commands.greet.hello.success", { name }),
      ephemeral: false,
    });

    log.success(`Greeted ${name} in ${interaction.guild?.name || "DM"}`);
  } catch (error) {
    log.error("Greet command failed", error as Error);
    await interaction.reply({
      content: localizer(userData.language_pref, "general.errors.operation_failed"),
      ephemeral: true,
    });
  }
}
```

### Step 3: Add Localization

```typescript
// src/locales/en-US.ts
export default {
  // ... existing keys
  "commands.greet.hello.success": "Hello, {name}! 👋",
};

// src/locales/ja.ts
export default {
  // ... existing keys
  "commands.greet.hello.success": "こんにちは、{name}さん！ 👋",
};
```

### Step 4: Test

1. Restart bot: `bun run dev`
2. Commands auto-register on startup
3. Test: `/greet hello name:Alice`

**Expected:** `Hello, Alice! 👋`

---

## Adding a New Event Handler

### Goal
Log when messages are edited.

### Step 1: Create Event Folder

```bash
mkdir -p src/events/messageUpdate
```

### Step 2: Create Handler File

```typescript
// src/events/messageUpdate/logEdits.ts
import type { Client, Message, PartialMessage } from "discord.js";
import { log } from "../../utils/misc/logger";

export default async function logEdits(
  _client: Client,
  oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage
): Promise<void> {
  try {
    // Ignore bot messages
    if (newMessage.author?.bot) return;

    // Ignore if content didn't change
    if (oldMessage.content === newMessage.content) return;

    log.info(
      `Message edited in ${newMessage.guild?.name || "DM"}: ` +
      `"${oldMessage.content}" → "${newMessage.content}"`
    );
  } catch (error) {
    log.error("Error logging message edit", error as Error);
  }
}
```

### Step 3: Register Event

```typescript
// src/handlers/eventHandler.ts
const eventFolderMap = {
  // ... existing mappings
  messageUpdate: "messageUpdate", // Add this line
};
```

### Step 4: Test

1. Restart bot
2. Edit a message in Discord
3. Check logs for edit event

---

## Creating a New Tool

### Goal
Create a tool that tells jokes.

### Step 1: Create Tool File

```typescript
// src/tools/functionCalls/jokeTool.ts
import { registerTool } from "../toolRegistry";
import type { Tool, ToolContext, ToolResult } from "../../types/tool/interfaces";

const jokes = [
  "Why did the chicken cross the road? To get to the other side!",
  "What do you call a fake noodle? An impasta!",
  "Why don't scientists trust atoms? Because they make up everything!",
];

const jokeTool: Tool = {
  name: "tell_joke",
  description: "Tell a random joke to lighten the mood",
  category: "entertainment",

  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description: "Type of joke (optional)",
        enum: ["general", "tech", "puns"],
      },
    },
    required: [],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    try {
      const category = args.category as string | undefined;

      // Pick random joke
      const joke = jokes[Math.floor(Math.random() * jokes.length)];

      return {
        success: true,
        result: `Here's a joke: ${joke}`,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  },

  isAvailableFor(provider: string): boolean {
    return ["google", "novelai"].includes(provider);
  },

  // Optional: require feature flag
  // requiresFeatureFlag: "joke_tool_enabled",
};

// Register tool on module load
registerTool(jokeTool);
```

### Step 2: Import Tool

```typescript
// src/tools/toolInitializer.ts
// Tool auto-loads if file is in functionCalls/
// No changes needed if using auto-discovery
```

### Step 3: Test

1. Restart bot
2. Chat: "Tell me a joke"
3. AI should call `tell_joke` function

---

## Adding a New Database Column

### Goal
Add `last_active_at` timestamp to users table.

### Step 1: Update Schema

```sql
-- src/db/schema.sql
-- Find the users table section, add migration
SELECT add_column_if_not_exists('users', 'last_active_at', 'TIMESTAMP');
```

### Step 2: Update TypeScript Types

```typescript
// src/types/db/schema.ts
export interface UserRow {
  user_id: number;
  user_disc_id: string;
  user_nickname: string;
  language_pref: string;
  personal_memories: string[];
  privacy_opt_out: boolean;
  last_active_at: Date | null; // Add this
  created_at: Date;
  updated_at: Date;
}
```

### Step 3: Use New Column

```typescript
// Update last_active_at when user sends message
await sql`
  UPDATE users
  SET last_active_at = CURRENT_TIMESTAMP
  WHERE user_disc_id = ${userId}
`;
```

### Step 4: Test

1. Restart bot (schema runs on startup)
2. Check database:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'users';
```
3. Verify `last_active_at` exists

---

## Adding a New Locale

### Goal
Add Spanish (es) support.

### Step 1: Create Locale File

```typescript
// src/locales/es.ts
export default {
  "general.welcome": "¡Bienvenido a TomoriBot!",
  "general.goodbye": "¡Adiós!",
  "general.errors.not_found": "No encontrado",
  "general.errors.permission_denied": "No tienes permiso para esto",

  "commands.config.setup.description": "Configuración inicial del bot",
  "commands.config.setup.success": "¡Configuración completada exitosamente!",

  // ... translate all keys from en-US.ts
};
```

### Step 2: Register Locale

```typescript
// src/utils/text/localizer.ts
export async function initializeLocalizer(): Promise<void> {
  const locales = {
    "en-US": (await import("../../locales/en-US")).default,
    "ja": (await import("../../locales/ja")).default,
    "es": (await import("../../locales/es")).default, // Add this
  };

  // ... rest of initialization
}
```

### Step 3: Add to Language Choices

```typescript
// src/commands/personal/language.ts
.addStringOption(option =>
  option
    .setName("preference")
    .setDescription("Your preferred language")
    .setRequired(true)
    .addChoices(
      { name: "English", value: "en" },
      { name: "日本語 (Japanese)", value: "ja" },
      { name: "Español (Spanish)", value: "es" } // Add this
    )
)
```

### Step 4: Test

1. Restart bot
2. Run: `/personal language preference:Spanish`
3. Run: `/config setup`
4. Response should be in Spanish

---

## Adding a New AI Provider

### Goal
Add OpenAI as a provider.

### Step 1: Create Provider Folder

```bash
mkdir -p src/providers/openai
```

### Step 2: Implement Provider

```typescript
// src/providers/openai/openaiProvider.ts
import type { LLMProvider, StreamResult } from "../../types/provider/interfaces";
import OpenAI from "openai";

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async *streamChatCompletion(messages, config): AsyncGenerator<StreamResult> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: config.temperature,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        yield {
          type: "text",
          content: delta.content,
        };
      }

      if (delta?.function_call) {
        yield {
          type: "function_call",
          name: delta.function_call.name,
          args: JSON.parse(delta.function_call.arguments),
        };
      }
    }
  }

  async generateChatCompletion(messages, config) {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: config.temperature,
    });

    return response.choices[0].message;
  }

  getToolAdapter() {
    return new OpenAIToolAdapter();
  }

  getProviderName() {
    return "openai";
  }
}
```

### Step 3: Register in Factory

```typescript
// src/utils/provider/providerFactory.ts
export async function getProviderForTomori(state: TomoriState): Promise<LLMProvider> {
  const provider = state.config.llm_provider.toLowerCase();

  switch (provider) {
    case "google":
      return new GoogleProvider(...);
    case "novelai":
      return new NovelAIProvider(...);
    case "openai": // Add this
      return new OpenAIProvider(apiKey, modelName);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
```

### Step 4: Add Models to Database

```sql
-- src/db/seed.sql
INSERT INTO llms (llm_provider, llm_codename, is_default, llm_description)
VALUES
  ('openai', 'gpt-4', false, 'OpenAI GPT-4 - Most capable model'),
  ('openai', 'gpt-3.5-turbo', false, 'OpenAI GPT-3.5 - Fast and efficient');
```

### Step 5: Test

1. Restart bot
2. Run: `/config apikey set provider:openai key:sk-...`
3. Run: `/config model` → Select OpenAI model
4. Chat with bot

---

## Adding a New Feature Flag

### Goal
Add `voice_features_enabled` flag.

### Step 1: Add to Schema

```sql
-- src/db/schema.sql
SELECT add_column_if_not_exists('tomori_configs', 'voice_features_enabled', 'BOOLEAN', 'false');
```

### Step 2: Update Types

```typescript
// src/types/db/schema.ts
export interface TomoriConfig {
  // ... existing fields
  voice_features_enabled: boolean; // Add this
}
```

### Step 3: Add to Feature Flag Mapper

```typescript
// src/utils/tools/featureFlagMapper.ts
export function configToFeatureFlags(config: TomoriConfig) {
  return {
    // ... existing flags
    "voice_features_enabled": config.voice_features_enabled,
  };
}
```

### Step 4: Add to Permissions Command

```typescript
// src/commands/config/permissions.ts
// Add toggle option for voice features
.addBooleanOption(option =>
  option
    .setName("voice_features")
    .setDescription("Enable voice features")
)
```

### Step 5: Use Feature Flag

```typescript
// In your code
if (state.config.voice_features_enabled) {
  // Enable voice features
}
```

---

## Adding a New Personality Preset

### Goal
Add "Excited Gamer" personality preset.

### Step 1: Create Avatar Image (Optional)

Place avatar in `src/db/img/excited_gamer.png`

### Step 2: Add to Seed Data

```sql
-- src/db/seed.sql
INSERT INTO tomori_presets (
  tomori_preset_name,
  tomori_preset_desc,
  preset_attribute_list,
  preset_sample_dialogues_in,
  preset_sample_dialogues_out,
  preset_language,
  preset_avatar_path
)
VALUES (
  'Excited Gamer',
  'An enthusiastic gamer personality who loves video games and esports',
  ARRAY[
    'Extremely enthusiastic about gaming',
    'Uses gaming terminology frequently',
    'Passionate about competitive gaming',
    'Friendly and energetic',
    'Often references popular games'
  ],
  ARRAY[
    'What''s your favorite game?',
    'Do you play League of Legends?',
    'How do I get better at gaming?'
  ],
  ARRAY[
    'OMG I love so many games! Right now I''m super into Valorant and League! What about you? 🎮',
    'YES! I main support but I can flex to other roles! What rank are you? Want to duo sometime? 😄',
    'Practice is key! Start with aim training, watch pro players, and most importantly - have fun! GG! 💪'
  ],
  'en-US',
  'db/img/excited_gamer.png'
);
```

### Step 3: Test

1. Restart bot (seed data runs on startup)
2. Run: `/persona import preset:Excited Gamer`
3. Chat with bot - should have excited gamer personality

---

## Development Workflow Tips

### Hot Reload

In development mode (`bun run dev`), code changes trigger automatic restart:

```bash
# Edit any .ts file
# Save file
# Bot automatically restarts
```

### Type Checking

Check TypeScript errors:

```bash
bun run check
```

### Linting

Fix code style issues:

```bash
bun run lint
```

### Database Reset

⚠️ **WARNING: Deletes all data!**

```bash
bun run nuke-db
```

### Database Backup

```bash
bun run backup-db
```

### Testing Commands

Use `/tool refresh` to re-register commands without full restart.

### Debugging

Add debug logs:

```typescript
import { log } from "./utils/misc/logger";

log.info("Debug info", { variable: value });
log.warn("Warning message");
log.error("Error occurred", error);
```

---

## Congratulations!

You've completed the TomoriBot Developer Documentation! You now have:

✅ Understanding of TomoriBot's architecture
✅ Knowledge of how events, commands, and tools work
✅ Database schema understanding
✅ Security and privacy awareness
✅ Practical guides for common tasks

**Next Steps:**

1. Clone the repository
2. Set up your development environment
3. Make your first contribution
4. Share your improvements with the community!

**Resources:**

- [GitHub Repository](https://github.com/Bredrumb/TomoriBot)
- [Discord.js Documentation](https://discord.js.org)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Bun Documentation](https://bun.sh/docs)

Happy coding! 🚀
