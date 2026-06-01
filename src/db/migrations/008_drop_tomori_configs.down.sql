-- Migration 008 Rollback: Restore legacy tomori_configs table
-- Note: This is a structural restoration only. Data dropped in the 
-- forward migration cannot be recovered via schema downgrade.

CREATE TABLE IF NOT EXISTS tomori_configs (
    tomori_config_id SERIAL PRIMARY KEY,
    tomori_id INT UNIQUE,
    server_id INT,
    llm_id INT,
    embedding_model_id INT,
    llm_temperature REAL NOT NULL DEFAULT 1.0 CHECK (llm_temperature >= 0.0 AND llm_temperature <= 2.0),
    api_key BYTEA,
    key_version INTEGER DEFAULT 1,
    trigger_words TEXT[] DEFAULT '{}',
    autoch_disc_ids TEXT[] DEFAULT '{}',
    autoch_persona_overrides JSONB DEFAULT '[]'::JSONB,
    autoch_threshold INT DEFAULT 0,
    autoch_threshold_max INT DEFAULT 0,
    message_fetch_limit INT DEFAULT 80,
    server_memteaching_enabled BOOLEAN DEFAULT true,
    attribute_memteaching_enabled BOOLEAN DEFAULT false,
    sampledialogue_memteaching_enabled BOOLEAN DEFAULT false,
    self_teaching_enabled BOOLEAN DEFAULT true,
    personal_memories_enabled BOOLEAN DEFAULT true,
    memory_tagging_enabled BOOLEAN DEFAULT false,
    imagegen_enabled BOOLEAN DEFAULT true,
    videogen_enabled BOOLEAN DEFAULT false,
    thread_creation_enabled BOOLEAN DEFAULT true,
    tool_notice_hidden_keys TEXT[] DEFAULT '{}',
    llm_disabled_params TEXT[] DEFAULT '{}',
    llm_stop_strings TEXT[] DEFAULT '{}',
    llm_stop_speaker_pattern_enabled BOOLEAN DEFAULT false,
    humanizer_degree INT DEFAULT 1,
    thinking_level TEXT DEFAULT 'auto',
    user_byok_mode BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
