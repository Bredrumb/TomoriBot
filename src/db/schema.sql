-- Create function for updated_at trigger
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = CURRENT_TIMESTAMP;
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a function to add columns if they don't exist
CREATE OR REPLACE FUNCTION add_column_if_not_exists(
    _table TEXT, 
    _column TEXT, 
    _datatype TEXT,
    _default_value TEXT DEFAULT NULL,
    _constraint TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
    _column_exists BOOLEAN;
BEGIN
    -- Check if the column already exists
    SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = _table 
        AND column_name = _column
    ) INTO _column_exists;
    
    -- If it doesn't exist, add it
    IF NOT _column_exists THEN
        IF _default_value IS NULL AND _constraint IS NULL THEN
            EXECUTE format('ALTER TABLE %I ADD COLUMN %I %s', 
                         _table, _column, _datatype);
        ELSIF _constraint IS NULL THEN
            EXECUTE format('ALTER TABLE %I ADD COLUMN %I %s DEFAULT %s', 
                         _table, _column, _datatype, _default_value);
        ELSIF _default_value IS NULL THEN
            EXECUTE format('ALTER TABLE %I ADD COLUMN %I %s %s', 
                         _table, _column, _datatype, _constraint);
        ELSE
            EXECUTE format('ALTER TABLE %I ADD COLUMN %I %s DEFAULT %s %s', 
                         _table, _column, _datatype, _default_value, _constraint);
        END IF;
        
        RAISE NOTICE 'Added column %.% of type %', _table, _column, _datatype;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create a function to drop columns if they exist (idempotent)
CREATE OR REPLACE FUNCTION drop_column_if_exists(
    _table TEXT,
    _column TEXT
) RETURNS VOID AS $$
DECLARE
    _column_exists BOOLEAN;
BEGIN
    -- Check if the column exists
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = _table
        AND column_name = _column
    ) INTO _column_exists;

    -- If it exists, drop it
    IF _column_exists THEN
        EXECUTE format('ALTER TABLE %I DROP COLUMN %I',
                     _table, _column);
        RAISE NOTICE 'Dropped column %.%', _table, _column;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS servers (
  server_id SERIAL PRIMARY KEY,
  server_disc_id TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add DM channel identification column 
SELECT add_column_if_not_exists('servers', 'is_dm_channel', 'BOOLEAN', 'false');

-- Add registration_locale column for server region analytics 
SELECT add_column_if_not_exists('servers', 'registration_locale', 'TEXT');

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_servers_disc_id ON servers(server_disc_id);
CREATE INDEX IF NOT EXISTS idx_servers_is_dm_channel ON servers(is_dm_channel);

-- Create updated_at trigger for servers table
DROP TRIGGER IF EXISTS update_servers_timestamp ON servers;
CREATE TRIGGER update_servers_timestamp
BEFORE UPDATE ON servers
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS tomoris (
  tomori_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL UNIQUE,
  tomori_nickname TEXT NOT NULL,
  attribute_list TEXT[] DEFAULT '{}',
  sample_dialogues_in TEXT[] DEFAULT '{}', -- array index is soft id of sample dialogue pairs
  sample_dialogues_out TEXT[] DEFAULT '{}',
  autoch_counter INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Create updated_at trigger for tomoris table
DROP TRIGGER IF EXISTS update_tomoris_timestamp ON tomoris;
CREATE TRIGGER update_tomoris_timestamp
BEFORE UPDATE ON tomoris
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS llms (
  llm_id SERIAL PRIMARY KEY,
  llm_provider TEXT NOT NULL,
  llm_codename TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

SELECT add_column_if_not_exists('llms', 'is_smartest', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('llms', 'is_default', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('llms', 'is_reasoning', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('llms', 'is_deprecated', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('llms', 'is_free', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('llms', 'has_tools', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('llms', 'sees_images', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('llms', 'sees_videos', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('llms', 'sees_youtube', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('llms', 'is_uncensored', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('llms', 'supports_structoutput', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('llms', 'llm_description', 'TEXT');
SELECT add_column_if_not_exists('llms', 'ja_description', 'TEXT');


-- Create updated_at trigger for llms table
DROP TRIGGER IF EXISTS update_llms_timestamp ON llms;
CREATE TRIGGER update_llms_timestamp
BEFORE UPDATE ON llms
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Image Diffusion Models table for image generation models 
CREATE TABLE IF NOT EXISTS image_diffusion_models (
  diffusion_model_id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  codename TEXT NOT NULL UNIQUE,
  model_description TEXT,
  ja_description TEXT,
  is_default BOOLEAN DEFAULT false,
  is_deprecated BOOLEAN DEFAULT false,
  is_free BOOLEAN DEFAULT false,
  is_uncensored BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create updated_at trigger for image_diffusion_models table
DROP TRIGGER IF EXISTS update_image_diffusion_models_timestamp ON image_diffusion_models;
CREATE TRIGGER update_image_diffusion_models_timestamp
BEFORE UPDATE ON image_diffusion_models
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_image_diffusion_models_provider ON image_diffusion_models(provider);
CREATE INDEX IF NOT EXISTS idx_image_diffusion_models_default ON image_diffusion_models(is_default, is_deprecated);

CREATE TABLE IF NOT EXISTS tomori_configs (
  tomori_config_id SERIAL PRIMARY KEY,
  tomori_id INT NOT NULL UNIQUE,
  llm_id INT NOT NULL,
  llm_temperature REAL NOT NULL DEFAULT 1.5 CHECK (llm_temperature >= 1.0 AND llm_temperature <= 2.0),
  api_key BYTEA, -- encrypted
  trigger_words TEXT[] DEFAULT '{}',
  autoch_disc_ids TEXT[] DEFAULT '{}',
  autoch_threshold INT DEFAULT 0, -- set to 0 for no autoch
	server_memteaching_enabled BOOLEAN DEFAULT true,
	attribute_memteaching_enabled BOOLEAN DEFAULT false,
	sampledialogue_memteaching_enabled BOOLEAN DEFAULT false,
  self_teaching_enabled BOOLEAN DEFAULT true,
  personal_memories_enabled BOOLEAN DEFAULT true,
  humanizer_degree INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tomori_id) REFERENCES tomoris(tomori_id) ON DELETE CASCADE,
  FOREIGN KEY (llm_id) REFERENCES llms(llm_id) ON DELETE RESTRICT
);

-- Add columns for emoji and sticker usage permissions (May 5, 2025)
SELECT add_column_if_not_exists('tomori_configs', 'emoji_usage_enabled', 'BOOLEAN', 'true');
SELECT add_column_if_not_exists('tomori_configs', 'sticker_usage_enabled', 'BOOLEAN', 'true');

-- Add timezone offset column for server-wide timezone configuration 
SELECT add_column_if_not_exists('tomori_configs', 'timezone_offset', 'INTEGER', '0');

-- Rename google_search_enabled to web_search_enabled for Brave Search integration 
SELECT add_column_if_not_exists('tomori_configs', 'web_search_enabled', 'BOOLEAN', 'true');

-- Add pin message permission (November 2025)
SELECT add_column_if_not_exists('tomori_configs', 'pin_message_enabled', 'BOOLEAN', 'true');

-- Add diffusion model reference for image generation 
SELECT add_column_if_not_exists('tomori_configs', 'diffusion_model_id', 'INTEGER');

-- Add custom system prompt column (December 2025)
SELECT add_column_if_not_exists('tomori_configs', 'system_prompt', 'TEXT', 'NULL');

-- Add foreign key constraint if the column was just created
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'tomori_configs_diffusion_model_id_fkey'
    ) THEN
        ALTER TABLE tomori_configs
        ADD CONSTRAINT tomori_configs_diffusion_model_id_fkey
        FOREIGN KEY (diffusion_model_id)
        REFERENCES image_diffusion_models(diffusion_model_id)
        ON DELETE SET NULL;
    END IF;
END $$;

-- Migrate existing google_search_enabled values to web_search_enabled if the old column exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'tomori_configs' AND column_name = 'google_search_enabled') THEN
        -- Copy values from old column to new column
        UPDATE tomori_configs 
        SET web_search_enabled = google_search_enabled 
        WHERE web_search_enabled IS NULL OR web_search_enabled != google_search_enabled;
        
        -- Drop the old column
        ALTER TABLE tomori_configs DROP COLUMN IF EXISTS google_search_enabled;
        RAISE NOTICE 'Migrated google_search_enabled to web_search_enabled and dropped old column';
    END IF;
END $$;

-- Create updated_at trigger for tomori_configs table
DROP TRIGGER IF EXISTS update_tomori_configs_timestamp ON tomori_configs;
CREATE TRIGGER update_tomori_configs_timestamp
BEFORE UPDATE ON tomori_configs
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS tomori_presets (
  tomori_preset_id SERIAL PRIMARY KEY,
  tomori_preset_name TEXT NOT NULL UNIQUE,
  tomori_preset_desc TEXT NOT NULL,
  preset_attribute_list TEXT[] DEFAULT '{}',
  preset_sample_dialogues_in TEXT[] DEFAULT '{}', -- array index is soft id of sample dialogue pairs
  preset_sample_dialogues_out TEXT[] DEFAULT '{}',
  preset_language TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create updated_at trigger for tomori_presets table
DROP TRIGGER IF EXISTS update_tomori_presets_timestamp ON tomori_presets;
CREATE TRIGGER update_tomori_presets_timestamp
BEFORE UPDATE ON tomori_presets
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Add preset avatar path column for profile pictures 
SELECT add_column_if_not_exists('tomori_presets', 'preset_avatar_path', 'TEXT');

-- Table: system_prompt_presets
-- Purpose: Store pre-made system prompt presets that users can apply
CREATE TABLE IF NOT EXISTS system_prompt_presets (
  system_prompt_preset_id SERIAL PRIMARY KEY,
  system_prompt_preset_name TEXT NOT NULL UNIQUE,
  system_prompt_preset_desc TEXT NOT NULL,
  ja_description TEXT,
  preset_prompt_text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create updated_at trigger for system_prompt_presets table
DROP TRIGGER IF EXISTS update_system_prompt_presets_timestamp ON system_prompt_presets;
CREATE TRIGGER update_system_prompt_presets_timestamp
BEFORE UPDATE ON system_prompt_presets
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS server_emojis (
  server_emoji_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL,
  emoji_disc_id TEXT NOT NULL,
  emoji_name TEXT NOT NULL, -- e.g. TomoriGiggle -- Combine with emoji_disc_id for <:TomoriGiggle:123456789>
  emoji_desc TEXT DEFAULT '', -- Visual description of emoji (generated by LLM via /server emojis initialize)
  emotion_key TEXT, -- e.g. "joy", "sadness", "anger" (28 emotion categories, nullable if not initialized)
  is_global BOOLEAN DEFAULT false, -- If emoji is a Tomori global
  is_animated BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (server_id, emoji_disc_id),
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Add emoji_desc column for LLM-generated visual descriptions (December 2025)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'server_emojis'
        AND column_name = 'emoji_desc'
    ) THEN
        ALTER TABLE server_emojis ADD COLUMN emoji_desc TEXT DEFAULT '';
        RAISE NOTICE 'Added server_emojis.emoji_desc column';
    END IF;
END $$;

-- Migrate emotion_key to nullable for graceful degradation (December 2025)
-- This allows emojis without initialization to still function (name-only)
DO $$
BEGIN
    -- Check if emotion_key is currently NOT NULL
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'server_emojis'
        AND column_name = 'emotion_key'
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE server_emojis ALTER COLUMN emotion_key DROP NOT NULL;
        RAISE NOTICE 'Made server_emojis.emotion_key nullable';
    END IF;
END $$;

-- Create updated_at trigger for server_emojis table
DROP TRIGGER IF EXISTS update_server_emojis_timestamp ON server_emojis;
CREATE TRIGGER update_server_emojis_timestamp
BEFORE UPDATE ON server_emojis
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS server_stickers (
  server_sticker_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL,
  sticker_disc_id TEXT NOT NULL,
  sticker_name TEXT NOT NULL, -- e.g. Send as message payload
  sticker_desc TEXT DEFAULT '', -- Visual description of sticker (generated by LLM via /server stickers initialize)
  emotion_key TEXT, -- e.g. "joy", "sadness", "anger" (28 emotion categories, nullable if not initialized)
  is_global BOOLEAN DEFAULT false, -- If sticker is a Tomori global
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (server_id, sticker_disc_id),
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

SELECT add_column_if_not_exists('server_stickers', 'sticker_format', 'INT', '1'); -- Default to PNG (1)
-- Drop the old is_animated column from server_stickers (May 5, 2025)
SELECT drop_column_if_exists('server_stickers', 'is_animated');

-- Migrate emotion_key to nullable for graceful degradation (December 2025)
-- This allows stickers without initialization to still function (name-only)
DO $$
BEGIN
    -- Check if emotion_key is currently NOT NULL
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'server_stickers'
        AND column_name = 'emotion_key'
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE server_stickers ALTER COLUMN emotion_key DROP NOT NULL;
        RAISE NOTICE 'Made server_stickers.emotion_key nullable';
    END IF;
END $$;

-- Create updated_at trigger for server_stickers table
DROP TRIGGER IF EXISTS update_server_stickers_timestamp ON server_stickers;
CREATE TRIGGER update_server_stickers_timestamp
BEFORE UPDATE ON server_stickers
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  user_disc_id TEXT UNIQUE NOT NULL,
  user_nickname TEXT NOT NULL,
  language_pref TEXT DEFAULT 'en',
  personal_memories TEXT[] DEFAULT '{}',
  privacy_opt_out BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_disc_id ON users(user_disc_id);

-- Add registration_locale column for user region analytics 
SELECT add_column_if_not_exists('users', 'registration_locale', 'TEXT');

-- Create updated_at trigger for users table
DROP TRIGGER IF EXISTS update_users_timestamp ON users;
CREATE TRIGGER update_users_timestamp
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Migration: Add privacy_opt_out column if it doesn't exist (for existing databases)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'privacy_opt_out'
    ) THEN
        ALTER TABLE users ADD COLUMN privacy_opt_out BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS server_memories (
  server_memory_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL,
  user_id INT, -- Creator of this server memory (nullable - set to NULL if user deleted)
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Create updated_at trigger for server_memories table
DROP TRIGGER IF EXISTS update_server_memories_timestamp ON server_memories;
CREATE TRIGGER update_server_memories_timestamp
BEFORE UPDATE ON server_memories
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS personalization_blacklist (
  server_id INT NOT NULL,
  user_disc_id TEXT NOT NULL, -- Discord ID of user who opted out (persists even if user deletes account)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (server_id, user_disc_id), -- composite key
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Create updated_at trigger for personalization_blacklist table
DROP TRIGGER IF EXISTS update_personalization_blacklist_timestamp ON personalization_blacklist;
CREATE TRIGGER update_personalization_blacklist_timestamp
BEFORE UPDATE ON personalization_blacklist
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS error_logs (
  error_log_id SERIAL PRIMARY KEY,
  -- Context IDs - Made nullable as errors can happen outside these contexts
  tomori_id INT NULL,
  user_id INT NULL,
  server_id INT NULL,
  -- Error Details
  error_type TEXT NOT NULL DEFAULT 'GenericError', -- Type/category of error
  error_message TEXT NOT NULL,                     -- Main error message
  stack_trace TEXT NULL,                           -- Dedicated column for stack trace
  error_metadata JSONB DEFAULT '{}',               -- Flexible JSON for extra context
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Foreign Keys - Changed to SET NULL to preserve logs even if related entity is deleted
  FOREIGN KEY (tomori_id) REFERENCES tomoris(tomori_id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE SET NULL
);

-- Create updated_at trigger for error_logs table
DROP TRIGGER IF EXISTS update_error_logs_timestamp ON error_logs;
CREATE TRIGGER update_error_logs_timestamp
BEFORE UPDATE ON error_logs
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Unlogged table for command cooldowns
CREATE UNLOGGED TABLE IF NOT EXISTS cooldowns (
    user_disc_id TEXT NOT NULL,
    command_category TEXT NOT NULL,
    expiry_time BIGINT NOT NULL,
    PRIMARY KEY (user_disc_id, command_category)
);

-- Function to periodically clean up expired cooldowns
CREATE OR REPLACE FUNCTION cleanup_expired_cooldowns()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM cooldowns
    WHERE expiry_time < EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Make sure pgcrypto extension is enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Optional API keys table for encrypted storage of optional service credentials per guild
CREATE TABLE IF NOT EXISTS opt_api_keys (
  opt_api_key_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL,                    -- Foreign key to servers table
  service_name TEXT NOT NULL,                -- 'brave-search', 'duckduckgo-search', etc.
  api_key BYTEA,                            -- Encrypted API key using pgcrypto
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (server_id, service_name),         -- One key per service per guild
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Create updated_at trigger for opt_api_keys table
DROP TRIGGER IF EXISTS update_opt_api_keys_timestamp ON opt_api_keys;
CREATE TRIGGER update_opt_api_keys_timestamp
BEFORE UPDATE ON opt_api_keys
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- pg_cron setup has been moved to a separate file: src/db/pgcron.sql
-- This allows optional execution based on the environment (production vs development)

-- Reminders table for user reminder functionality
CREATE TABLE IF NOT EXISTS reminders (
  reminder_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL,
  channel_disc_id TEXT NOT NULL,                       -- Discord channel ID where reminder was set
  user_discord_id TEXT NOT NULL,                       -- Target user's Discord ID
  user_nickname TEXT NOT NULL,                         -- Target user's nickname for display
  reminder_purpose TEXT NOT NULL,                      -- What the reminder is for
  reminder_time TIMESTAMP WITH TIME ZONE NOT NULL,     -- When to trigger the reminder
  created_by_user_id INT,                              -- User who created this reminder (nullable - set to NULL if user deleted)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Create index for efficient reminder queries
CREATE INDEX IF NOT EXISTS idx_reminders_time ON reminders(reminder_time);
CREATE INDEX IF NOT EXISTS idx_reminders_server_id ON reminders(server_id);

-- Create updated_at trigger for reminders table
DROP TRIGGER IF EXISTS update_reminders_timestamp ON reminders;
CREATE TRIGGER update_reminders_timestamp
BEFORE UPDATE ON reminders
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Drop deprecated columns 
SELECT drop_column_if_exists('tomori_configs', 'teach_cost');
SELECT drop_column_if_exists('tomori_configs', 'gamba_limit');
SELECT drop_column_if_exists('users', 'tomocoins_held');
SELECT drop_column_if_exists('users', 'tomocoins_deposited');

-- Add key_version column to opt_api_keys for encryption key rotation (November 2025)
SELECT add_column_if_not_exists('opt_api_keys', 'key_version', 'INTEGER', '1');
CREATE INDEX IF NOT EXISTS idx_opt_api_keys_version ON opt_api_keys(key_version);

-- Add key_version column to tomori_configs for main API key rotation (November 2025)
SELECT add_column_if_not_exists('tomori_configs', 'key_version', 'INTEGER', '1');
CREATE INDEX IF NOT EXISTS idx_tomori_configs_key_version ON tomori_configs(key_version);

-- Example usage - This shows how to add columns to existing tables
-- You can add these calls whenever you need to introduce schema changes
-- SELECT add_column_if_not_exists('tomori_configs', 'new_feature_flag', 'BOOLEAN', 'false');
-- SELECT add_column_if_not_exists('users', 'avatar_url', 'TEXT');
-- SELECT add_column_if_not_exists('tomoris', 'response_count', 'INT', '0');
