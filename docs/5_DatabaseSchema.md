# 5. Database Schema & Data Model

This document explains TomoriBot's PostgreSQL database structure, including all tables, relationships, and migration patterns.

## Schema File Location

**Path:** `/home/user/TomoriSide/src/db/schema.sql` (447 lines)

## Database Overview

TomoriBot uses **PostgreSQL** with the following characteristics:

- **13 Core Tables**: servers, users, tomoris, configs, presets, system_prompt_presets, image_diffusion_models, memories, emojis, stickers, reminders, errors, cooldowns, opt_api_keys
- **Idempotent Migrations**: Schema can run multiple times safely
- **Automatic Timestamps**: All tables have `created_at` and `updated_at` with triggers (some static tables have triggers removed for performance)
- **Encrypted Storage**: API keys encrypted using libsodium with versioned keys
- **Foreign Key Cascades**: Proper cleanup when entities are deleted
- **Indexes**: Optimized for common queries

## Entity Relationship Diagram

```
┌──────────────┐
│   servers    │  1────────┐
│              │           │
│ server_id PK │           │ 1
└──────────────┘           │
       │                   │
       │ 1                 │
       │                   │
       │                   ▼
       │            ┌──────────────┐
       │            │   tomoris    │  1────┐
       │            │              │       │
       │            │ tomori_id PK │       │ 1
       │            │ server_id FK │       │
       │            └──────────────┘       │
       │                   │               │
       │ N                 │ 1             │
       │                   │               ▼
       ▼                   ▼        ┌────────────────┐
┌──────────────┐   ┌──────────────┐│ tomori_configs │
│server_emojis │   │server_stickers│              │
│              │   │              ││ config_id PK   │
│ emoji_id PK  │   │ sticker_id PK││ tomori_id FK   │
│ server_id FK │   │ server_id FK ││ llm_id FK      │
└──────────────┘   └──────────────┘│ api_key BYTEA  │
                                   └────────────────┘
┌──────────────┐                          │
│    users     │                          │
│              │                          │ N
│ user_id PK   │                          │
│ user_disc_id │                          ▼
└──────────────┘                   ┌──────────────┐
       │                           │     llms     │
       │ N                         │              │
       │                           │ llm_id PK    │
       ▼                           │ provider     │
┌──────────────┐                   └──────────────┘
│server_memories│
│              │
│ memory_id PK │           ┌──────────────────┐
│ server_id FK │           │ tomori_presets   │
│ user_id FK   │           │                  │
└──────────────┘           │ preset_id PK     │
                           │ preset_name      │
┌──────────────┐           │ attribute_list   │
│  reminders   │           └──────────────────┘
│              │
│ reminder_id  │
│ server_id FK │
│ user_id FK   │
└──────────────┘
```

## Table Definitions

### 1. `servers` - Server/Guild Registry

**Purpose:** Tracks all Discord servers (guilds) where TomoriBot is installed.

```sql
CREATE TABLE IF NOT EXISTS servers (
  server_id SERIAL PRIMARY KEY,
  server_disc_id TEXT UNIQUE NOT NULL,  -- Discord's guild ID
  is_dm_channel BOOLEAN DEFAULT false,   -- True for DM "servers"
  registration_locale TEXT,              -- Discord locale when server first added bot (analytics)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Key Points:**
- `server_disc_id`: Discord's snowflake ID (string)
- `server_id`: Internal integer ID for foreign keys
- `is_dm_channel`: Special flag for DM conversations (treated as pseudo-servers)
- `registration_locale`: Discord locale when server first added bot (for analytics)
- **Indexes:**
  - `idx_servers_disc_id` for fast Discord ID lookups
  - `idx_servers_is_dm_channel` for filtering DM vs guild servers

**Example Row:**
```sql
server_id: 1
server_disc_id: "123456789012345678"
is_dm_channel: false
registration_locale: "en-US"
```

### 2. `tomoris` - Per-Server Bot Instance

**Purpose:** One Tomori instance per server, stores server-specific personality data.

```sql
CREATE TABLE IF NOT EXISTS tomoris (
  tomori_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL UNIQUE,         -- One Tomori per server
  tomori_nickname TEXT NOT NULL,         -- Display name
  attribute_list TEXT[] DEFAULT '{}',    -- Personality attributes
  sample_dialogues_in TEXT[] DEFAULT '{}',   -- Example user messages
  sample_dialogues_out TEXT[] DEFAULT '{}',  -- Example Tomori responses
  autoch_counter INT DEFAULT 0,          -- Auto-trigger message counter
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);
```

**Key Fields:**
- `tomori_nickname`: Can be changed with `/config rename`
- `attribute_list`: Array of personality traits (e.g., ["friendly", "sarcastic", "helpful"])
- `sample_dialogues_in/out`: Used to teach conversation style
- `autoch_counter`: Increments with each message, triggers auto-response at threshold

**Example Row:**
```sql
tomori_id: 1
server_id: 1
tomori_nickname: "Tomori-chan"
attribute_list: ["cheerful", "helpful", "loves anime"]
sample_dialogues_in: ["How are you?", "Tell me a joke"]
sample_dialogues_out: ["I'm doing great!", "Why did the chicken cross the road?"]
```

### 3. `llms` - Available AI Models

**Purpose:** Registry of supported AI models/providers with capability tracking.

```sql
CREATE TABLE IF NOT EXISTS llms (
  llm_id SERIAL PRIMARY KEY,
  llm_provider TEXT NOT NULL,              -- "google", "novelai", "openrouter"
  llm_codename TEXT NOT NULL UNIQUE,       -- "gemini-2.5-flash-exp", "kayra-v1", "gpt-5.1"
  llm_description TEXT,                    -- English description
  ja_description TEXT,                     -- Japanese description
  -- Capability flags
  is_smartest BOOLEAN DEFAULT false,       -- Flagship model flag
  is_default BOOLEAN DEFAULT false,        -- Default for new servers
  is_reasoning BOOLEAN DEFAULT false,      -- Reasoning model (like o1, thinking models)
  is_deprecated BOOLEAN DEFAULT false,     -- No longer recommended
  is_free BOOLEAN DEFAULT false,           -- Free tier available
  has_tools BOOLEAN DEFAULT false,         -- Supports function calling
  sees_images BOOLEAN DEFAULT false,       -- Vision capabilities
  sees_videos BOOLEAN DEFAULT false,       -- Video understanding
  sees_youtube BOOLEAN DEFAULT false,      -- YouTube URL processing
  is_uncensored BOOLEAN DEFAULT false,     -- No content filtering
  supports_structoutput BOOLEAN DEFAULT false,  -- Structured output support
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**Capability Flags:**
- `has_tools`: Model supports function calling for tool use
- `sees_images`/`sees_videos`/`sees_youtube`: Multimodal capabilities
- `is_uncensored`: Model has no built-in content filtering
- `supports_structoutput`: Can generate structured JSON outputs

**Seeded Models:** See `src/db/seed.sql` for current model list including Gemini 2.5/3, OpenRouter models (GPT-5.1, Claude Sonnet 4.5), and more.

### 3.5. `image_diffusion_models` - Image Generation Models

**Purpose:** Registry of available image generation models for /generate image command.

```sql
CREATE TABLE IF NOT EXISTS image_diffusion_models (
  diffusion_model_id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,                  -- "google", "openrouter"
  codename TEXT NOT NULL UNIQUE,           -- "imagen-3.0-generate-001", "flux-pro"
  model_description TEXT,                  -- English description
  ja_description TEXT,                     -- Japanese description
  is_default BOOLEAN DEFAULT false,        -- Default model
  is_deprecated BOOLEAN DEFAULT false,     -- No longer available
  is_free BOOLEAN DEFAULT false,           -- Free tier available
  is_uncensored BOOLEAN DEFAULT false,     -- No content filtering
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**Example Models:**
- **Google Imagen**: `imagen-3.0-generate-001`, `imagen-3.0-generate-002` (fast)
- **OpenRouter**: `flux-pro`, `flux-dev`, `stable-diffusion-3`, `dall-e-3`

**Indexes:**
- `idx_image_diffusion_models_provider` on `provider`
- `idx_image_diffusion_models_default` on `(is_default, is_deprecated)`

### 4. `tomori_configs` - Server Configuration

**Purpose:** All configuration settings per server.

```sql
CREATE TABLE IF NOT EXISTS tomori_configs (
  tomori_config_id SERIAL PRIMARY KEY,
  tomori_id INT NOT NULL UNIQUE,
  llm_id INT NOT NULL,                   -- Which AI model to use
  llm_temperature REAL NOT NULL DEFAULT 1.5 CHECK (llm_temperature >= 1.0 AND llm_temperature <= 2.0),
  api_key BYTEA,                         -- Encrypted API key
  key_version INTEGER DEFAULT 1,         -- Encryption key version (for key rotation)
  trigger_words TEXT[] DEFAULT '{}',     -- Words that activate bot
  autoch_disc_ids TEXT[] DEFAULT '{}',   -- Auto-trigger channel IDs
  autoch_threshold INT DEFAULT 0,        -- Messages before auto-trigger (0=disabled)

  -- Memory Teaching Flags
  server_memteaching_enabled BOOLEAN DEFAULT true,
  attribute_memteaching_enabled BOOLEAN DEFAULT false,
  sampledialogue_memteaching_enabled BOOLEAN DEFAULT false,
  self_teaching_enabled BOOLEAN DEFAULT true,
  personal_memories_enabled BOOLEAN DEFAULT true,

  -- Feature Flags
  emoji_usage_enabled BOOLEAN DEFAULT true,       -- Bot can react with emojis
  sticker_usage_enabled BOOLEAN DEFAULT true,     -- Bot can send stickers
  web_search_enabled BOOLEAN DEFAULT true,        -- Web search capability (Brave/DDG)
  pin_message_enabled BOOLEAN DEFAULT true,       -- Bot can pin messages
  imagegen_enabled BOOLEAN DEFAULT true,          -- Image generation via diffusion models
  videogen_enabled BOOLEAN DEFAULT true,          -- Video generation (future use)

  -- Customization Options
  humanizer_degree INT DEFAULT 1,        -- 0=none, 1=light, 2=moderate, 3=heavy
  timezone_offset INTEGER DEFAULT 0,     -- Offset from UTC in minutes
  diffusion_model_id INTEGER,            -- Default image generation model
  system_prompt TEXT,                    -- Custom system prompt (December 2025)

  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  FOREIGN KEY (tomori_id) REFERENCES tomoris(tomori_id) ON DELETE CASCADE,
  FOREIGN KEY (llm_id) REFERENCES llms(llm_id) ON DELETE RESTRICT,
  FOREIGN KEY (diffusion_model_id) REFERENCES image_diffusion_models(diffusion_model_id) ON DELETE SET NULL
);
```

**Temperature Range:** 1.0-2.0 (enforced by CHECK constraint)

**Feature Flags:**
- `self_teaching_enabled`: Bot can create memories from conversations
- `personal_memories_enabled`: Track user-specific info
- `emoji_usage_enabled`: Bot can react with emojis
- `sticker_usage_enabled`: Bot can send stickers
- `web_search_enabled`: Bot can search the web (Brave Search or DuckDuckGo)
- `pin_message_enabled`: Bot can pin messages in channels
- `imagegen_enabled`: Bot can generate images via diffusion models
- `videogen_enabled`: Bot can generate videos (future feature)

**Customization Options:**
- `timezone_offset`: Server timezone offset from UTC in minutes (e.g., 540 for JST +9:00)
- `diffusion_model_id`: Default image generation model (FK to image_diffusion_models)
- `system_prompt`: Custom system prompt override (December 2025 feature)

**Humanizer Degrees:**
- `0`: No humanization (full AI responses)
- `1`: Light (slightly shorter responses, few emojis)
- `2`: Moderate (more casual, moderate emoji usage)
- `3`: Heavy (very casual, lots of emojis, shorter responses)

**Key Versioning:**
- `key_version`: Tracks which encryption key version was used for the encrypted `api_key`
- Enables zero-downtime key rotation (see Security document)

### 5. `tomori_presets` - Personality Templates

**Purpose:** Reusable personality templates that can be applied to any server.

```sql
CREATE TABLE IF NOT EXISTS tomori_presets (
  tomori_preset_id SERIAL PRIMARY KEY,
  tomori_preset_name TEXT NOT NULL UNIQUE,
  tomori_preset_desc TEXT NOT NULL,
  preset_attribute_list TEXT[] DEFAULT '{}',
  preset_sample_dialogues_in TEXT[] DEFAULT '{}',
  preset_sample_dialogues_out TEXT[] DEFAULT '{}',
  preset_language TEXT NOT NULL,         -- "en-US", "ja"
  preset_avatar_path TEXT,               -- Path to preset avatar image (e.g., "db/img/default.png")
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**Default Presets:** Defined in `src/db/seed.sql`:
- **Default (English)**: Friendly general-purpose assistant
- **Default (Japanese)**: Japanese-speaking assistant
- **Tsundere**: Classic tsundere personality
- **Kuudere**: Cool and emotionless type
- And more...

**Avatar Images:**
- Stored in `src/db/img/` as PNG files
- `preset_avatar_path` contains relative path from project root
- Used by `/persona import` command to set server avatar

### 5.5. `system_prompt_presets` - System Prompt Templates

**Purpose:** Store pre-made system prompt presets that users can apply to customize bot behavior (December 2025 feature).

```sql
CREATE TABLE IF NOT EXISTS system_prompt_presets (
  system_prompt_preset_id SERIAL PRIMARY KEY,
  system_prompt_preset_name TEXT NOT NULL UNIQUE,
  system_prompt_preset_desc TEXT NOT NULL,     -- English description
  ja_description TEXT,                          -- Japanese description
  preset_prompt_text TEXT NOT NULL,             -- Actual system prompt content
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**Purpose:**
- Provides ready-to-use system prompt templates
- Users can apply via `/config prompt preset`
- Allows advanced behavior customization without manual prompting

**Example Presets:**
- **Concise**: Forces short, direct responses
- **Detailed**: Encourages longer, explanatory responses
- **Roleplay**: Enhances character roleplay behavior
- **Technical**: Focuses on technical accuracy and formatting

**Related Commands:**
- `/config prompt preset` - Apply a preset
- `/config prompt change` - Set custom prompt
- `/config prompt clear` - Reset to default

### 6. `server_emojis` - Server Emoji Registry

**Purpose:** Maps emojis to emotion categories for expression.

```sql
CREATE TABLE IF NOT EXISTS server_emojis (
  server_emoji_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL,
  emoji_disc_id TEXT NOT NULL,           -- Discord emoji ID
  emoji_name TEXT NOT NULL,              -- e.g., "TomoriGiggle"
  emoji_desc TEXT DEFAULT '',            -- LLM-generated visual description (December 2025)
  emotion_key TEXT,                      -- e.g., "joy", "sadness", "anger" (28 categories, nullable)
  is_global BOOLEAN DEFAULT false,       -- Usable in all servers
  is_animated BOOLEAN DEFAULT false,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE (server_id, emoji_disc_id),
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);
```

**Key Features:**
- `emoji_desc`: LLM-generated visual description for better emoji selection
- `emotion_key`: Now **NULLABLE** for graceful degradation (emojis work without initialization)
- Allows emojis to function with name-only matching if not categorized

**Emotion Keys (28 categories):** "joy", "sadness", "anger", "fear", "surprise", "disgust", "love", "embarrassed", "smug", "confused", "thinking", "sleepy", "proud", "determined", "frustrated", "relieved", "grateful", "excited", "nervous", "shy", "playful", "mischievous", "innocent", "mature", "cool", "warm", "energetic", "calm"

**Format:** `<:TomoriGiggle:123456789>` (combine `emoji_name` + `emoji_disc_id`)

**Initialization:** Use `/server emojis initialize` to generate descriptions and categorize emotions

### 7. `server_stickers` - Server Sticker Registry

**Purpose:** Similar to emojis, but for stickers.

```sql
CREATE TABLE IF NOT EXISTS server_stickers (
  server_sticker_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL,
  sticker_disc_id TEXT NOT NULL,
  sticker_name TEXT NOT NULL,
  sticker_desc TEXT DEFAULT '',          -- LLM-generated visual description
  emotion_key TEXT,                      -- e.g., "joy", "sadness" (28 categories, nullable)
  sticker_format INT DEFAULT 1,          -- 1=PNG, 2=APNG, 3=Lottie
  is_global BOOLEAN DEFAULT false,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE (server_id, sticker_disc_id),
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);
```

**Key Features:**
- `sticker_desc`: LLM-generated visual description for better sticker selection
- `emotion_key`: Now **NULLABLE** for graceful degradation (stickers work without initialization)
- `sticker_format`: Type of sticker file (replaces deprecated `is_animated`)

**Sticker Formats:**
- `1`: PNG (static image)
- `2`: APNG (animated PNG)
- `3`: Lottie (JSON animation)

**Migration Note:** The `is_animated` column was deprecated and dropped in May 2025, replaced by `sticker_format` for better format tracking

**Initialization:** Use `/server stickers initialize` to generate descriptions and categorize emotions

### 8. `users` - User Profiles

**Purpose:** Cross-server user data and preferences.

```sql
CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  user_disc_id TEXT UNIQUE NOT NULL,
  user_nickname TEXT NOT NULL,           -- User's preferred name
  language_pref TEXT DEFAULT 'en',       -- "en", "ja", etc.
  personal_memories TEXT[] DEFAULT '{}', -- Personal facts about user
  privacy_level INTEGER NOT NULL DEFAULT 0 CHECK (privacy_level IN (0, 1, 2)),  -- 0=MINIMAL, 1=PARTIAL, 2=FULL
  registration_locale TEXT,              -- User's Discord locale at registration (analytics)
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**Key Points:**
- `user_disc_id`: Discord user ID (globally unique)
- `user_nickname`: Set with `/personal nickname`
- `language_pref`: Affects command responses and bot language
- `privacy_level`: Three-level privacy system (replaced `privacy_opt_out` boolean):
  - **0 (MINIMAL)**: Full features, personalization enabled (default)
  - **1 (PARTIAL)**: Limited data collection, some features disabled
  - **2 (FULL)**: Maximum privacy, minimal data saved (equivalent to old opt-out)
- `registration_locale`: Discord locale when user first interacted (for analytics)
- **Index:** `idx_users_disc_id` for fast lookups

**Migration:** The `privacy_opt_out` boolean was migrated to `privacy_level` integer in late 2025:
- `false` (opted in) → `0` (MINIMAL privacy)
- `true` (opted out) → `2` (FULL privacy)

### 9. `server_memories` - Server-Wide Memories

**Purpose:** Facts about the server/community that all users share.

```sql
CREATE TABLE IF NOT EXISTS server_memories (
  server_memory_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL,
  user_id INT,                           -- Who added this memory (nullable)
  content TEXT NOT NULL,                 -- The memory text
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);
```

**Example Memories:**
- "This server is about anime discussion"
- "The server owner is named Alex"
- "We have a weekly movie night on Fridays"

**User Attribution:** If user is deleted, `user_id` becomes NULL but memory persists.

### 10. `personalization_blacklist` - Per-Server Opt-Out

**Purpose:** Users who don't want personalization in specific servers.

```sql
CREATE TABLE IF NOT EXISTS personalization_blacklist (
  server_id INT NOT NULL,
  user_disc_id TEXT NOT NULL,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  PRIMARY KEY (server_id, user_disc_id),
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);
```

**Difference from `privacy_opt_out`:**
- `privacy_opt_out`: Global, affects all servers
- `personalization_blacklist`: Per-server, user can opt out of one server but not others

### 11. `error_logs` - Error Tracking

**Purpose:** Centralized error logging for debugging.

```sql
CREATE TABLE IF NOT EXISTS error_logs (
  error_log_id SERIAL PRIMARY KEY,
  tomori_id INT NULL,
  user_id INT NULL,
  server_id INT NULL,
  error_type TEXT NOT NULL DEFAULT 'GenericError',
  error_message TEXT NOT NULL,
  stack_trace TEXT NULL,
  error_metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  FOREIGN KEY (tomori_id) REFERENCES tomoris(tomori_id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE SET NULL
);
```

**Metadata Examples:**
```json
{
  "command": "/teach memory personal",
  "provider": "google",
  "model": "gemini-2.0-flash-exp",
  "retryable": false
}
```

### 12. `cooldowns` - Rate Limiting (Unlogged Table)

**Purpose:** Prevent command spam.

```sql
CREATE UNLOGGED TABLE IF NOT EXISTS cooldowns (
  user_disc_id TEXT NOT NULL,
  command_category TEXT NOT NULL,
  expiry_time BIGINT NOT NULL,           -- Unix timestamp (ms)
  PRIMARY KEY (user_disc_id, command_category)
);
```

**Why UNLOGGED?**
- Faster writes (no WAL logging)
- Data lost on crash (acceptable for cooldowns)
- Reduces disk I/O

**Command Categories:** "config", "teach", "forget", "persona", etc.

**Cleanup:** Expired entries deleted by `cleanup_expired_cooldowns()` function (hourly via pg_cron or on startup).

### 13. `opt_api_keys` - Optional Service API Keys

**Purpose:** Server-specific API keys for services like Brave Search.

```sql
CREATE TABLE IF NOT EXISTS opt_api_keys (
  opt_api_key_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL,
  service_name TEXT NOT NULL,            -- "brave-search", "duckduckgo-search", etc.
  api_key BYTEA,                         -- Encrypted API key using libsodium
  key_version INTEGER DEFAULT 1,         -- Encryption key version (November 2025)
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE (server_id, service_name),
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);
```

**Supported Services:**
- `brave-search`: Brave Search API key for web search

**Key Versioning:**
- `key_version`: Tracks which encryption key version was used
- Enables zero-downtime key rotation (see Security document)
- Index: `idx_opt_api_keys_version` on `key_version`

### 14. `reminders` - User Reminders

**Purpose:** User-created reminders.

```sql
CREATE TABLE IF NOT EXISTS reminders (
  reminder_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL,
  channel_disc_id TEXT NOT NULL,
  user_discord_id TEXT NOT NULL,
  user_nickname TEXT NOT NULL,
  reminder_purpose TEXT NOT NULL,
  reminder_time TIMESTAMP WITH TIME ZONE NOT NULL,
  created_by_user_id INT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);
```

**Indexes:**
- `idx_reminders_time`: For efficient "which reminders are due?" queries
- `idx_reminders_server_id`: For server-specific lookups

## Migration Pattern: Idempotent Schema

TomoriBot uses **idempotent migrations** - the schema file can run multiple times safely.

### Helper Functions

```sql
-- Add column only if it doesn't exist
CREATE OR REPLACE FUNCTION add_column_if_not_exists(
  _table TEXT,
  _column TEXT,
  _datatype TEXT,
  _default_value TEXT DEFAULT NULL,
  _constraint TEXT DEFAULT NULL
) RETURNS VOID AS $$
  -- Implementation checks information_schema.columns
  -- Only adds column if missing
$$;

-- Drop column only if it exists
CREATE OR REPLACE FUNCTION drop_column_if_exists(
  _table TEXT,
  _column TEXT
) RETURNS VOID AS $$
  -- Implementation checks information_schema.columns
  -- Only drops column if present
$$;
```

### Adding New Columns (Migration Example)

```sql
-- Add new feature flag (safe to run multiple times)
SELECT add_column_if_not_exists('tomori_configs', 'pin_message_enabled', 'BOOLEAN', 'true');
```

### Renaming Columns (Migration Example)

```sql
-- Migrate google_search_enabled → web_search_enabled
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.columns
             WHERE table_name = 'tomori_configs'
             AND column_name = 'google_search_enabled') THEN
    -- Copy old column data to new column
    UPDATE tomori_configs
    SET web_search_enabled = google_search_enabled;

    -- Drop old column
    ALTER TABLE tomori_configs DROP COLUMN google_search_enabled;
  END IF;
END $$;
```

## Encryption & Security

### Encrypted Columns

- `tomori_configs.api_key`: Main LLM API key (Google/NovelAI)
- `opt_api_keys.api_key`: Optional service keys (Brave Search)

### Key Versioning

Both encrypted columns have `key_version`:
- Enables zero-downtime key rotation
- Bot can read old versions while writing new
- Audit trail for security compliance

**Process:**
1. Add new key version to key manager
2. New writes use new version
3. Old data remains readable with old version
4. Gradually re-encrypt old data

### Encryption Implementation

See document 13 (Security & Privacy) for details.

## Common Queries

### Get Server Config
```sql
SELECT tc.*, l.llm_provider, l.llm_codename
FROM tomori_configs tc
JOIN tomoris t ON tc.tomori_id = t.tomori_id
JOIN servers s ON t.server_id = s.server_id
JOIN llms l ON tc.llm_id = l.llm_id
WHERE s.server_disc_id = '123456789';
```

### Get User's Personal Memories
```sql
SELECT u.personal_memories
FROM users u
WHERE u.user_disc_id = '987654321';
```

### Get All Emojis for a Server by Emotion
```sql
SELECT emoji_name, emoji_disc_id, is_animated
FROM server_emojis
WHERE server_id = 1 AND emotion_key = 'happy';
```

### Check if User is Blacklisted
```sql
SELECT EXISTS (
  SELECT 1 FROM personalization_blacklist
  WHERE server_id = 1 AND user_disc_id = '123456789'
);
```

## Next Steps

Now that you understand the database schema:

1. **Read "Event System"** (document 6) to see how events trigger database reads/writes
2. **Explore "Command System"** (document 7) to see commands that modify this data
3. **Study "Security & Privacy"** (document 13) for encryption details

Understanding this schema is crucial for adding new features or debugging data issues!
