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
  server_id INT NOT NULL,
  tomori_nickname TEXT NOT NULL,
  attribute_list TEXT[] DEFAULT '{}',
  sample_dialogues_in TEXT[] DEFAULT '{}', -- array index is soft id of sample dialogue pairs
  sample_dialogues_out TEXT[] DEFAULT '{}',
  autoch_counter INT DEFAULT 0,
  autoch_next_target INT DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS discord_managed_webhooks (
  managed_webhook_id SERIAL PRIMARY KEY,
  guild_disc_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  channel_disc_id TEXT NOT NULL,
  webhook_disc_id TEXT NOT NULL,
  webhook_token BYTEA NOT NULL,
  key_version INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (kind, channel_disc_id),
  UNIQUE (webhook_disc_id)
);

CREATE INDEX IF NOT EXISTS idx_discord_managed_webhooks_guild ON discord_managed_webhooks(guild_disc_id);
CREATE INDEX IF NOT EXISTS idx_discord_managed_webhooks_channel ON discord_managed_webhooks(channel_disc_id);

DROP TRIGGER IF EXISTS update_discord_managed_webhooks_timestamp ON discord_managed_webhooks;
CREATE TRIGGER update_discord_managed_webhooks_timestamp
BEFORE UPDATE ON discord_managed_webhooks
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Add multi-persona support columns (January 2026)
-- is_alter: Distinguishes main persona (false) from alter personas (true)
SELECT add_column_if_not_exists('tomoris', 'is_alter', 'BOOLEAN', 'false');
-- webhook_avatar_url: Stores alter avatar reference (production URL; non-production URL or local avatar path)
SELECT add_column_if_not_exists('tomoris', 'webhook_avatar_url', 'TEXT');
-- alter_triggers: Trigger words for alter personas (main personas use tomori_configs.trigger_words)
SELECT add_column_if_not_exists('tomoris', 'alter_triggers', 'TEXT[]', 'ARRAY[]::TEXT[]');
-- persona_lineage_id: Shared identity namespace for cross-server personal memory pooling
SELECT add_column_if_not_exists('tomoris', 'persona_lineage_id', 'BIGINT');
-- nai_tags: Imageboard-style persona appearance tags for NovelAI character profile resolution
SELECT add_column_if_not_exists('tomoris', 'nai_tags', 'TEXT[]', 'ARRAY[]::TEXT[]');
-- nai_char_ref_url: Stored reference image URL/path for NovelAI character consistency
SELECT add_column_if_not_exists('tomoris', 'nai_char_ref_url', 'TEXT');
-- elevenlabs_voice_id: Selected ElevenLabs voice for this persona (server-local)
SELECT add_column_if_not_exists('tomoris', 'elevenlabs_voice_id', 'TEXT');
-- elevenlabs_voice_name: Cached friendly name for the selected ElevenLabs voice
SELECT add_column_if_not_exists('tomoris', 'elevenlabs_voice_name', 'TEXT');

-- Create lineage sequence (start high so reserved low IDs stay available)
CREATE SEQUENCE IF NOT EXISTS persona_lineage_id_seq
	INCREMENT BY 1
	MINVALUE 10000
	START WITH 10000;

-- Backfill missing lineage IDs for existing personas
DO $$
BEGIN
	UPDATE tomoris
	SET persona_lineage_id = nextval('persona_lineage_id_seq')
	WHERE persona_lineage_id IS NULL;

	-- Repair personas incorrectly assigned lineage ID 0 (reserved for global memories only, never a valid persona ID)
	UPDATE tomoris
	SET persona_lineage_id = nextval('persona_lineage_id_seq')
	WHERE persona_lineage_id = 0;
END $$;

-- Ensure future personas get lineage IDs automatically
ALTER TABLE tomoris
	ALTER COLUMN persona_lineage_id SET DEFAULT nextval('persona_lineage_id_seq');
ALTER TABLE tomoris
	ALTER COLUMN persona_lineage_id SET NOT NULL;

-- Ensure sequence advances beyond highest existing lineage or reserved floor
SELECT setval(
	'persona_lineage_id_seq',
	GREATEST((SELECT COALESCE(MAX(persona_lineage_id), 0) FROM tomoris), 10000),
	true
);

-- Drop old unique constraint on server_id (allows multiple personas per server)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tomoris_server_id_key'
    ) THEN
        ALTER TABLE tomoris DROP CONSTRAINT tomoris_server_id_key;
        RAISE NOTICE 'Dropped unique constraint tomoris_server_id_key to allow multiple personas per server';
    END IF;
END $$;

-- Create index for efficient multi-persona queries (main persona is queried frequently)
CREATE INDEX IF NOT EXISTS idx_tomoris_server_is_alter ON tomoris(server_id, is_alter);
CREATE INDEX IF NOT EXISTS idx_tomoris_persona_lineage_id ON tomoris(persona_lineage_id);

-- Normalize legacy duplicate persona names within a server before enforcing uniqueness.
-- Keep the highest-priority row unchanged (main persona first, then most-recent),
-- and append a deterministic suffix to lower-priority duplicates.
WITH ranked_persona_names AS (
	SELECT
		tomori_id,
		server_id,
		ROW_NUMBER() OVER (
			PARTITION BY server_id, lower(btrim(tomori_nickname))
			ORDER BY is_alter ASC, updated_at DESC NULLS LAST, tomori_id DESC
		) AS name_rank
	FROM tomoris
)
UPDATE tomoris t
SET tomori_nickname = t.tomori_nickname || ' [dup-' || t.tomori_id::TEXT || ']'
FROM ranked_persona_names r
WHERE t.tomori_id = r.tomori_id
  AND r.name_rank > 1;

-- Hard guardrail: persona names must be unique per server (case-insensitive, trimmed).
CREATE UNIQUE INDEX IF NOT EXISTS idx_tomoris_server_nickname_ci_unique
ON tomoris(server_id, lower(btrim(tomori_nickname)));

CREATE TABLE IF NOT EXISTS llms (
  llm_id SERIAL PRIMARY KEY,
  llm_provider TEXT NOT NULL,
  llm_codename TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Drop old single-column unique constraint if it exists (idempotent migration)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'llms_llm_codename_key' AND contype = 'u'
  ) THEN
    ALTER TABLE llms DROP CONSTRAINT llms_llm_codename_key;
    RAISE NOTICE 'Dropped old unique constraint llms_llm_codename_key';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not drop llms_llm_codename_key (may not exist): %', SQLERRM;
END $$;

-- Allow same codenames across different providers (e.g., gemini-2.5-flash via google AND vertex)
CREATE UNIQUE INDEX IF NOT EXISTS idx_llms_provider_codename
  ON llms(llm_provider, llm_codename);

SELECT add_column_if_not_exists('llms', 'is_smartest', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('llms', 'is_default', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('llms', 'is_reasoning', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('llms', 'is_scoped_registration', 'BOOLEAN', 'false');
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


-- Removed updated_at trigger for llms table (static metadata, rarely changes)
DROP TRIGGER IF EXISTS update_llms_timestamp ON llms;

-- Image Diffusion Models table for image generation models 
CREATE TABLE IF NOT EXISTS image_diffusion_models (
  diffusion_model_id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  codename TEXT NOT NULL,
  is_scoped_registration BOOLEAN DEFAULT false,
  model_description TEXT,
  ja_description TEXT,
  is_default BOOLEAN DEFAULT false,
  is_deprecated BOOLEAN DEFAULT false,
  is_free BOOLEAN DEFAULT false,
  is_uncensored BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Moved to prevent error on first-time DB creation!
SELECT add_column_if_not_exists('image_diffusion_models', 'is_scoped_registration', 'BOOLEAN', 'false');

-- Removed updated_at trigger for image_diffusion_models table (static metadata, rarely changes)
DROP TRIGGER IF EXISTS update_image_diffusion_models_timestamp ON image_diffusion_models;

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_image_diffusion_models_provider ON image_diffusion_models(provider);
CREATE INDEX IF NOT EXISTS idx_image_diffusion_models_default ON image_diffusion_models(is_default, is_deprecated);
CREATE UNIQUE INDEX IF NOT EXISTS idx_image_diffusion_models_provider_codename
  ON image_diffusion_models(provider, codename);

-- Video Generation Models table for video generation models
CREATE TABLE IF NOT EXISTS video_generation_models (
  video_model_id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  codename TEXT NOT NULL,
  is_scoped_registration BOOLEAN DEFAULT false,
  model_description TEXT,
  ja_description TEXT,
  is_default BOOLEAN DEFAULT false,
  is_deprecated BOOLEAN DEFAULT false,
  is_free BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Moved to prevent error on first-time DB creation!
SELECT add_column_if_not_exists('video_generation_models', 'is_scoped_registration', 'BOOLEAN', 'false');

-- Removed updated_at trigger for video_generation_models table (static metadata, rarely changes)
DROP TRIGGER IF EXISTS update_video_generation_models_timestamp ON video_generation_models;

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_video_generation_models_provider ON video_generation_models(provider);
CREATE INDEX IF NOT EXISTS idx_video_generation_models_default ON video_generation_models(is_default, is_deprecated);
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_generation_models_provider_codename
  ON video_generation_models(provider, codename);

-- Embedding Models table for document embedding/search
CREATE TABLE IF NOT EXISTS embedding_models (
  embedding_model_id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  codename TEXT NOT NULL,
  model_family TEXT NOT NULL,
  is_scoped_registration BOOLEAN DEFAULT false,
  model_description TEXT,
  ja_description TEXT,
  is_default BOOLEAN DEFAULT false,
  is_deprecated BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Moved to prevent error on first-time DB creation!
SELECT add_column_if_not_exists('embedding_models', 'is_scoped_registration', 'BOOLEAN', 'false');

-- Removed updated_at trigger for embedding_models table (static metadata, rarely changes)
DROP TRIGGER IF EXISTS update_embedding_models_timestamp ON embedding_models;

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_embedding_models_provider ON embedding_models(provider);
CREATE INDEX IF NOT EXISTS idx_embedding_models_default ON embedding_models(is_default, is_deprecated);
CREATE INDEX IF NOT EXISTS idx_embedding_models_family ON embedding_models(model_family);
CREATE UNIQUE INDEX IF NOT EXISTS idx_embedding_models_provider_codename
  ON embedding_models(provider, codename);

SELECT add_column_if_not_exists('image_diffusion_models', 'is_scoped_registration', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('video_generation_models', 'is_scoped_registration', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('embedding_models', 'is_scoped_registration', 'BOOLEAN', 'false');

-- Allow the same codename to exist under different providers for model metadata tables.
DO $$
BEGIN
  ALTER TABLE image_diffusion_models DROP CONSTRAINT IF EXISTS image_diffusion_models_codename_key;
  DROP INDEX IF EXISTS image_diffusion_models_codename_key;

  ALTER TABLE video_generation_models DROP CONSTRAINT IF EXISTS video_generation_models_codename_key;
  DROP INDEX IF EXISTS video_generation_models_codename_key;

  ALTER TABLE embedding_models DROP CONSTRAINT IF EXISTS embedding_models_codename_key;
  DROP INDEX IF EXISTS embedding_models_codename_key;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Model metadata table missing while relaxing codename uniqueness; skipping';
END $$;

CREATE TABLE IF NOT EXISTS tomori_configs (
  tomori_config_id SERIAL PRIMARY KEY,
  tomori_id INT UNIQUE, -- Legacy pointer (nullable; server_id is the primary linkage)
  server_id INT, -- Server-scoped config (nullable for legacy rows)
  llm_id INT,
  embedding_model_id INT,
  llm_temperature REAL NOT NULL DEFAULT 1.0 CHECK (llm_temperature >= 0.0 AND llm_temperature <= 2.0), -- DEPRECATED Phase 1.5 Pass B: mirror of saved_provider_configs; drop after checklist passes
  api_key BYTEA, -- encrypted; DEPRECATED Phase 1.5 Pass B: mirror of saved_provider_configs.api_key
  trigger_words TEXT[] DEFAULT '{}',
  autoch_disc_ids TEXT[] DEFAULT '{}',
  autoch_persona_overrides JSONB DEFAULT '[]'::JSONB,
  autoch_threshold INT DEFAULT 0, -- 0 with configured channels means always-reply, otherwise minimum messages before auto-chat
  autoch_threshold_max INT DEFAULT 0, -- 0 keeps fixed/always behavior; > autoch_threshold enables a shared random range
  message_fetch_limit INT DEFAULT 80,
	server_memteaching_enabled BOOLEAN DEFAULT true,
	attribute_memteaching_enabled BOOLEAN DEFAULT false,
  sampledialogue_memteaching_enabled BOOLEAN DEFAULT false,
  self_teaching_enabled BOOLEAN DEFAULT true,
  personal_memories_enabled BOOLEAN DEFAULT true,
  memory_tagging_enabled BOOLEAN DEFAULT false,
  channel_memory_enabled BOOLEAN DEFAULT false,
  imagegen_enabled BOOLEAN DEFAULT true,
  videogen_enabled BOOLEAN DEFAULT false,
  thread_creation_enabled BOOLEAN DEFAULT true,
  tool_notice_hidden_keys TEXT[] DEFAULT '{}',
  llm_disabled_params TEXT[] DEFAULT '{}', -- DEPRECATED Phase 1.5 Pass B: mirror of saved_provider_configs
  llm_stop_strings TEXT[] DEFAULT '{}',
  llm_stop_speaker_pattern_enabled BOOLEAN DEFAULT false,
  humanizer_degree INT DEFAULT 1,
  thinking_level TEXT DEFAULT 'auto', -- DEPRECATED Phase 1.5 Pass B: mirror of saved_provider_configs
  user_byok_mode BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tomori_id) REFERENCES tomoris(tomori_id) ON DELETE SET NULL,
  FOREIGN KEY (llm_id) REFERENCES llms(llm_id) ON DELETE RESTRICT
);

-- Persona-scoped config table (trigger words + optional persona prompt)
CREATE TABLE IF NOT EXISTS persona_configs (
  tomori_id INT PRIMARY KEY,
  trigger_words TEXT[] DEFAULT '{}',
  persona_prompt TEXT NULL,
  reward_conditioning_enabled BOOLEAN DEFAULT true,
  punish_conditioning_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tomori_id) REFERENCES tomoris(tomori_id) ON DELETE CASCADE
);

-- Create updated_at trigger for persona_configs table
DROP TRIGGER IF EXISTS update_persona_configs_timestamp ON persona_configs;
CREATE TRIGGER update_persona_configs_timestamp
BEFORE UPDATE ON persona_configs
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Backfill persona_configs trigger words from legacy locations
INSERT INTO persona_configs (tomori_id, trigger_words)
SELECT
	t.tomori_id,
	CASE
		WHEN t.is_alter THEN COALESCE(t.alter_triggers, ARRAY[]::TEXT[])
		ELSE COALESCE(tc_server.trigger_words, tc_legacy.trigger_words, ARRAY[]::TEXT[])
	END AS trigger_words
FROM tomoris t
LEFT JOIN LATERAL (
	SELECT trigger_words
	FROM tomori_configs
	WHERE server_id = t.server_id
	ORDER BY updated_at DESC NULLS LAST, tomori_config_id DESC
	LIMIT 1
) tc_server ON true
LEFT JOIN LATERAL (
	SELECT trigger_words
	FROM tomori_configs
	WHERE tomori_id = t.tomori_id
	ORDER BY updated_at DESC NULLS LAST, tomori_config_id DESC
	LIMIT 1
) tc_legacy ON true
ON CONFLICT (tomori_id) DO NOTHING;

-- Add persona conditioning toggles (April 2026)
SELECT add_column_if_not_exists('persona_configs', 'reward_conditioning_enabled', 'BOOLEAN', 'true');
SELECT add_column_if_not_exists('persona_configs', 'punish_conditioning_enabled', 'BOOLEAN', 'true');

-- Add server_id column for server-scoped configs (January 2026)
SELECT add_column_if_not_exists('tomori_configs', 'server_id', 'INTEGER');

-- Add hide_impersonation_embeds permission (February 2026)
SELECT add_column_if_not_exists('tomori_configs', 'hide_impersonation_embeds', 'BOOLEAN', 'false');

-- Allow tomori_id to be nullable and prevent cascade deletes from removing server-scoped config
DO $$
DECLARE
    fk_delete_action CHAR;
BEGIN
    -- Drop NOT NULL if present
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tomori_configs'
        AND column_name = 'tomori_id'
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE tomori_configs ALTER COLUMN tomori_id DROP NOT NULL;
    END IF;

    -- Detect current FK delete action (if any)
    SELECT confdeltype INTO fk_delete_action
    FROM pg_constraint
    WHERE conname = 'tomori_configs_tomori_id_fkey';

    -- Recreate FK with ON DELETE SET NULL if needed
    IF fk_delete_action IS NULL OR fk_delete_action <> 'n' THEN
        ALTER TABLE tomori_configs DROP CONSTRAINT IF EXISTS tomori_configs_tomori_id_fkey;
        ALTER TABLE tomori_configs
        ADD CONSTRAINT tomori_configs_tomori_id_fkey
        FOREIGN KEY (tomori_id)
        REFERENCES tomoris(tomori_id)
        ON DELETE SET NULL;
    END IF;
END $$;

-- Backfill server_id for main persona configs (legacy rows)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tomori_configs' AND column_name = 'server_id'
    ) THEN
        UPDATE tomori_configs tc
        SET server_id = t.server_id
        FROM tomoris t
        WHERE tc.server_id IS NULL
          AND tc.tomori_id = t.tomori_id
          AND t.is_alter = false;
    END IF;
END $$;

-- Add foreign key to servers for server-scoped config
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'tomori_configs_server_id_fkey'
    ) THEN
        ALTER TABLE tomori_configs
        ADD CONSTRAINT tomori_configs_server_id_fkey
        FOREIGN KEY (server_id)
        REFERENCES servers(server_id)
        ON DELETE CASCADE;
    END IF;
END $$;

-- Create unique index on server_id if no duplicates (NULLs allowed)
DO $$
DECLARE
    duplicate_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO duplicate_count
    FROM (
        SELECT server_id
        FROM tomori_configs
        WHERE server_id IS NOT NULL
        GROUP BY server_id
        HAVING COUNT(*) > 1
    ) duplicates;

    IF duplicate_count = 0 THEN
        EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_tomori_configs_server_id_unique ON tomori_configs(server_id) WHERE server_id IS NOT NULL';
    ELSE
        RAISE NOTICE 'Skipped unique index on tomori_configs.server_id due to duplicates';
    END IF;
END $$;

-- Non-unique index for server_id lookups (fallback if unique index skipped)
CREATE INDEX IF NOT EXISTS idx_tomori_configs_server_id ON tomori_configs(server_id);

-- Add columns for emoji and sticker usage permissions (May 5, 2025)
SELECT add_column_if_not_exists('tomori_configs', 'emoji_usage_enabled', 'BOOLEAN', 'true');
SELECT add_column_if_not_exists('tomori_configs', 'sticker_usage_enabled', 'BOOLEAN', 'true');

-- Add timezone offset column for server-wide timezone configuration 
SELECT add_column_if_not_exists('tomori_configs', 'timezone_offset', 'INTEGER', '0');

-- Rename google_search_enabled to web_search_enabled for Brave Search integration 
SELECT add_column_if_not_exists('tomori_configs', 'web_search_enabled', 'BOOLEAN', 'true');

-- Add message management permission (November 2025)
SELECT add_column_if_not_exists('tomori_configs', 'manage_message_enabled', 'BOOLEAN', 'true');

-- Add thread creation permission (May 2026)
SELECT add_column_if_not_exists('tomori_configs', 'thread_creation_enabled', 'BOOLEAN', 'true');

-- Add image generation permission
SELECT add_column_if_not_exists('tomori_configs', 'imagegen_enabled', 'BOOLEAN', 'true');

-- Add hide respond embed permission (January 2026)
SELECT add_column_if_not_exists('tomori_configs', 'hide_respond_embed', 'BOOLEAN', 'false');

-- Add self-debug permission (March 2026)
-- When enabled, Tomori ingests her own error embeds into context as [System: ...] lines
SELECT add_column_if_not_exists('tomori_configs', 'self_debug_enabled', 'BOOLEAN', 'false');

-- Add uncensor feature toggles (February 2026)
SELECT add_column_if_not_exists('tomori_configs', 'uncensor_injection_enabled', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('tomori_configs', 'uncensor_unicode_space_enabled', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('tomori_configs', 'uncensor_sanitize_enabled', 'BOOLEAN', 'false');

-- Add video generation permission
SELECT add_column_if_not_exists('tomori_configs', 'videogen_enabled', 'BOOLEAN', 'false');
ALTER TABLE tomori_configs ALTER COLUMN videogen_enabled SET DEFAULT false;

-- Add video model reference for video generation
SELECT add_column_if_not_exists('tomori_configs', 'video_model_id', 'INTEGER');

-- Add diffusion model reference for image generation 
SELECT add_column_if_not_exists('tomori_configs', 'diffusion_model_id', 'INTEGER');

-- Add embedding model reference for document embedding
SELECT add_column_if_not_exists('tomori_configs', 'embedding_model_id', 'INTEGER');

-- Add custom system prompt column (December 2025)
SELECT add_column_if_not_exists('tomori_configs', 'system_prompt', 'TEXT', 'NULL');

-- Add message trigger cooldown columns (January 2026)
-- cooldown_type: 0=off, 1=per-user, 2=per-channel, 3=server-wide (managers exempt), 4=strict server-wide
SELECT add_column_if_not_exists('tomori_configs', 'cooldown_type', 'INTEGER', '0');
-- cooldown_length: Duration in seconds (1-86400, default 5)
SELECT add_column_if_not_exists('tomori_configs', 'cooldown_length', 'INTEGER', '5');

-- Cascade trigger limit for persona triggering (January 2026, renamed April 2026)
-- 0 = first trigger only, default 3, max 10 enforced by command validation
-- Renamed from self_reply_limit to cascade_limit
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tomori_configs' AND column_name = 'self_reply_limit')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tomori_configs' AND column_name = 'cascade_limit') THEN
    ALTER TABLE tomori_configs RENAME COLUMN self_reply_limit TO cascade_limit;
  END IF;
END $$;
SELECT add_column_if_not_exists('tomori_configs', 'cascade_limit', 'INTEGER', '3');

-- Per-message match limit cap (February 2026, renamed April 2026)
-- Minimum 1, default 3, max 10 enforced by command validation
-- Renamed from triggered_persona_limit to match_limit
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tomori_configs' AND column_name = 'triggered_persona_limit')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tomori_configs' AND column_name = 'match_limit') THEN
    ALTER TABLE tomori_configs RENAME COLUMN triggered_persona_limit TO match_limit;
  END IF;
END $$;
SELECT add_column_if_not_exists('tomori_configs', 'match_limit', 'INTEGER', '3');

-- Per-server history fetch limit for context building (February 2026)
-- Min 20, max 100 enforced by command and schema validation
SELECT add_column_if_not_exists('tomori_configs', 'message_fetch_limit', 'INTEGER', '80');

-- Send message limit (March 2026)
-- Caps the number of Discord messages sent per response (0 = unlimited, capped by MAX_FLUSH_COUNT)
-- Each message is a semantically complete chunk, so this produces clean cutoffs unlike maxOutputTokens
SELECT add_column_if_not_exists('tomori_configs', 'send_message_limit', 'INTEGER', '0');

-- Always-reply mode (March 2026)
-- When enabled, main persona replies to all user messages in guild channels (like DMs)
-- Alter personas still require explicit trigger words; main persona defers if an alter is triggered
SELECT add_column_if_not_exists('tomori_configs', 'always_reply_enabled', 'BOOLEAN', 'false');

-- Deliberate trigger mode (April 2026)
-- When enabled, plain {trigger} words are blocked; only @{trigger}, replies, mentions, and /bot respond work
SELECT add_column_if_not_exists('tomori_configs', 'deliberate_trigger_mode', 'BOOLEAN', 'false');

-- Auto-chat shared range state (March 2026)
SELECT add_column_if_not_exists('tomoris', 'autoch_next_target', 'INTEGER', '0');
SELECT add_column_if_not_exists('tomori_configs', 'autoch_threshold_max', 'INTEGER', '0');
UPDATE tomori_configs
SET autoch_threshold_max = autoch_threshold
WHERE COALESCE(autoch_threshold, 0) > 0
  AND COALESCE(autoch_threshold_max, 0) = 0;

-- Add custom endpoint URL for self-hosted OpenAI-compatible LLM endpoints (January 2026)
-- DEPRECATED Phase 3 rollout: legacy inline custom field kept only for backward compatibility while labeled custom_endpoints takes over.
SELECT add_column_if_not_exists('tomori_configs', 'custom_endpoint_url', 'TEXT');

-- Add custom model name for custom endpoints (January 2026)
-- DEPRECATED Phase 3 rollout: legacy inline custom field kept only for backward compatibility while labeled custom_endpoints takes over.
SELECT add_column_if_not_exists('tomori_configs', 'custom_model_name', 'TEXT');

-- Add context window size for custom endpoints (April 2026)
-- DEPRECATED Phase 3 rollout: legacy inline custom field kept only for backward compatibility while labeled custom_endpoints takes over.
SELECT add_column_if_not_exists('tomori_configs', 'custom_num_ctx', 'INT');

-- Add provider-agnostic thinking level hint (April 2026)
-- DEPRECATED Phase 1.5 Pass B: thinking_level is now canonical in saved_provider_configs
SELECT add_column_if_not_exists('tomori_configs', 'thinking_level', 'TEXT', '''auto''');

-- Add RP channel IDs for per-channel emoji/sticker suppression (February 2026)
-- Channels in this list always suppress emojis and stickers regardless of global settings
SELECT add_column_if_not_exists('tomori_configs', 'rp_channel_ids', 'TEXT[]', 'ARRAY[]::TEXT[]');

-- Add private channel IDs for STM isolation and thought-log suppression (March 2026)
-- STMs created in these channels cannot leak into other channels, and thought logs are never emitted from them
SELECT add_column_if_not_exists('tomori_configs', 'private_channel_ids', 'TEXT[]', 'ARRAY[]::TEXT[]');

-- Add STM privacy bypass flag (April 2026)
-- When TRUE, private-channel STMs are allowed to leak into non-private channels (bypasses default isolation)
SELECT add_column_if_not_exists('tomori_configs', 'stm_privacy_bypass', 'BOOLEAN', 'FALSE');

-- Add cross-channel blocklist channel IDs (April 2026)
-- Channels in this list cannot be targeted by the cross_channel_message tool; forum/media parents also block thread visits
SELECT add_column_if_not_exists('tomori_configs', 'crosschannel_blocklist_ids', 'TEXT[]', 'ARRAY[]::TEXT[]');

-- Add welcome channel configuration (March 2026)
-- One configured channel/prompt/persona per server for join greetings
SELECT add_column_if_not_exists('tomori_configs', 'welcome_channel_disc_id', 'TEXT', 'NULL');
SELECT add_column_if_not_exists('tomori_configs', 'thought_log_channel_disc_id', 'TEXT', 'NULL');
SELECT add_column_if_not_exists('tomori_configs', 'welcome_prompt', 'TEXT', 'NULL');
SELECT add_column_if_not_exists('tomori_configs', 'welcome_persona_id', 'INTEGER', 'NULL');
SELECT add_column_if_not_exists('tomori_configs', 'autoch_persona_overrides', 'JSONB', '''[]''::JSONB');

-- Add hidden notice embed registry (April 2026)
-- Stores hidden notice keys only; missing entries remain visible by default
SELECT add_column_if_not_exists('tomori_configs', 'tool_notice_hidden_keys', 'TEXT[]', 'ARRAY[]::TEXT[]');

-- Add server-defined deliberate tool trigger phrases (May 2026)
-- JSON object keyed by deliberate tool target, with arrays of literal trigger phrases
SELECT add_column_if_not_exists('tomori_configs', 'deliberate_tool_triggers', 'JSONB', '''{}''::JSONB');
-- Number of following channel turns where a successfully used tool remains available in deliberate tool mode.
-- NULL uses DELIBERATE_TOOL_CONTEXT_TURNS (default 4); 0 disables retained tool context.
SELECT add_column_if_not_exists('tomori_configs', 'deliberate_tool_context_turns', 'INTEGER', 'NULL');

-- Add LLM sampling parameter columns (February 2026)
-- DEPRECATED Phase 1.5 Pass B: all sampler columns are now canonical in saved_provider_configs
-- llm_top_p: Nucleus sampling — probability mass threshold (0.95=default, 0.0=most restricted)
SELECT add_column_if_not_exists('tomori_configs', 'llm_top_p', 'REAL', '0.95');
-- llm_top_k: Top-K sampling — candidate token count (0=neutral/disabled, max 40)
SELECT add_column_if_not_exists('tomori_configs', 'llm_top_k', 'INTEGER', '0');
-- llm_frequency_penalty: Penalize frequently used tokens (-2.0 to 2.0, 0.0=neutral)
SELECT add_column_if_not_exists('tomori_configs', 'llm_frequency_penalty', 'REAL', '0.0');
-- llm_presence_penalty: Penalize already-used topics (-2.0 to 2.0, 0.0=neutral)
SELECT add_column_if_not_exists('tomori_configs', 'llm_presence_penalty', 'REAL', '0.0');
-- llm_min_p: Minimum probability threshold sampling (0.05=default, 1.0=most restricted)
SELECT add_column_if_not_exists('tomori_configs', 'llm_min_p', 'REAL', '0.05');
-- llm_disabled_params: Parameter names omitted from outbound provider payloads
SELECT add_column_if_not_exists('tomori_configs', 'llm_disabled_params', 'TEXT[]', 'ARRAY[]::TEXT[]');
SELECT add_column_if_not_exists('tomori_configs', 'llm_stop_strings', 'TEXT[]', 'ARRAY[]::TEXT[]');
SELECT add_column_if_not_exists('tomori_configs', 'llm_stop_speaker_pattern_enabled', 'BOOLEAN', 'false');
-- llm_logit_biases: Stored OpenAI-style logit bias entries [{id, text, value}, ...]
SELECT add_column_if_not_exists('tomori_configs', 'llm_logit_biases', 'JSONB', '''[]''::JSONB');

-- Migration: Update llm_temperature range from [1.0, 2.0] to [0.0, 2.0] and default from 1.2 to 1.0 (March 2026)
DO $$
BEGIN
    -- Drop the old CHECK constraint (name may vary across deployments)
    EXECUTE (
        SELECT 'ALTER TABLE tomori_configs DROP CONSTRAINT ' || conname
        FROM pg_constraint
        WHERE conrelid = 'tomori_configs'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%llm_temperature%'
        LIMIT 1
    );
EXCEPTION WHEN OTHERS THEN
    -- No existing constraint found — that's fine
    NULL;
END $$;
ALTER TABLE tomori_configs ADD CONSTRAINT tomori_configs_llm_temperature_check
    CHECK (llm_temperature >= 0.0 AND llm_temperature <= 2.0);
ALTER TABLE tomori_configs ALTER COLUMN llm_temperature SET DEFAULT 1.0;

-- Migration: update llm_min_p default from 0.0 to 0.05 (April 2026)
ALTER TABLE tomori_configs ALTER COLUMN llm_min_p SET DEFAULT 0.05;

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

-- Add foreign key constraint for video model if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'tomori_configs_video_model_id_fkey'
    ) THEN
        ALTER TABLE tomori_configs
        ADD CONSTRAINT tomori_configs_video_model_id_fkey
        FOREIGN KEY (video_model_id)
        REFERENCES video_generation_models(video_model_id)
        ON DELETE SET NULL;
    END IF;
END $$;

-- Add foreign key constraint for embedding model if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'tomori_configs_embedding_model_id_fkey'
    ) THEN
        ALTER TABLE tomori_configs
        ADD CONSTRAINT tomori_configs_embedding_model_id_fkey
        FOREIGN KEY (embedding_model_id)
        REFERENCES embedding_models(embedding_model_id)
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

-- Add tool-use master toggle (April 2026)
-- When FALSE, has_tools is artificially overridden to false in the pipeline for all models
SELECT add_column_if_not_exists('tomori_configs', 'tool_use_enabled', 'BOOLEAN', 'true');
-- Deliberate tool mode (May 2026)
-- When TRUE, tool declarations/instructions are omitted unless a turn has explicit tool intent
SELECT add_column_if_not_exists('tomori_configs', 'deliberate_tool_mode', 'BOOLEAN', 'false');

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
  preset_trigger_words TEXT[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Removed updated_at trigger for tomori_presets table (static metadata, rarely changes)
DROP TRIGGER IF EXISTS update_tomori_presets_timestamp ON tomori_presets;

-- Add preset avatar path column for profile pictures 
SELECT add_column_if_not_exists('tomori_presets', 'preset_avatar_path', 'TEXT');
SELECT add_column_if_not_exists('tomori_presets', 'preset_trigger_words', 'TEXT[]', 'ARRAY[]::TEXT[]');

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

-- Removed updated_at trigger for system_prompt_presets table (static metadata, rarely changes)
DROP TRIGGER IF EXISTS update_system_prompt_presets_timestamp ON system_prompt_presets;

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

-- Removed updated_at trigger for server_emojis table (uses DELETE+INSERT refresh pattern, not real updates)
DROP TRIGGER IF EXISTS update_server_emojis_timestamp ON server_emojis;

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

-- Removed updated_at trigger for server_stickers table (uses DELETE+INSERT refresh pattern, not real updates)
DROP TRIGGER IF EXISTS update_server_stickers_timestamp ON server_stickers;

CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  user_disc_id TEXT UNIQUE NOT NULL,
  user_nickname TEXT NOT NULL,
  language_pref TEXT DEFAULT 'en',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_disc_id ON users(user_disc_id);

-- Add registration_locale column for user region analytics
SELECT add_column_if_not_exists('users', 'registration_locale', 'TEXT');

-- Add cross-server short-term memory sharing opt-in (Phase 1: Short-term memory system)
SELECT add_column_if_not_exists('users', 'shortterm_cache_crossserver_opt_in', 'BOOLEAN', 'false');

-- User-specific NovelAI character tags (March 2026)
SELECT add_column_if_not_exists('users', 'nai_char_tags', 'TEXT[]', 'ARRAY[]::TEXT[]');
-- User-specific NovelAI character reference image (March 2026)
SELECT add_column_if_not_exists('users', 'nai_char_ref_url', 'TEXT');
-- User-specific prompt used during /bot impersonate user-mode replies (March 2026)
SELECT add_column_if_not_exists('users', 'impersonation_prompt', 'TEXT');
-- Personal deliberate trigger mode (April 2026) - User-scoped DTM tri-state: 'off', 'follow' (default), 'on'
-- If column exists as BOOLEAN (old schema), convert to TEXT preserving intent (true → 'on', false → 'follow')
-- If column does not exist, add it as TEXT directly
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'personal_dtm' AND data_type = 'boolean'
  ) THEN
    ALTER TABLE users ALTER COLUMN personal_dtm DROP DEFAULT;
    ALTER TABLE users ALTER COLUMN personal_dtm TYPE TEXT
      USING CASE WHEN personal_dtm = TRUE THEN 'on' ELSE 'follow' END;
    ALTER TABLE users ALTER COLUMN personal_dtm SET DEFAULT 'follow';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'personal_dtm'
  ) THEN
    ALTER TABLE users ADD COLUMN personal_dtm TEXT DEFAULT 'follow';
  END IF;
END;
$$;

-- Personal deliberate tool mode (May 2026) - User-scoped tri-state: 'off', 'follow' (default), 'on'
SELECT add_column_if_not_exists('users', 'personal_deliberate_tool_mode', 'TEXT', '''follow''');

-- Create updated_at trigger for users table
DROP TRIGGER IF EXISTS update_users_timestamp ON users;
CREATE TRIGGER update_users_timestamp
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Migration: Convert privacy_opt_out (BOOLEAN) to privacy_level (INTEGER)
-- Level 0 = MINIMAL privacy (full features, opted in), Level 1 = PARTIAL, Level 2 = FULL privacy (opted out)
DO $$
BEGIN
    -- Step 1: Add privacy_level column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'privacy_level'
    ) THEN
        ALTER TABLE users ADD COLUMN privacy_level INTEGER DEFAULT 0;
        RAISE NOTICE 'Added users.privacy_level column';
    END IF;

    -- Step 2: Migrate existing data from privacy_opt_out (only if old column exists)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'privacy_opt_out'
    ) THEN
        UPDATE users
        SET privacy_level = CASE
            WHEN privacy_opt_out = true THEN 2  -- Opted out → FULL privacy
            WHEN privacy_opt_out = false THEN 0  -- Opted in → MINIMAL privacy
            ELSE 0  -- Default to MINIMAL for NULL values
        END
        WHERE privacy_opt_out IS NOT NULL;

        RAISE NOTICE 'Migrated privacy_opt_out to privacy_level';

        -- Step 3: Drop old column after successful migration
        ALTER TABLE users DROP COLUMN IF EXISTS privacy_opt_out;
        RAISE NOTICE 'Dropped deprecated privacy_opt_out column';
    END IF;

    -- Step 4: Ensure privacy_level has NOT NULL constraint and valid range
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users'
        AND column_name = 'privacy_level'
        AND is_nullable = 'YES'
    ) THEN
        -- Set default for existing NULL values
        UPDATE users SET privacy_level = 0 WHERE privacy_level IS NULL;

        -- Add NOT NULL constraint
        ALTER TABLE users ALTER COLUMN privacy_level SET NOT NULL;

        -- Add CHECK constraint for valid levels (0, 1, 2)
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_privacy_level_check;
        ALTER TABLE users ADD CONSTRAINT users_privacy_level_check
            CHECK (privacy_level IN (0, 1, 2));

        RAISE NOTICE 'Applied constraints to privacy_level column';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS server_memories (
  server_memory_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL,
  tomori_id INT, -- Optional persona pointer for attribution (set to NULL if persona deleted)
  persona_lineage_id BIGINT NOT NULL, -- Shared persona identity for memory continuity across remove/re-import
  user_id INT, -- Creator of this server memory (nullable - set to NULL if user deleted)
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Add tomori_id column for existing databases
SELECT add_column_if_not_exists('server_memories', 'tomori_id', 'INTEGER');
-- Add lineage scope column for existing databases
SELECT add_column_if_not_exists('server_memories', 'persona_lineage_id', 'BIGINT');
-- Add tags column for existing databases
SELECT add_column_if_not_exists('server_memories', 'tags', 'TEXT[]', 'ARRAY[]::TEXT[]');

-- Backfill server memories to the current main persona for each server
DO $$
BEGIN
	UPDATE server_memories sm
	SET tomori_id = main.tomori_id
	FROM (
		SELECT DISTINCT ON (server_id)
			server_id,
			tomori_id
		FROM tomoris
		WHERE is_alter = false
		ORDER BY server_id, updated_at DESC NULLS LAST, tomori_id DESC
	) main
	WHERE sm.tomori_id IS NULL
	  AND sm.server_id = main.server_id;
END $$;

-- Backfill server_memories.persona_lineage_id from linked persona rows
DO $$
BEGIN
	UPDATE server_memories sm
	SET persona_lineage_id = t.persona_lineage_id
	FROM tomoris t
	WHERE sm.persona_lineage_id IS NULL
	  AND sm.tomori_id = t.tomori_id;
END $$;

-- Backfill any remaining lineage NULLs to each server's current main persona lineage
DO $$
BEGIN
	UPDATE server_memories sm
	SET persona_lineage_id = main.persona_lineage_id
	FROM (
		SELECT DISTINCT ON (server_id)
			server_id,
			persona_lineage_id
		FROM tomoris
		WHERE is_alter = false
		ORDER BY server_id, updated_at DESC NULLS LAST, tomori_id DESC
	) main
	WHERE sm.persona_lineage_id IS NULL
	  AND sm.server_id = main.server_id;
END $$;

-- Final fallback for unusual servers without a current main persona
DO $$
BEGIN
	UPDATE server_memories sm
	SET persona_lineage_id = fallback.persona_lineage_id
	FROM (
		SELECT DISTINCT ON (server_id)
			server_id,
			persona_lineage_id
		FROM tomoris
		ORDER BY server_id, is_alter ASC, updated_at DESC NULLS LAST, tomori_id DESC
	) fallback
	WHERE sm.persona_lineage_id IS NULL
	  AND sm.server_id = fallback.server_id;
END $$;

-- Guard against orphaned persona pointers before enforcing tomori FK
UPDATE server_memories sm
SET tomori_id = NULL
WHERE sm.tomori_id IS NOT NULL
  AND NOT EXISTS (
  	SELECT 1
  	FROM tomoris t
  	WHERE t.tomori_id = sm.tomori_id
  );

-- Enforce NOT NULL only when all rows have been backfilled
DO $$
DECLARE
	unresolved_count INTEGER;
BEGIN
	SELECT COUNT(*) INTO unresolved_count
	FROM server_memories
	WHERE persona_lineage_id IS NULL;

	IF unresolved_count = 0 THEN
		ALTER TABLE server_memories
		ALTER COLUMN persona_lineage_id SET NOT NULL;
	ELSE
		RAISE NOTICE 'Skipping NOT NULL on server_memories.persona_lineage_id: % unresolved rows remain', unresolved_count;
	END IF;
END $$;

-- Ensure FK for server_memories.tomori_id exists with ON DELETE SET NULL
DO $$
DECLARE
	fk_delete_action CHAR;
BEGIN
	SELECT c.confdeltype
	INTO fk_delete_action
	FROM pg_constraint c
	WHERE c.conname = 'server_memories_tomori_id_fkey'
	LIMIT 1;

	IF fk_delete_action IS NULL THEN
		ALTER TABLE server_memories
		ADD CONSTRAINT server_memories_tomori_id_fkey
		FOREIGN KEY (tomori_id)
		REFERENCES tomoris(tomori_id)
		ON DELETE SET NULL;
	ELSIF fk_delete_action <> 'n' THEN
		ALTER TABLE server_memories
		DROP CONSTRAINT server_memories_tomori_id_fkey;
		ALTER TABLE server_memories
		ADD CONSTRAINT server_memories_tomori_id_fkey
		FOREIGN KEY (tomori_id)
		REFERENCES tomoris(tomori_id)
		ON DELETE SET NULL;
	END IF;
END $$;

-- Removed updated_at trigger for server_memories table (never updated after creation, only INSERT/DELETE)
DROP TRIGGER IF EXISTS update_server_memories_timestamp ON server_memories;
CREATE INDEX IF NOT EXISTS idx_server_memories_tomori_id ON server_memories(tomori_id);
CREATE INDEX IF NOT EXISTS idx_server_memories_tomori_created_at ON server_memories(tomori_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_server_memories_lineage_id ON server_memories(persona_lineage_id);
CREATE INDEX IF NOT EXISTS idx_server_memories_server_lineage_created_at ON server_memories(server_id, persona_lineage_id, created_at DESC);

-- Persona-scoped conditioning history for reward/punish interactions (April 2026)
CREATE TABLE IF NOT EXISTS conditioning_history (
  conditioning_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL,
  persona_lineage_id BIGINT NOT NULL,
  conditioning_type TEXT NOT NULL CHECK (conditioning_type IN ('reward', 'punish')),
  action_key TEXT NOT NULL,
  reason_text TEXT NOT NULL,
  reason_normalized TEXT NOT NULL,
  user_id INT NOT NULL,
  count INT NOT NULL DEFAULT 1 CHECK (count >= 1),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);


DROP TRIGGER IF EXISTS update_conditioning_history_timestamp ON conditioning_history;
CREATE TRIGGER update_conditioning_history_timestamp
BEFORE UPDATE ON conditioning_history
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE UNIQUE INDEX IF NOT EXISTS idx_conditioning_history_unique
ON conditioning_history(server_id, persona_lineage_id, conditioning_type, action_key, reason_normalized, user_id);

CREATE INDEX IF NOT EXISTS idx_conditioning_history_server_lineage_type_updated
ON conditioning_history(server_id, persona_lineage_id, conditioning_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conditioning_history_server_lineage_updated
ON conditioning_history(server_id, persona_lineage_id, updated_at DESC);

-- Dedicated personal memories table (lineage-scoped)
CREATE TABLE IF NOT EXISTS personal_memories (
  personal_memory_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  persona_lineage_id BIGINT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Add tags column for existing databases
SELECT add_column_if_not_exists('personal_memories', 'tags', 'TEXT[]', 'ARRAY[]::TEXT[]');

-- Create updated_at trigger for personal_memories table
DROP TRIGGER IF EXISTS update_personal_memories_timestamp ON personal_memories;
CREATE TRIGGER update_personal_memories_timestamp
BEFORE UPDATE ON personal_memories
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Backfill existing users.personal_memories into global personal namespace (lineage 0).
-- Wrapped in a column-existence check so this runs exactly once: subsequent schema runs
-- skip both the INSERT and the DROP cleanly once the column is gone.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_name = 'users' AND column_name = 'personal_memories'
	) THEN
		-- EXECUTE defers parsing until runtime so the column reference is only
		-- validated when the branch is actually taken (column still exists).
		EXECUTE $migration$
			INSERT INTO personal_memories (user_id, persona_lineage_id, content, created_at, updated_at)
			SELECT
				u.user_id,
				0::BIGINT,
				legacy_memory,
				COALESCE(u.updated_at, CURRENT_TIMESTAMP),
				COALESCE(u.updated_at, CURRENT_TIMESTAMP)
			FROM users u
			CROSS JOIN LATERAL unnest(COALESCE(u.personal_memories, ARRAY[]::TEXT[])) AS legacy_memory
			WHERE NOT EXISTS (
				SELECT 1
				FROM personal_memories pm
				WHERE pm.user_id = u.user_id
				  AND pm.persona_lineage_id = 0
				  AND pm.content = legacy_memory
			)
		$migration$;

		ALTER TABLE users DROP COLUMN personal_memories;
	END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_personal_memories_user_lineage_created_at
ON personal_memories(user_id, persona_lineage_id, created_at DESC);

-- Document/RAG schema is loaded separately when RAG is enabled

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

-- Channel Whitelist Table
-- Stores per-channel trigger access plus optional cooldown overrides
-- When ANY channel is whitelisted, ONLY whitelisted channels can trigger the bot
CREATE TABLE IF NOT EXISTS channel_whitelist (
	server_id INT NOT NULL,
	channel_disc_id TEXT NOT NULL,
	cooldown_type INT,
	cooldown_length INT,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (server_id, channel_disc_id),
	FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Allow whitelist entries to inherit global cooldown settings by storing NULL override columns
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_name = 'channel_whitelist'
		AND column_name = 'cooldown_type'
		AND is_nullable = 'NO'
	) THEN
		ALTER TABLE channel_whitelist ALTER COLUMN cooldown_type DROP NOT NULL;
		RAISE NOTICE 'Made channel_whitelist.cooldown_type nullable';
	END IF;
END $$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_name = 'channel_whitelist'
		AND column_name = 'cooldown_length'
		AND is_nullable = 'NO'
	) THEN
		ALTER TABLE channel_whitelist ALTER COLUMN cooldown_length DROP NOT NULL;
		RAISE NOTICE 'Made channel_whitelist.cooldown_length nullable';
	END IF;
END $$;

ALTER TABLE channel_whitelist ALTER COLUMN cooldown_type DROP DEFAULT;
ALTER TABLE channel_whitelist ALTER COLUMN cooldown_length DROP DEFAULT;

ALTER TABLE channel_whitelist
	DROP CONSTRAINT IF EXISTS channel_whitelist_cooldown_override_pair;
ALTER TABLE channel_whitelist
	ADD CONSTRAINT channel_whitelist_cooldown_override_pair
	CHECK (
		(cooldown_type IS NULL AND cooldown_length IS NULL)
		OR (cooldown_type IS NOT NULL AND cooldown_length IS NOT NULL)
	);

-- Create indexes for channel_whitelist
CREATE INDEX IF NOT EXISTS idx_channel_whitelist_server ON channel_whitelist(server_id);
CREATE INDEX IF NOT EXISTS idx_channel_whitelist_active ON channel_whitelist(server_id, cooldown_length) WHERE cooldown_length > 0;

-- Create updated_at trigger for channel_whitelist table
DROP TRIGGER IF EXISTS update_channel_whitelist_timestamp ON channel_whitelist;
CREATE TRIGGER update_channel_whitelist_timestamp
BEFORE UPDATE ON channel_whitelist
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Role Whitelist Table
-- Restricts triggers to members with whitelisted roles when active
CREATE TABLE IF NOT EXISTS role_whitelist (
	server_id INT NOT NULL,
	role_disc_id TEXT NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (server_id, role_disc_id),
	FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Create indexes for role_whitelist
CREATE INDEX IF NOT EXISTS idx_role_whitelist_server ON role_whitelist(server_id);

-- Create updated_at trigger for role_whitelist table
DROP TRIGGER IF EXISTS update_role_whitelist_timestamp ON role_whitelist;
CREATE TRIGGER update_role_whitelist_timestamp
BEFORE UPDATE ON role_whitelist
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Channel Persona Whitelist Table
-- Restricts automatic persona triggering to a channel-specific subset when active
-- If a channel has no persona whitelist entries, all personas remain eligible there
CREATE TABLE IF NOT EXISTS channel_persona_whitelist (
	server_id INT NOT NULL,
	channel_disc_id TEXT NOT NULL,
	tomori_id INT NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (server_id, channel_disc_id, tomori_id),
	FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
	FOREIGN KEY (tomori_id) REFERENCES tomoris(tomori_id) ON DELETE CASCADE
);

-- Create indexes for channel_persona_whitelist
CREATE INDEX IF NOT EXISTS idx_channel_persona_whitelist_server
ON channel_persona_whitelist(server_id);
CREATE INDEX IF NOT EXISTS idx_channel_persona_whitelist_channel
ON channel_persona_whitelist(server_id, channel_disc_id);

-- Create updated_at trigger for channel_persona_whitelist table
DROP TRIGGER IF EXISTS update_channel_persona_whitelist_timestamp ON channel_persona_whitelist;
CREATE TRIGGER update_channel_persona_whitelist_timestamp
BEFORE UPDATE ON channel_persona_whitelist
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Personal Spotlight Tables
-- User + channel scoped persona restrictions with optional per-user auto-trigger persona
CREATE TABLE IF NOT EXISTS personal_spotlights (
	server_id INT NOT NULL,
	user_id INT NOT NULL,
	channel_disc_id TEXT NOT NULL,
	auto_trigger_tomori_id INT NULL,
	expires_at TIMESTAMP NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (server_id, user_id, channel_disc_id),
	FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
	FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
	FOREIGN KEY (auto_trigger_tomori_id) REFERENCES tomoris(tomori_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS personal_spotlight_personas (
	server_id INT NOT NULL,
	user_id INT NOT NULL,
	channel_disc_id TEXT NOT NULL,
	tomori_id INT NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (server_id, user_id, channel_disc_id, tomori_id),
	FOREIGN KEY (server_id, user_id, channel_disc_id)
		REFERENCES personal_spotlights(server_id, user_id, channel_disc_id)
		ON DELETE CASCADE,
	FOREIGN KEY (tomori_id) REFERENCES tomoris(tomori_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_personal_spotlights_server_user
ON personal_spotlights(server_id, user_id);
CREATE INDEX IF NOT EXISTS idx_personal_spotlights_expires_at
ON personal_spotlights(expires_at);
CREATE INDEX IF NOT EXISTS idx_personal_spotlight_personas_lookup
ON personal_spotlight_personas(server_id, user_id, channel_disc_id);

DROP TRIGGER IF EXISTS update_personal_spotlights_timestamp ON personal_spotlights;
CREATE TRIGGER update_personal_spotlights_timestamp
BEFORE UPDATE ON personal_spotlights
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

DROP TRIGGER IF EXISTS update_personal_spotlight_personas_timestamp ON personal_spotlight_personas;
CREATE TRIGGER update_personal_spotlight_personas_timestamp
BEFORE UPDATE ON personal_spotlight_personas
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

-- Removed updated_at trigger for error_logs table (error logging disabled, table no longer actively used)
DROP TRIGGER IF EXISTS update_error_logs_timestamp ON error_logs;

-- ============================================================================
-- COOLDOWNS TABLE MIGRATION
-- Migrates from "creative key mapping" to explicit columns
-- Safe to run repeatedly (idempotent)
-- ============================================================================

-- Drop old cooldowns table if it has the old schema (check for command_category column)
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_name = 'cooldowns'
		AND column_name = 'command_category'
	) THEN
		DROP TABLE IF EXISTS cooldowns CASCADE;
		RAISE NOTICE 'Dropped old cooldowns table (migration to explicit schema)';
	END IF;
END $$;

-- Create new cooldowns table with explicit columns
CREATE UNLOGGED TABLE IF NOT EXISTS cooldowns (
	cooldown_id SERIAL,
	cooldown_type INT NOT NULL,                -- CooldownType enum (1-5)
	server_disc_id TEXT,                       -- Server/guild ID (for types 1-4)
	user_disc_id TEXT,                         -- User ID (populated for PER_USER and COMMAND_CATEGORY)
	channel_disc_id TEXT,                      -- Channel ID (populated for PER_CHANNEL)
	command_category TEXT,                     -- Command category (populated for COMMAND_CATEGORY type 5)
	expiry_time BIGINT NOT NULL,               -- Unix timestamp in milliseconds
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add command_category column to existing tables (migration for Phase 1 users)
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_name = 'cooldowns'
		AND column_name = 'command_category'
	) THEN
		ALTER TABLE cooldowns ADD COLUMN command_category TEXT;
		RAISE NOTICE 'Added command_category column to cooldowns table';
	END IF;
END $$;

-- Make server_disc_id nullable for existing tables (migration for Phase 1 users)
DO $$
BEGIN
	-- Check if server_disc_id is currently NOT NULL
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_name = 'cooldowns'
		AND column_name = 'server_disc_id'
		AND is_nullable = 'NO'
	) THEN
		ALTER TABLE cooldowns ALTER COLUMN server_disc_id DROP NOT NULL;
		RAISE NOTICE 'Made server_disc_id nullable in cooldowns table';
	END IF;
END $$;

-- Drop old unique index if it exists (before recreating with new columns)
DROP INDEX IF EXISTS uq_cooldown_scope;

-- Unique index for UPSERT operations (handles NULLs properly)
-- This ensures one cooldown entry per unique combination of type + scope
CREATE UNIQUE INDEX uq_cooldown_scope
	ON cooldowns (
		cooldown_type,
		COALESCE(server_disc_id, ''),
		COALESCE(user_disc_id, ''),
		COALESCE(channel_disc_id, ''),
		COALESCE(command_category, '')
	);

-- Performance indexes for cooldown queries
CREATE INDEX IF NOT EXISTS idx_cooldowns_expiry
	ON cooldowns(expiry_time);

CREATE INDEX IF NOT EXISTS idx_cooldowns_user
	ON cooldowns(user_disc_id, server_disc_id)
	WHERE user_disc_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cooldowns_channel
	ON cooldowns(channel_disc_id)
	WHERE channel_disc_id IS NOT NULL;

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
  repetition_interval_hours INTEGER,                   -- Optional: repeat interval in hours for recurring reminders
  self_reminder BOOLEAN DEFAULT false,                 -- Optional: reminder targets the bot itself
  created_by_user_id INT,                              -- User who created this reminder (nullable - set to NULL if user deleted)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Track which persona created the reminder (January 2026)
SELECT add_column_if_not_exists('reminders', 'persona_id', 'INTEGER');
-- Recurring reminders: optional repeat interval in hours (January 2026)
SELECT add_column_if_not_exists('reminders', 'repetition_interval_hours', 'INTEGER');
-- Self reminders (January 2026)
SELECT add_column_if_not_exists('reminders', 'self_reminder', 'BOOLEAN', 'false');
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'reminders_persona_id_fkey'
    ) THEN
        ALTER TABLE reminders
        ADD CONSTRAINT reminders_persona_id_fkey
        FOREIGN KEY (persona_id)
        REFERENCES tomoris(tomori_id)
        ON DELETE SET NULL;
    END IF;
END $$;

-- Create index for efficient reminder queries
CREATE INDEX IF NOT EXISTS idx_reminders_time ON reminders(reminder_time);
CREATE INDEX IF NOT EXISTS idx_reminders_server_id ON reminders(server_id);

-- Removed updated_at trigger for reminders table (never updated after creation, only INSERT/DELETE)
DROP TRIGGER IF EXISTS update_reminders_timestamp ON reminders;

-- Drop deprecated columns 
SELECT drop_column_if_exists('tomori_configs', 'teach_cost');
SELECT drop_column_if_exists('tomori_configs', 'gamba_limit');
SELECT drop_column_if_exists('users', 'tomocoins_held');
SELECT drop_column_if_exists('users', 'tomocoins_deposited');

-- Add key_version column to opt_api_keys for encryption key rotation (November 2025)
SELECT add_column_if_not_exists('opt_api_keys', 'key_version', 'INTEGER', '1');
CREATE INDEX IF NOT EXISTS idx_opt_api_keys_version ON opt_api_keys(key_version);

-- Add key_version column to tomori_configs for main API key rotation (November 2025)
-- DEPRECATED Phase 1.5 Pass B: api_key/key_version are now canonical in saved_provider_configs
SELECT add_column_if_not_exists('tomori_configs', 'key_version', 'INTEGER', '1');
CREATE INDEX IF NOT EXISTS idx_tomori_configs_key_version ON tomori_configs(key_version);

-- API Key Rotation table for load balancing and failover (January 2026)
-- Stores additional API keys for round-robin distribution and automatic failover
CREATE TABLE IF NOT EXISTS api_key_rotation (
  rotation_key_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL,
  provider TEXT NOT NULL,                           -- Must match current provider in tomori_configs
  api_key BYTEA,                                    -- NULL if is_main_key_pointer = true
  key_version INTEGER DEFAULT 1,                    -- Encryption key version
  is_main_key_pointer BOOLEAN DEFAULT false,        -- true = use tomori_configs.api_key instead
  is_enabled BOOLEAN DEFAULT true,                  -- Manual or auto-disabled after errors
  usage_count BIGINT DEFAULT 0,                     -- For round-robin tracking
  error_count INTEGER DEFAULT 0,                    -- Consecutive errors
  last_used_at TIMESTAMP,
  last_error_at TIMESTAMP,                          -- For cooldown logic
  last_error_type TEXT,                             -- 'rate_limit' (60s) or 'api_error' (5min)
  last_error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Only one main key pointer per server (unique partial index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_key_rotation_main_pointer
  ON api_key_rotation(server_id) WHERE is_main_key_pointer = true;

-- Index for efficient key selection queries
CREATE INDEX IF NOT EXISTS idx_api_key_rotation_server_provider
  ON api_key_rotation(server_id, provider, is_enabled);

-- Create updated_at trigger for api_key_rotation table
DROP TRIGGER IF EXISTS update_api_key_rotation_timestamp ON api_key_rotation;
CREATE TRIGGER update_api_key_rotation_timestamp
BEFORE UPDATE ON api_key_rotation
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- ============================================================================
-- IMAGE QUOTA SYSTEM (Phase 3)
-- Prevents image generation abuse with per-user daily and server-wide quotas
-- ============================================================================

-- Server-level quota configuration
CREATE TABLE IF NOT EXISTS image_quota_configs (
	server_id INT PRIMARY KEY,
	daily_user_quota INT NOT NULL DEFAULT 0,                 -- Per-user daily limit (0 = unlimited)
	serverwide_quota INT NOT NULL DEFAULT 0,                 -- Total server quota (0 = unlimited)
	serverwide_quota_resets_in INT NOT NULL DEFAULT 365,     -- Days before server quota resets (1-365)
	enabled BOOLEAN NOT NULL DEFAULT false,                  -- Master toggle for quota system
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Migration: Add updated_at column if it doesn't exist (for existing databases)
SELECT add_column_if_not_exists(
	'image_quota_configs',
	'updated_at',
	'TIMESTAMP',
	'CURRENT_TIMESTAMP'
);

-- Create updated_at trigger for image_quota_configs table
DROP TRIGGER IF EXISTS update_image_quota_configs_timestamp ON image_quota_configs;
CREATE TRIGGER update_image_quota_configs_timestamp
BEFORE UPDATE ON image_quota_configs
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- User quota usage tracking (resets daily at midnight server timezone)
CREATE TABLE IF NOT EXISTS image_quotas (
	quota_id SERIAL PRIMARY KEY,
	server_id INT NOT NULL,
	user_disc_id TEXT NOT NULL,                              -- User's Discord ID
	usage_count INT NOT NULL DEFAULT 0,                      -- Images generated today
	quota_date DATE NOT NULL,                                -- Date this quota is for (YYYY-MM-DD)
	last_reset TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(server_id, user_disc_id, quota_date),
	FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Index for efficient quota lookups
CREATE INDEX IF NOT EXISTS idx_image_quotas_lookup
	ON image_quotas(server_id, user_disc_id, quota_date);

-- Index for cleanup queries (find old quota records)
CREATE INDEX IF NOT EXISTS idx_image_quotas_date
	ON image_quotas(quota_date);

-- Server-wide quota tracking (resets based on serverwide_quota_resets_in)
CREATE TABLE IF NOT EXISTS serverwide_quotas (
	server_id INT PRIMARY KEY,
	usage_count INT NOT NULL DEFAULT 0,                      -- Total images generated this period
	quota_period_start TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	quota_period_end TIMESTAMP NOT NULL,                     -- Calculated from period_start + resets_in days
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Migration: Rename last_updated to updated_at if needed (for existing databases)
DO $$
BEGIN
    -- Check if last_updated column exists and updated_at doesn't
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'serverwide_quotas' AND column_name = 'last_updated'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'serverwide_quotas' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE serverwide_quotas RENAME COLUMN last_updated TO updated_at;
    END IF;
END $$;

-- Create updated_at trigger for serverwide_quotas table
DROP TRIGGER IF EXISTS update_serverwide_quotas_timestamp ON serverwide_quotas;
CREATE TRIGGER update_serverwide_quotas_timestamp
BEFORE UPDATE ON serverwide_quotas
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Index for cleanup queries (find expired quota periods)
CREATE INDEX IF NOT EXISTS idx_serverwide_quotas_period_end
	ON serverwide_quotas(quota_period_end);

-- Function to clean up old user quota records (older than 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_image_quotas()
RETURNS INTEGER AS $$
DECLARE
	deleted_count INTEGER;
BEGIN
	DELETE FROM image_quotas
	WHERE quota_date < CURRENT_DATE - INTERVAL '7 days';

	GET DIAGNOSTICS deleted_count = ROW_COUNT;

	RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TEXT QUOTA SYSTEM (March 2026)
-- Prevents text generation abuse with per-user daily and server-wide quotas
-- ============================================================================

-- Server-level quota configuration
CREATE TABLE IF NOT EXISTS text_quota_configs (
	server_id INT PRIMARY KEY,
	daily_user_quota INT NOT NULL DEFAULT 0,                 -- Per-user daily limit (0 = unlimited)
	serverwide_quota INT NOT NULL DEFAULT 0,                 -- Total server quota (0 = unlimited)
	serverwide_quota_resets_in INT NOT NULL DEFAULT 365,     -- Days before server quota resets (1-365)
	enabled BOOLEAN NOT NULL DEFAULT false,                  -- Master toggle for quota system
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Migration: Add updated_at column if it doesn't exist (for existing databases)
SELECT add_column_if_not_exists(
	'text_quota_configs',
	'updated_at',
	'TIMESTAMP',
	'CURRENT_TIMESTAMP'
);

-- Create updated_at trigger for text_quota_configs table
DROP TRIGGER IF EXISTS update_text_quota_configs_timestamp ON text_quota_configs;
CREATE TRIGGER update_text_quota_configs_timestamp
BEFORE UPDATE ON text_quota_configs
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- User quota usage tracking (resets daily at midnight server timezone)
CREATE TABLE IF NOT EXISTS text_quotas (
	quota_id SERIAL PRIMARY KEY,
	server_id INT NOT NULL,
	user_disc_id TEXT NOT NULL,                              -- User's Discord ID
	usage_count INT NOT NULL DEFAULT 0,                      -- Text generations triggered today
	quota_date DATE NOT NULL,                                -- Date this quota is for (YYYY-MM-DD)
	last_reset TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(server_id, user_disc_id, quota_date),
	FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Index for efficient quota lookups
CREATE INDEX IF NOT EXISTS idx_text_quotas_lookup
	ON text_quotas(server_id, user_disc_id, quota_date);

-- Index for cleanup queries (find old quota records)
CREATE INDEX IF NOT EXISTS idx_text_quotas_date
	ON text_quotas(quota_date);

-- Server-wide quota tracking (resets based on serverwide_quota_resets_in)
CREATE TABLE IF NOT EXISTS text_serverwide_quotas (
	server_id INT PRIMARY KEY,
	usage_count INT NOT NULL DEFAULT 0,                      -- Total text generations this period
	quota_period_start TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	quota_period_end TIMESTAMP NOT NULL,                     -- Calculated from period_start + resets_in days
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Migration: Rename last_updated to updated_at if needed (for existing databases)
DO $$
BEGIN
    -- Check if last_updated column exists and updated_at doesn't
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'text_serverwide_quotas' AND column_name = 'last_updated'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'text_serverwide_quotas' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE text_serverwide_quotas RENAME COLUMN last_updated TO updated_at;
    END IF;
END $$;

-- Create updated_at trigger for text_serverwide_quotas table
DROP TRIGGER IF EXISTS update_text_serverwide_quotas_timestamp ON text_serverwide_quotas;
CREATE TRIGGER update_text_serverwide_quotas_timestamp
BEFORE UPDATE ON text_serverwide_quotas
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Index for cleanup queries (find expired quota periods)
CREATE INDEX IF NOT EXISTS idx_text_serverwide_quotas_period_end
	ON text_serverwide_quotas(quota_period_end);

-- Function to clean up old user quota records (older than 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_text_quotas()
RETURNS INTEGER AS $$
DECLARE
	deleted_count INTEGER;
BEGIN
	DELETE FROM text_quotas
	WHERE quota_date < CURRENT_DATE - INTERVAL '7 days';

	GET DIAGNOSTICS deleted_count = ROW_COUNT;

	RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VIDEO QUOTA SYSTEM (April 2026)
-- Prevents video generation abuse with per-user daily and server-wide quotas
-- Lower defaults than image quotas (video generation is more expensive)
-- ============================================================================

-- Server-level video quota configuration
CREATE TABLE IF NOT EXISTS video_quota_configs (
	server_id INT PRIMARY KEY,
	daily_user_quota INT NOT NULL DEFAULT 0,                 -- Per-user daily limit (0 = unlimited)
	serverwide_quota INT NOT NULL DEFAULT 0,                 -- Total server quota (0 = unlimited)
	serverwide_quota_resets_in INT NOT NULL DEFAULT 365,     -- Days before server quota resets (1-365)
	enabled BOOLEAN NOT NULL DEFAULT false,                  -- Master toggle for quota system
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Create updated_at trigger for video_quota_configs table
DROP TRIGGER IF EXISTS update_video_quota_configs_timestamp ON video_quota_configs;
CREATE TRIGGER update_video_quota_configs_timestamp
BEFORE UPDATE ON video_quota_configs
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- User video quota usage tracking (resets daily at midnight server timezone)
CREATE TABLE IF NOT EXISTS video_quotas (
	quota_id SERIAL PRIMARY KEY,
	server_id INT NOT NULL,
	user_disc_id TEXT NOT NULL,                              -- User's Discord ID
	usage_count INT NOT NULL DEFAULT 0,                      -- Videos generated today
	quota_date DATE NOT NULL,                                -- Date this quota is for (YYYY-MM-DD)
	last_reset TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(server_id, user_disc_id, quota_date),
	FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Index for efficient quota lookups
CREATE INDEX IF NOT EXISTS idx_video_quotas_lookup
	ON video_quotas(server_id, user_disc_id, quota_date);

-- Index for cleanup queries (find old quota records)
CREATE INDEX IF NOT EXISTS idx_video_quotas_date
	ON video_quotas(quota_date);

-- Server-wide video quota tracking (resets based on serverwide_quota_resets_in)
CREATE TABLE IF NOT EXISTS video_serverwide_quotas (
	server_id INT PRIMARY KEY,
	usage_count INT NOT NULL DEFAULT 0,                      -- Total videos generated this period
	quota_period_start TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	quota_period_end TIMESTAMP NOT NULL,                     -- Calculated from period_start + resets_in days
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Create updated_at trigger for video_serverwide_quotas table
DROP TRIGGER IF EXISTS update_video_serverwide_quotas_timestamp ON video_serverwide_quotas;
CREATE TRIGGER update_video_serverwide_quotas_timestamp
BEFORE UPDATE ON video_serverwide_quotas
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Index for cleanup queries (find expired quota periods)
CREATE INDEX IF NOT EXISTS idx_video_serverwide_quotas_period_end
	ON video_serverwide_quotas(quota_period_end);

-- Function to clean up old video quota records (older than 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_video_quotas()
RETURNS INTEGER AS $$
DECLARE
	deleted_count INTEGER;
BEGIN
	DELETE FROM video_quotas
	WHERE quota_date < CURRENT_DATE - INTERVAL '7 days';

	GET DIAGNOSTICS deleted_count = ROW_COUNT;

	RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Example usage - This shows how to add columns to existing tables
-- You can add these calls whenever you need to introduce schema changes
-- SELECT add_column_if_not_exists('tomori_configs', 'new_feature_flag', 'BOOLEAN', 'false');
-- SELECT add_column_if_not_exists('users', 'avatar_url', 'TEXT');
-- SELECT add_column_if_not_exists('tomoris', 'response_count', 'INT', '0');

-- ============================================================================
-- MATRIX BRIDGE
-- Bidirectional message bridge between Discord channels and Matrix rooms.
-- One-to-one mapping enforced by UNIQUE constraints on both sides.
-- ============================================================================

CREATE TABLE IF NOT EXISTS matrix_channel_links (
  link_id          SERIAL PRIMARY KEY,
  server_id        INT  NOT NULL,
  channel_disc_id  TEXT NOT NULL,
  matrix_room_id   TEXT NOT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
  UNIQUE (channel_disc_id),
  UNIQUE (matrix_room_id)
);

CREATE INDEX IF NOT EXISTS idx_matrix_links_channel ON matrix_channel_links(channel_disc_id);
CREATE INDEX IF NOT EXISTS idx_matrix_links_room    ON matrix_channel_links(matrix_room_id);

-- Random Trigger System (February 2026)
-- Timer-based probabilistic auto-trigger: fires every N hours with P% probability
CREATE TABLE IF NOT EXISTS random_triggers (
  trigger_id              SERIAL PRIMARY KEY,
  server_id               INT NOT NULL,
  channel_disc_id         TEXT NOT NULL,
  tomori_id               INT,                                -- NULL = "Random" persona selection
  timer_hours             INTEGER NOT NULL,                   -- How often to roll the dice (hours)
  random_offset_range     INTEGER,                            -- Optional +/- random offset range in hours
  chance_percent          INTEGER NOT NULL,                   -- Probability of firing (1-100)
  silence_threshold_hours INTEGER,                           -- Skip if channel was active within N hours (NULL = no check)
  respond_to_self         BOOLEAN NOT NULL DEFAULT false,    -- Whether to fire if the persona spoke last
  custom_prompt           TEXT,                              -- Optional injected system prompt for this trigger
  next_trigger_at         TIMESTAMP WITH TIME ZONE NOT NULL, -- When the next dice roll occurs
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
  FOREIGN KEY (tomori_id) REFERENCES tomoris(tomori_id) ON DELETE CASCADE
);
SELECT add_column_if_not_exists('random_triggers', 'random_offset_range', 'INTEGER');
SELECT add_column_if_not_exists('random_triggers', 'failure_threshold', 'INTEGER');
-- consecutive_failures tracks how many dice rolls in a row missed; resets on fire or force-fire
SELECT add_column_if_not_exists('random_triggers', 'consecutive_failures', 'INTEGER', '0', 'NOT NULL');

-- Fast lookup for due triggers (primary polling query)
CREATE INDEX IF NOT EXISTS idx_random_triggers_next ON random_triggers(next_trigger_at);
-- Fast lookup for triggers by server (used in cap checks and remove command)
CREATE INDEX IF NOT EXISTS idx_random_triggers_server ON random_triggers(server_id);
-- Enforce uniqueness: a specific named persona can only have one trigger per channel
-- NULL tomori_id (Random) is excluded and can have multiple triggers per channel
CREATE UNIQUE INDEX IF NOT EXISTS idx_random_triggers_unique_persona
  ON random_triggers(server_id, channel_disc_id, tomori_id)
  WHERE tomori_id IS NOT NULL;

-- updated_at trigger for random_triggers (DROP first for idempotency on re-run)
DROP TRIGGER IF EXISTS update_random_triggers_timestamp ON random_triggers;
CREATE TRIGGER update_random_triggers_timestamp
  BEFORE UPDATE ON random_triggers
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ============================================================================
-- SCOPED MODEL OVERRIDES (March 2026)
-- Allows per-channel and per-persona LLM model overrides.
-- Priority chain: persona_llm > channel_llm_override > global llm.
-- ============================================================================

-- Add optional persona-specific LLM override column to persona_configs
ALTER TABLE persona_configs ADD COLUMN IF NOT EXISTS llm_id INT NULL REFERENCES llms(llm_id) ON DELETE SET NULL;

-- Channel-level LLM override table
-- When set, overrides the global llm_id for all personas in that channel.
CREATE TABLE IF NOT EXISTS channel_llm_overrides (
    server_id INT NOT NULL REFERENCES servers(server_id) ON DELETE CASCADE,
    channel_disc_id TEXT NOT NULL,
    llm_id INT NOT NULL REFERENCES llms(llm_id) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (server_id, channel_disc_id)
);

-- Index for fast channel override lookups
CREATE INDEX IF NOT EXISTS idx_channel_llm_overrides_server ON channel_llm_overrides(server_id);

-- updated_at trigger for channel_llm_overrides (DROP first for idempotency)
DROP TRIGGER IF EXISTS update_channel_llm_overrides_timestamp ON channel_llm_overrides;
CREATE TRIGGER update_channel_llm_overrides_timestamp
    BEFORE UPDATE ON channel_llm_overrides
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();


-- ============================================================================
-- NOVELAI ATTG METADATA (March 2026)
-- Per-persona Author/Title/Tags/Genre/Stars for Kayra/Erato prompt formatting.
-- Stars are Erato-only (injected only when model = llama-3-erato-v1).
-- ============================================================================

SELECT add_column_if_not_exists('tomoris', 'nai_attg_author', 'TEXT', NULL);
SELECT add_column_if_not_exists('tomoris', 'nai_attg_title',  'TEXT', NULL);
SELECT add_column_if_not_exists('tomoris', 'nai_attg_tags',   'TEXT', NULL);
SELECT add_column_if_not_exists('tomoris', 'nai_attg_genre',  'TEXT', NULL);
SELECT add_column_if_not_exists('tomoris', 'nai_attg_stars',  'SMALLINT', NULL);
-- ============================================================================
-- NOVELAI SAMPLING PRESETS (March 2026)
-- Stores per-model preset configs (Kayra and Erato) with human-readable
-- descriptions. Schema-compatible fields (temperature, top_k, top_p, min_p)
-- are written to tomori_configs; NAI-specific fields (order, tail_free_sampling,
-- phrase_rep_pen, etc.) are merged at generation time via nai_preset_name lookup.
-- ============================================================================

CREATE TABLE IF NOT EXISTS nai_presets (
    nai_preset_id   SERIAL PRIMARY KEY,
    preset_name     TEXT NOT NULL,
    model_target    TEXT NOT NULL,       -- "kayra" or "erato"
    is_default      BOOLEAN DEFAULT FALSE,
    preset_desc     TEXT NOT NULL,       -- EN human-readable description
    ja_preset_desc  TEXT NOT NULL,       -- JA human-readable description
    parameters      JSONB NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (preset_name, model_target)
);

-- Create index for fast model-target lookups
CREATE INDEX IF NOT EXISTS idx_nai_presets_model_target ON nai_presets(model_target, is_default);

-- Link active preset by name to server config (nullable for non-NAI providers)
SELECT add_column_if_not_exists('tomori_configs', 'nai_preset_name', 'TEXT');

-- Add fallback model chain for automatic provider failover (March 2026)
-- DEPRECATED Phase 3 rollout: legacy fallback array kept only for backward compatibility until fallback_model_refs is fully adopted.
SELECT add_column_if_not_exists('tomori_configs', 'fallback_llm_ids', 'JSONB', '''[]''::JSONB');
SELECT add_column_if_not_exists('tomori_configs', 'fallback_model_refs', 'JSONB', '''[]''::JSONB');

-- When true, hides the standard generate_image tool so only generate_image_nai is available (March 2026)
SELECT add_column_if_not_exists('tomori_configs', 'nai_exclusive_imggen', 'BOOLEAN', 'false');

-- Server-wide NovelAI image prompt tag overrides (March 2026)
-- Style tags replace the old hardcoded quality tag list in generate_image_nai.
SELECT add_column_if_not_exists(
	'tomori_configs',
	'nai_style_tags',
	'TEXT[]',
	'''{"8k","absurdres","masterpiece","best quality","good quality","newest"}'''
);

-- Negative tags replace the old hardcoded NAI negative prompt in generate_image_nai.
SELECT add_column_if_not_exists(
	'tomori_configs',
	'nai_negative_tags',
	'TEXT[]',
	'''{"lowres","worst quality","low quality","bad quality","old","oldest","unfinished","scan artifacts","jpeg artifacts","jaggy lines","unclear","sketch","blurry","bad anatomy","very displeasing","displeasing","bad hands","bad fingers","missing fingers","bad proportions","bad perspective","bad eyes","bad pupils","multiple heads","extra faces","many arms","poorly drawn face","poorly drawn hands","fused hands","bad feet","too many legs","malformed limbs","extra arms","multiple ears","extra digits","fewer digits","twitter username","username","watermark","signature","2koma","4koma","comic"}'''
);

-- Per-server NovelAI image generation parameter overrides (March 2026)
SELECT add_column_if_not_exists('tomori_configs', 'nai_sampler', 'TEXT', 'NULL');
SELECT add_column_if_not_exists('tomori_configs', 'nai_steps', 'SMALLINT', 'NULL');
SELECT add_column_if_not_exists('tomori_configs', 'nai_scale', 'REAL', 'NULL');
SELECT add_column_if_not_exists('tomori_configs', 'nai_noise_schedule', 'TEXT', 'NULL');
SELECT add_column_if_not_exists('tomori_configs', 'nai_cfg_rescale', 'REAL', 'NULL');
SELECT add_column_if_not_exists('tomori_configs', 'nai_diffusion_model_id', 'INTEGER', 'NULL');

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'tomori_configs_nai_diffusion_model_id_fkey'
	) THEN
		ALTER TABLE tomori_configs
		ADD CONSTRAINT tomori_configs_nai_diffusion_model_id_fkey
		FOREIGN KEY (nai_diffusion_model_id)
		REFERENCES image_diffusion_models(diffusion_model_id)
		ON DELETE SET NULL;
	END IF;
END $$;

-- Migration: add vision_llm_id column (March 2026 — dedicated vision model for non-vision chat models)
SELECT add_column_if_not_exists('tomori_configs', 'vision_llm_id', 'INTEGER', 'NULL');

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'tomori_configs_vision_llm_id_fkey'
	) THEN
		ALTER TABLE tomori_configs
		ADD CONSTRAINT tomori_configs_vision_llm_id_fkey
		FOREIGN KEY (vision_llm_id)
		REFERENCES llms(llm_id)
		ON DELETE SET NULL;
	END IF;
END $$;

-- Bun SQL currently fails on INT[] binary decoding in some code paths.
-- Migrate fallback_llm_ids to JSONB for stable SELECT */RETURNING * behavior.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'tomori_configs'
          AND column_name = 'fallback_llm_ids'
          AND udt_name = '_int4'
    ) THEN
        ALTER TABLE tomori_configs
            ALTER COLUMN fallback_llm_ids DROP DEFAULT;

        ALTER TABLE tomori_configs
            ALTER COLUMN fallback_llm_ids TYPE JSONB
            USING COALESCE(to_jsonb(fallback_llm_ids), '[]'::JSONB);
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'tomori_configs'
          AND column_name = 'fallback_llm_ids'
          AND udt_name = 'jsonb'
    ) THEN
        ALTER TABLE tomori_configs
            ALTER COLUMN fallback_llm_ids SET DEFAULT '[]'::JSONB;
    END IF;
END $$;

-- ============================================================
-- Guild MCP Servers (per-guild remote MCP server registrations)
-- ============================================================
CREATE TABLE IF NOT EXISTS guild_mcp_servers (
  guild_mcp_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  auth_token BYTEA,                -- PGP-encrypted bearer token (nullable — not all servers require auth)
  key_version INT DEFAULT 1,       -- Encryption key version for lazy rotation
  is_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (server_id, name),
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_guild_mcp_servers_server ON guild_mcp_servers(server_id);

-- Optional server_type column for deduplicating default MCP tools.
-- Values: NULL (general), 'web_search', 'url_fetcher'
SELECT add_column_if_not_exists('guild_mcp_servers', 'server_type', 'TEXT');

-- Trigger for updated_at auto-update
DROP TRIGGER IF EXISTS update_guild_mcp_servers_timestamp ON guild_mcp_servers;
CREATE TRIGGER update_guild_mcp_servers_timestamp
  BEFORE UPDATE ON guild_mcp_servers
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ============================================================
-- Saved Provider Configs (per-server provider config snapshots)
-- Stores API key, model selections, and endpoint config per provider
-- so users can switch between providers without losing their setup.
-- One row per provider per server. UPSERT on save, DELETE on remove.
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_provider_configs (
  saved_config_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL,
  provider TEXT NOT NULL,
  api_key BYTEA,                              -- Encrypted API key snapshot
  key_version INTEGER DEFAULT 1,              -- Encryption key version
  llm_id INT,                                 -- Text model at time of save
  diffusion_model_id INT,                     -- Image model at time of save
  embedding_model_id INT,                     -- Embedding model at time of save
  nai_diffusion_model_id INT,                 -- Dedicated NovelAI image model at time of save
  nai_preset_name TEXT,                       -- NovelAI sampling preset at time of save
  custom_endpoint_url TEXT,                   -- DEPRECATED Phase 3 rollout: legacy inline custom field; new registrations live in custom_endpoints
  custom_model_name TEXT,                     -- DEPRECATED Phase 3 rollout: legacy inline custom field; new registrations live in custom_endpoints
  custom_num_ctx INT,                         -- DEPRECATED Phase 3 rollout: legacy inline custom field; new registrations live in custom_endpoints
  thinking_level TEXT DEFAULT 'auto',         -- Provider-specific thinking/reasoning effort snapshot
  fallback_llm_ids JSONB DEFAULT '[]'::JSONB, -- DEPRECATED Phase 3 rollout: legacy fallback array; replace with fallback_model_refs before dropping
  channel_llm_overrides JSONB DEFAULT '[]'::JSONB,  -- DEPRECATED Phase 1.5 Pass B: switch-snapshot baggage; no longer written after switch.ts removed
  persona_llm_overrides JSONB DEFAULT '[]'::JSONB,  -- DEPRECATED Phase 1.5 Pass B: switch-snapshot baggage; no longer written after switch.ts removed
  llm_logit_biases JSONB DEFAULT '[]'::JSONB, -- Snapshot: [{id, text, value}, ...]
  llm_disabled_params TEXT[] DEFAULT '{}',    -- Snapshot: params omitted for this provider
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(server_id, provider),
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
  FOREIGN KEY (llm_id) REFERENCES llms(llm_id) ON DELETE SET NULL,
  FOREIGN KEY (diffusion_model_id) REFERENCES image_diffusion_models(diffusion_model_id) ON DELETE SET NULL,
  FOREIGN KEY (embedding_model_id) REFERENCES embedding_models(embedding_model_id) ON DELETE SET NULL,
  FOREIGN KEY (nai_diffusion_model_id) REFERENCES image_diffusion_models(diffusion_model_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_provider_configs_server
  ON saved_provider_configs(server_id);

-- Migration: add override snapshot columns (for existing deployments)
-- DEPRECATED Phase 1.5 Pass B: switch-snapshot baggage; drop after checklist passes
SELECT add_column_if_not_exists('saved_provider_configs', 'channel_llm_overrides', 'JSONB', '''[]''::JSONB');
SELECT add_column_if_not_exists('saved_provider_configs', 'persona_llm_overrides', 'JSONB', '''[]''::JSONB');

-- Migration: add vision_llm_id column (for existing deployments)
SELECT add_column_if_not_exists('saved_provider_configs', 'vision_llm_id', 'INTEGER', 'NULL');

-- Migration: add sampler/parameter columns to saved_provider_configs (March 2026)
SELECT add_column_if_not_exists('saved_provider_configs', 'llm_temperature', 'REAL', 'NULL');
SELECT add_column_if_not_exists('saved_provider_configs', 'llm_top_p', 'REAL', 'NULL');
SELECT add_column_if_not_exists('saved_provider_configs', 'llm_top_k', 'INTEGER', 'NULL');
SELECT add_column_if_not_exists('saved_provider_configs', 'llm_frequency_penalty', 'REAL', 'NULL');
SELECT add_column_if_not_exists('saved_provider_configs', 'llm_presence_penalty', 'REAL', 'NULL');
SELECT add_column_if_not_exists('saved_provider_configs', 'llm_min_p', 'REAL', 'NULL');
SELECT add_column_if_not_exists('saved_provider_configs', 'llm_logit_biases', 'JSONB', '''[]''::JSONB');
SELECT add_column_if_not_exists('saved_provider_configs', 'llm_disabled_params', 'TEXT[]', 'ARRAY[]::TEXT[]');
-- Migration: add video_model_id column to saved_provider_configs (April 2026)
SELECT add_column_if_not_exists('saved_provider_configs', 'video_model_id', 'INTEGER', 'NULL');

-- Migration: add thinking_level snapshot column to saved_provider_configs (April 2026)
SELECT add_column_if_not_exists('saved_provider_configs', 'thinking_level', 'TEXT', '''auto''');

-- Migration: add custom_num_ctx column to saved_provider_configs (April 2026)
SELECT add_column_if_not_exists('saved_provider_configs', 'custom_num_ctx', 'INT', 'NULL');
SELECT add_column_if_not_exists('saved_provider_configs', 'fallback_model_refs', 'JSONB', '''[]''::JSONB');

-- Migration: add user_byok_mode column to tomori_configs (April 2026)
SELECT add_column_if_not_exists('tomori_configs', 'user_byok_mode', 'BOOLEAN', 'false');

-- Migration: BYOK-only servers may intentionally operate without a server text model (April 2026)
DO $$
BEGIN
  BEGIN
    ALTER TABLE tomori_configs ALTER COLUMN llm_id DROP NOT NULL;
  EXCEPTION
    WHEN undefined_table THEN
      NULL;
  END;
END $$;

-- Auto-update timestamp trigger
DROP TRIGGER IF EXISTS update_saved_provider_configs_timestamp ON saved_provider_configs;
CREATE TRIGGER update_saved_provider_configs_timestamp
  BEFORE UPDATE ON saved_provider_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ============================================================
-- Custom Endpoints (Phase 3)
-- ============================================================
CREATE TABLE IF NOT EXISTS custom_endpoints (
  custom_endpoint_id SERIAL PRIMARY KEY,
  server_id INT NULL,
  user_id INT NULL,
  label TEXT NOT NULL,
  capability TEXT NOT NULL,
  api_style TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  model_name TEXT NULL,
  display_name TEXT NOT NULL,
  num_ctx INT NULL,
  requires_auth BOOLEAN DEFAULT false,
  extra_config JSONB DEFAULT '{}'::JSONB,
  has_tools BOOLEAN DEFAULT false,
  sees_images BOOLEAN DEFAULT false,
  sees_videos BOOLEAN DEFAULT false,
  supports_structoutput BOOLEAN DEFAULT false,
  is_default BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

ALTER TABLE custom_endpoints
  DROP CONSTRAINT IF EXISTS custom_endpoints_server_id_user_id_label_capability_key;

WITH ranked_custom_endpoints AS (
  SELECT
    custom_endpoint_id,
    ROW_NUMBER() OVER (
      PARTITION BY server_id, user_id, label, capability
      ORDER BY updated_at DESC, custom_endpoint_id DESC
    ) AS row_num
  FROM custom_endpoints
)
DELETE FROM custom_endpoints
WHERE custom_endpoint_id IN (
  SELECT custom_endpoint_id
  FROM ranked_custom_endpoints
  WHERE row_num > 1
);

CREATE INDEX IF NOT EXISTS idx_custom_endpoints_server ON custom_endpoints(server_id);
CREATE INDEX IF NOT EXISTS idx_custom_endpoints_user ON custom_endpoints(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_endpoints_label ON custom_endpoints(label);
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_endpoints_server_label_capability_unique
  ON custom_endpoints(server_id, label, capability)
  WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_endpoints_user_label_capability_unique
  ON custom_endpoints(user_id, label, capability)
  WHERE server_id IS NULL;

DROP TRIGGER IF EXISTS update_custom_endpoints_timestamp ON custom_endpoints;
CREATE TRIGGER update_custom_endpoints_timestamp
  BEFORE UPDATE ON custom_endpoints
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ============================================================
-- Scoped OpenRouter Model Registrations
-- Stores per-server / per-user visibility for extra OpenRouter model rows
-- that should not appear globally in every OpenRouter picker.
-- ============================================================
CREATE TABLE IF NOT EXISTS openrouter_model_registrations (
  openrouter_model_registration_id SERIAL PRIMARY KEY,
  server_id INT NULL,
  user_id INT NULL,
  llm_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (llm_id) REFERENCES llms(llm_id) ON DELETE CASCADE,
  CHECK ((server_id IS NULL) <> (user_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_openrouter_model_registrations_server_llm
  ON openrouter_model_registrations(server_id, llm_id)
  WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_openrouter_model_registrations_user_llm
  ON openrouter_model_registrations(user_id, llm_id)
  WHERE server_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_openrouter_model_registrations_server ON openrouter_model_registrations(server_id);
CREATE INDEX IF NOT EXISTS idx_openrouter_model_registrations_user ON openrouter_model_registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_openrouter_model_registrations_llm ON openrouter_model_registrations(llm_id);

DROP TRIGGER IF EXISTS update_openrouter_model_registrations_timestamp ON openrouter_model_registrations;
CREATE TRIGGER update_openrouter_model_registrations_timestamp
  BEFORE UPDATE ON openrouter_model_registrations
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS openrouter_embedding_model_registrations (
  openrouter_embedding_model_registration_id SERIAL PRIMARY KEY,
  server_id INT NULL,
  user_id INT NULL,
  embedding_model_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (embedding_model_id) REFERENCES embedding_models(embedding_model_id) ON DELETE CASCADE,
  CHECK ((server_id IS NULL) <> (user_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_openrouter_embedding_model_registrations_server_model
  ON openrouter_embedding_model_registrations(server_id, embedding_model_id)
  WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_openrouter_embedding_model_registrations_user_model
  ON openrouter_embedding_model_registrations(user_id, embedding_model_id)
  WHERE server_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_openrouter_embedding_model_registrations_server
  ON openrouter_embedding_model_registrations(server_id);
CREATE INDEX IF NOT EXISTS idx_openrouter_embedding_model_registrations_user
  ON openrouter_embedding_model_registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_openrouter_embedding_model_registrations_model
  ON openrouter_embedding_model_registrations(embedding_model_id);

DROP TRIGGER IF EXISTS update_openrouter_embedding_model_registrations_timestamp
  ON openrouter_embedding_model_registrations;
CREATE TRIGGER update_openrouter_embedding_model_registrations_timestamp
  BEFORE UPDATE ON openrouter_embedding_model_registrations
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS openrouter_image_model_registrations (
  openrouter_image_model_registration_id SERIAL PRIMARY KEY,
  server_id INT NULL,
  user_id INT NULL,
  diffusion_model_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (diffusion_model_id) REFERENCES image_diffusion_models(diffusion_model_id) ON DELETE CASCADE,
  CHECK ((server_id IS NULL) <> (user_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_openrouter_image_model_registrations_server_model
  ON openrouter_image_model_registrations(server_id, diffusion_model_id)
  WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_openrouter_image_model_registrations_user_model
  ON openrouter_image_model_registrations(user_id, diffusion_model_id)
  WHERE server_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_openrouter_image_model_registrations_server
  ON openrouter_image_model_registrations(server_id);
CREATE INDEX IF NOT EXISTS idx_openrouter_image_model_registrations_user
  ON openrouter_image_model_registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_openrouter_image_model_registrations_model
  ON openrouter_image_model_registrations(diffusion_model_id);

DROP TRIGGER IF EXISTS update_openrouter_image_model_registrations_timestamp
  ON openrouter_image_model_registrations;
CREATE TRIGGER update_openrouter_image_model_registrations_timestamp
  BEFORE UPDATE ON openrouter_image_model_registrations
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS openrouter_video_model_registrations (
  openrouter_video_model_registration_id SERIAL PRIMARY KEY,
  server_id INT NULL,
  user_id INT NULL,
  video_model_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (video_model_id) REFERENCES video_generation_models(video_model_id) ON DELETE CASCADE,
  CHECK ((server_id IS NULL) <> (user_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_openrouter_video_model_registrations_server_model
  ON openrouter_video_model_registrations(server_id, video_model_id)
  WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_openrouter_video_model_registrations_user_model
  ON openrouter_video_model_registrations(user_id, video_model_id)
  WHERE server_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_openrouter_video_model_registrations_server
  ON openrouter_video_model_registrations(server_id);
CREATE INDEX IF NOT EXISTS idx_openrouter_video_model_registrations_user
  ON openrouter_video_model_registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_openrouter_video_model_registrations_model
  ON openrouter_video_model_registrations(video_model_id);

DROP TRIGGER IF EXISTS update_openrouter_video_model_registrations_timestamp
  ON openrouter_video_model_registrations;
CREATE TRIGGER update_openrouter_video_model_registrations_timestamp
  BEFORE UPDATE ON openrouter_video_model_registrations
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ============================================================
-- User Saved Provider Configs (per-user provider config snapshots)
-- Stores personal API keys, model selections, and sampler settings
-- so individual users can power Tomori with their own providers.
-- One row per provider per user. UPSERT on save, DELETE on remove.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_saved_provider_configs (
  user_saved_config_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  provider TEXT NOT NULL,
  api_key BYTEA,
  key_version INTEGER DEFAULT 1,
  llm_id INT,
  diffusion_model_id INT,
  embedding_model_id INT,
  nai_diffusion_model_id INT,
  video_model_id INT,
  vision_llm_id INT,
  nai_preset_name TEXT,
  llm_temperature REAL,
  llm_top_p REAL,
  llm_top_k INTEGER,
  llm_frequency_penalty REAL,
  llm_presence_penalty REAL,
  llm_min_p REAL,
  llm_logit_biases JSONB DEFAULT '[]'::JSONB,
  llm_disabled_params TEXT[] DEFAULT '{}',
  custom_endpoint_url TEXT, -- DEPRECATED Phase 3 rollout: legacy inline custom field; new registrations live in custom_endpoints
  custom_model_name TEXT, -- DEPRECATED Phase 3 rollout: legacy inline custom field; new registrations live in custom_endpoints
  custom_num_ctx INT, -- DEPRECATED Phase 3 rollout: legacy inline custom field; new registrations live in custom_endpoints
  thinking_level TEXT DEFAULT 'auto',
  enabled_capabilities TEXT[] DEFAULT '{}',
  fallback_llm_ids JSONB DEFAULT '[]'::JSONB, -- DEPRECATED Phase 3 rollout: legacy fallback array; replace with fallback_model_refs before dropping
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (llm_id) REFERENCES llms(llm_id) ON DELETE SET NULL,
  FOREIGN KEY (diffusion_model_id) REFERENCES image_diffusion_models(diffusion_model_id) ON DELETE SET NULL,
  FOREIGN KEY (embedding_model_id) REFERENCES embedding_models(embedding_model_id) ON DELETE SET NULL,
  FOREIGN KEY (nai_diffusion_model_id) REFERENCES image_diffusion_models(diffusion_model_id) ON DELETE SET NULL,
  FOREIGN KEY (video_model_id) REFERENCES video_generation_models(video_model_id) ON DELETE SET NULL,
  FOREIGN KEY (vision_llm_id) REFERENCES llms(llm_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_saved_provider_configs_user
  ON user_saved_provider_configs(user_id);

SELECT add_column_if_not_exists('user_saved_provider_configs', 'video_model_id', 'INTEGER', 'NULL');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'vision_llm_id', 'INTEGER', 'NULL');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'llm_temperature', 'REAL', 'NULL');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'llm_top_p', 'REAL', 'NULL');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'llm_top_k', 'INTEGER', 'NULL');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'llm_frequency_penalty', 'REAL', 'NULL');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'llm_presence_penalty', 'REAL', 'NULL');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'llm_min_p', 'REAL', 'NULL');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'llm_logit_biases', 'JSONB', '''[]''::JSONB');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'llm_disabled_params', 'TEXT[]', 'ARRAY[]::TEXT[]');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'custom_endpoint_url', 'TEXT', 'NULL');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'custom_model_name', 'TEXT', 'NULL');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'custom_num_ctx', 'INT', 'NULL');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'thinking_level', 'TEXT', '''auto''');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'enabled_capabilities', 'TEXT[]', 'ARRAY[]::TEXT[]');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'fallback_llm_ids', 'JSONB', '''[]''::JSONB');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'fallback_model_refs', 'JSONB', '''[]''::JSONB');

DROP TRIGGER IF EXISTS update_user_saved_provider_configs_timestamp ON user_saved_provider_configs;
CREATE TRIGGER update_user_saved_provider_configs_timestamp
  BEFORE UPDATE ON user_saved_provider_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ============================================================
-- Context Note / Author's Note (April 2026)
-- Short reminder string injected into conversation history at a
-- user-specified depth from the bottom to reduce context drift.
-- Persona value wins at inference; server (global) value is the fallback.
-- depth=0 means "at the very bottom" (after all fetched messages).
-- depth=N means N messages above the bottom; clamped to top if N > total.
-- ============================================================
-- Per-persona note (on tomoris)
SELECT add_column_if_not_exists('tomoris', 'context_note', 'TEXT', 'NULL');
SELECT add_column_if_not_exists('tomoris', 'context_note_depth', 'INTEGER', '0');
-- Server-wide / global fallback note (on tomori_configs)
SELECT add_column_if_not_exists('tomori_configs', 'context_note', 'TEXT', 'NULL');
SELECT add_column_if_not_exists('tomori_configs', 'context_note_depth', 'INTEGER', '0');

-- ============================================================
-- Voice / TTS feature toggles (March 2026)
-- ============================================================
-- voice_message_enabled: Allow sending ElevenLabs TTS voice messages in this server
SELECT add_column_if_not_exists('tomori_configs', 'voice_message_enabled', 'BOOLEAN', 'true');
-- voice_transcript_chat_mode: Post voice transcripts as webhook chat messages instead of internal cache
SELECT add_column_if_not_exists('tomori_configs', 'voice_transcript_chat_mode', 'BOOLEAN', 'true');
-- Chatterbox local TTS controls. CFG/exaggeration apply only when turbo is disabled.
SELECT add_column_if_not_exists('tomori_configs', 'chatterbox_turbo_enabled', 'BOOLEAN', 'true');
SELECT add_column_if_not_exists('tomori_configs', 'chatterbox_cfg_weight', 'REAL', '0.5');
SELECT add_column_if_not_exists('tomori_configs', 'chatterbox_exaggeration', 'REAL', '0.5');

-- ============================================================
-- Prompt snapshot permission (April 2026)
-- ============================================================
-- prompt_snapshot_enabled: Allow non-admin members to use /tool prompt snapshot
SELECT add_column_if_not_exists('tomori_configs', 'prompt_snapshot_enabled', 'BOOLEAN', 'false');

-- ============================================================
-- Voice samples table + per-persona TTS voice assignment (Phase 4.1)
-- voice_samples stores reference audio clips for local TTS voice cloning.
-- speech_voice_sample_id: FK → voice_samples; used for local TTS clone path.
-- speech_voice_id: Preset voice ID for provider-hosted voices (e.g. ElevenLabs).
-- speech_voice_name: Cached friendly voice display name (either path).
-- speech_voice_design_prompt: Natural-language voice design prompt for instruct-capable local TTS.
-- ============================================================
CREATE TABLE IF NOT EXISTS voice_samples (
  sample_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  ref_text TEXT,
  duration_ms INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_voice_samples_server ON voice_samples(server_id);

SELECT add_column_if_not_exists('tomoris', 'speech_voice_sample_id', 'INTEGER', 'NULL');
SELECT add_column_if_not_exists('tomoris', 'speech_voice_id', 'TEXT', 'NULL');
SELECT add_column_if_not_exists('tomoris', 'speech_voice_name', 'TEXT', 'NULL');
SELECT add_column_if_not_exists('tomoris', 'speech_voice_design_prompt', 'TEXT', 'NULL');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tomoris_speech_voice_sample_id_fkey'
  ) THEN
    ALTER TABLE tomoris
    ADD CONSTRAINT tomoris_speech_voice_sample_id_fkey
    FOREIGN KEY (speech_voice_sample_id)
    REFERENCES voice_samples(sample_id)
    ON DELETE SET NULL;
  END IF;
END $$;

-- Max output tokens override (April 2026)
-- User-configurable generation length cap per saved provider. NULL = use provider default (8192 or hardcoded fallback).
SELECT add_column_if_not_exists('tomori_configs', 'llm_max_output_tokens', 'INTEGER', 'NULL');
SELECT add_column_if_not_exists('saved_provider_configs', 'llm_max_output_tokens', 'INTEGER', 'NULL');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'llm_max_output_tokens', 'INTEGER', 'NULL');

-- Memory tag filtering toggle (May 2026)
SELECT add_column_if_not_exists('tomori_configs', 'memory_tagging_enabled', 'BOOLEAN', 'false');

-- Channel memory toggle (May 2026)
SELECT add_column_if_not_exists('tomori_configs', 'channel_memory_enabled', 'BOOLEAN', 'false');
