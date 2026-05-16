-- 002_server_config_tables.sql
--
-- Stage A (Expand): creates 13 command-aligned server_*_configs tables and
-- backfills data from tomori_configs. The god table is left intact; Stage B
-- (a future session after at least one production-shaped release soaks here)
-- will migrate callers and drop tomori_configs.
--
-- Column assignment rationale (commit message supplement):
--   server_chat_configs        — /config humanizer, /config message-fetch-limit,
--                                /config send-limit, /config match-limit,
--                                /config cascade-limit, /config timezone,
--                                /config self-debug, /config system-prompt,
--                                /config context-note, /model parameters,
--                                /model stop-strings, /model fallback
--   server_notice_embeds_configs — /config notice-embeds visibility
--   server_member_permissions_configs — /server member-permissions
--   server_channel_scope_configs — /server rp-channels, /server private-channels,
--                                   /server crosschannel-blocklist,
--                                   /server stm privacy-bypass,
--                                   /server thought-logs-channel
--   server_welcome_configs     — /server welcome-channel
--   server_trigger_behavior_configs — /server always-reply,
--                                      /server deliberate-trigger-mode,
--                                      /server cooldown triggers
--   server_auto_trigger_configs — /server auto-trigger channels/threshold
--   server_capabilities_configs — /capabilities manage, /capabilities toggle
--   server_novelai_imagegen_configs — /novelai image parameters/tags
--   server_nsfw_configs        — /nsfw jailbreaks
--   server_speech_configs      — /speech chatterbox parameters/transcripts
--   server_byok_configs        — /server user-byok toggle
--   server_memory_configs      — /memory tagging set
--
-- Columns NOT moved to any new table (remain only in tomori_configs):
--   llm_id, embedding_model_id, diffusion_model_id, video_model_id,
--   vision_llm_id — model-selection FKs; no command-aligned config table exists yet
--   api_key, key_version, llm_temperature — DEPRECATED Phase 1.5 mirrors
--   llm_disabled_params, thinking_level — DEPRECATED Phase 1.5 mirrors
--   custom_endpoint_url, custom_model_name, custom_num_ctx,
--   fallback_llm_ids — DEPRECATED Phase 3
--   trigger_words — already migrated to persona_configs
--   hide_respond_embed — deprecated; superseded by tool_notice_hidden_keys
--   tomori_config_id, tomori_id, server_id — PKs/FK anchors
--   created_at, updated_at — auto-managed per-row

-- ── server_chat_configs ──────────────────────────────────────────────────────
-- Owns all text-generation-affecting configuration written by /config and /model
-- commands. Column count exceeds the 15-column fission threshold; see the
-- check-schema exemption added in 004_check_schema_soft_warning for the
-- documented justification (aggregate /config + /model parameter surface).

CREATE TABLE IF NOT EXISTS server_chat_configs (
  server_id               INT         PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,
  humanizer_degree        INT         NOT NULL DEFAULT 1,
  message_fetch_limit     INT         NOT NULL DEFAULT 80,
  send_message_limit      INT         NOT NULL DEFAULT 0,
  match_limit             INT         NOT NULL DEFAULT 3,
  cascade_limit           INT         NOT NULL DEFAULT 3,
  timezone_offset         INT         NOT NULL DEFAULT 0,
  self_debug_enabled      BOOLEAN     NOT NULL DEFAULT false,
  system_prompt           TEXT,
  context_note            TEXT,
  context_note_depth      INT         NOT NULL DEFAULT 0,
  llm_stop_strings        TEXT[]      NOT NULL DEFAULT '{}',
  llm_stop_speaker_pattern_enabled BOOLEAN NOT NULL DEFAULT false,
  llm_max_output_tokens   INT,
  llm_top_p               REAL        NOT NULL DEFAULT 0.95,
  llm_top_k               INT         NOT NULL DEFAULT 0,
  llm_frequency_penalty   REAL        NOT NULL DEFAULT 0.0,
  llm_presence_penalty    REAL        NOT NULL DEFAULT 0.0,
  llm_min_p               REAL        NOT NULL DEFAULT 0.05,
  llm_logit_biases        JSONB       NOT NULL DEFAULT '[]'::JSONB,
  fallback_model_refs     JSONB       NOT NULL DEFAULT '[]'::JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_server_chat_configs_timestamp ON server_chat_configs;
CREATE TRIGGER update_server_chat_configs_timestamp
  BEFORE UPDATE ON server_chat_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

INSERT INTO server_chat_configs (
  server_id, humanizer_degree, message_fetch_limit, send_message_limit,
  match_limit, cascade_limit, timezone_offset, self_debug_enabled,
  system_prompt, context_note, context_note_depth,
  llm_stop_strings, llm_stop_speaker_pattern_enabled, llm_max_output_tokens,
  llm_top_p, llm_top_k, llm_frequency_penalty, llm_presence_penalty, llm_min_p,
  llm_logit_biases, fallback_model_refs
)
SELECT
  server_id,
  COALESCE(humanizer_degree, 1),
  COALESCE(message_fetch_limit, 80),
  COALESCE(send_message_limit, 0),
  COALESCE(match_limit, 3),
  COALESCE(cascade_limit, 3),
  COALESCE(timezone_offset, 0),
  COALESCE(self_debug_enabled, false),
  system_prompt,
  context_note,
  COALESCE(context_note_depth, 0),
  COALESCE(llm_stop_strings, '{}'),
  COALESCE(llm_stop_speaker_pattern_enabled, false),
  llm_max_output_tokens,
  COALESCE(llm_top_p, 0.95),
  COALESCE(llm_top_k, 0),
  COALESCE(llm_frequency_penalty, 0.0),
  COALESCE(llm_presence_penalty, 0.0),
  COALESCE(llm_min_p, 0.05),
  COALESCE(llm_logit_biases, '[]'::JSONB),
  COALESCE(fallback_model_refs, '[]'::JSONB)
FROM tomori_configs
WHERE server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_notice_embeds_configs ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS server_notice_embeds_configs (
  server_id              INT      PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,
  tool_notice_hidden_keys TEXT[]  NOT NULL DEFAULT '{}',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_server_notice_embeds_configs_timestamp ON server_notice_embeds_configs;
CREATE TRIGGER update_server_notice_embeds_configs_timestamp
  BEFORE UPDATE ON server_notice_embeds_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

INSERT INTO server_notice_embeds_configs (server_id, tool_notice_hidden_keys)
SELECT server_id, COALESCE(tool_notice_hidden_keys, '{}')
FROM tomori_configs
WHERE server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_member_permissions_configs ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS server_member_permissions_configs (
  server_id                       INT     PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,
  server_memteaching_enabled      BOOLEAN NOT NULL DEFAULT true,
  attribute_memteaching_enabled   BOOLEAN NOT NULL DEFAULT false,
  sampledialogue_memteaching_enabled BOOLEAN NOT NULL DEFAULT false,
  self_teaching_enabled           BOOLEAN NOT NULL DEFAULT true,
  personal_memories_enabled       BOOLEAN NOT NULL DEFAULT true,
  hide_impersonation_embeds       BOOLEAN NOT NULL DEFAULT false,
  prompt_snapshot_enabled         BOOLEAN NOT NULL DEFAULT false,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_server_member_permissions_configs_timestamp ON server_member_permissions_configs;
CREATE TRIGGER update_server_member_permissions_configs_timestamp
  BEFORE UPDATE ON server_member_permissions_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

INSERT INTO server_member_permissions_configs (
  server_id, server_memteaching_enabled, attribute_memteaching_enabled,
  sampledialogue_memteaching_enabled, self_teaching_enabled, personal_memories_enabled,
  hide_impersonation_embeds, prompt_snapshot_enabled
)
SELECT
  server_id,
  COALESCE(server_memteaching_enabled, true),
  COALESCE(attribute_memteaching_enabled, false),
  COALESCE(sampledialogue_memteaching_enabled, false),
  COALESCE(self_teaching_enabled, true),
  COALESCE(personal_memories_enabled, true),
  COALESCE(hide_impersonation_embeds, false),
  COALESCE(prompt_snapshot_enabled, false)
FROM tomori_configs
WHERE server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_channel_scope_configs ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS server_channel_scope_configs (
  server_id                   INT      PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,
  rp_channel_ids              TEXT[]   NOT NULL DEFAULT '{}',
  private_channel_ids         TEXT[]   NOT NULL DEFAULT '{}',
  crosschannel_blocklist_ids  TEXT[]   NOT NULL DEFAULT '{}',
  stm_privacy_bypass          BOOLEAN  NOT NULL DEFAULT false,
  thought_log_channel_disc_id TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_server_channel_scope_configs_timestamp ON server_channel_scope_configs;
CREATE TRIGGER update_server_channel_scope_configs_timestamp
  BEFORE UPDATE ON server_channel_scope_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

INSERT INTO server_channel_scope_configs (
  server_id, rp_channel_ids, private_channel_ids, crosschannel_blocklist_ids,
  stm_privacy_bypass, thought_log_channel_disc_id
)
SELECT
  server_id,
  COALESCE(rp_channel_ids, '{}'),
  COALESCE(private_channel_ids, '{}'),
  COALESCE(crosschannel_blocklist_ids, '{}'),
  COALESCE(stm_privacy_bypass, false),
  thought_log_channel_disc_id
FROM tomori_configs
WHERE server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_welcome_configs ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS server_welcome_configs (
  server_id              INT  PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,
  welcome_channel_disc_id TEXT,
  welcome_prompt         TEXT,
  -- welcome_persona_id: FK to tomoris; SET NULL on persona deletion so welcome config survives
  welcome_persona_id     INT  REFERENCES tomoris(tomori_id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_server_welcome_configs_timestamp ON server_welcome_configs;
CREATE TRIGGER update_server_welcome_configs_timestamp
  BEFORE UPDATE ON server_welcome_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

INSERT INTO server_welcome_configs (server_id, welcome_channel_disc_id, welcome_prompt, welcome_persona_id)
SELECT server_id, welcome_channel_disc_id, welcome_prompt, welcome_persona_id
FROM tomori_configs
WHERE server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_trigger_behavior_configs ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS server_trigger_behavior_configs (
  server_id              INT     PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,
  always_reply_enabled   BOOLEAN NOT NULL DEFAULT false,
  deliberate_trigger_mode BOOLEAN NOT NULL DEFAULT false,
  cooldown_type          INT     NOT NULL DEFAULT 0,
  cooldown_length        INT     NOT NULL DEFAULT 5,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_server_trigger_behavior_configs_timestamp ON server_trigger_behavior_configs;
CREATE TRIGGER update_server_trigger_behavior_configs_timestamp
  BEFORE UPDATE ON server_trigger_behavior_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

INSERT INTO server_trigger_behavior_configs (
  server_id, always_reply_enabled, deliberate_trigger_mode, cooldown_type, cooldown_length
)
SELECT
  server_id,
  COALESCE(always_reply_enabled, false),
  COALESCE(deliberate_trigger_mode, false),
  COALESCE(cooldown_type, 0),
  COALESCE(cooldown_length, 5)
FROM tomori_configs
WHERE server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_auto_trigger_configs ──────────────────────────────────────────────
-- Note: autoch_persona_overrides is kept as JSONB here for Stage A.
-- Step #15 junction-ifies this column into server_auto_trigger_persona_overrides.

CREATE TABLE IF NOT EXISTS server_auto_trigger_configs (
  server_id              INT    PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,
  autoch_disc_ids        TEXT[] NOT NULL DEFAULT '{}',
  autoch_persona_overrides JSONB NOT NULL DEFAULT '[]'::JSONB,
  autoch_threshold       INT    NOT NULL DEFAULT 0,
  autoch_threshold_max   INT    NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_server_auto_trigger_configs_timestamp ON server_auto_trigger_configs;
CREATE TRIGGER update_server_auto_trigger_configs_timestamp
  BEFORE UPDATE ON server_auto_trigger_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

INSERT INTO server_auto_trigger_configs (
  server_id, autoch_disc_ids, autoch_persona_overrides, autoch_threshold, autoch_threshold_max
)
SELECT
  server_id,
  COALESCE(autoch_disc_ids, '{}'),
  COALESCE(autoch_persona_overrides, '[]'::JSONB),
  COALESCE(autoch_threshold, 0),
  COALESCE(autoch_threshold_max, 0)
FROM tomori_configs
WHERE server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_capabilities_configs ──────────────────────────────────────────────
-- Uniform boolean cluster managed by /capabilities manage and /capabilities toggle.
-- Column count is exempt from the 15-column threshold (structurally uniform booleans
-- iterated by PERMISSION_DEFINITIONS array).

CREATE TABLE IF NOT EXISTS server_capabilities_configs (
  server_id             INT     PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,
  emoji_usage_enabled   BOOLEAN NOT NULL DEFAULT true,
  sticker_usage_enabled BOOLEAN NOT NULL DEFAULT true,
  web_search_enabled    BOOLEAN NOT NULL DEFAULT true,
  manage_message_enabled BOOLEAN NOT NULL DEFAULT true,
  thread_creation_enabled BOOLEAN NOT NULL DEFAULT true,
  imagegen_enabled      BOOLEAN NOT NULL DEFAULT true,
  videogen_enabled      BOOLEAN NOT NULL DEFAULT false,
  voice_message_enabled BOOLEAN NOT NULL DEFAULT true,
  tool_use_enabled      BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_server_capabilities_configs_timestamp ON server_capabilities_configs;
CREATE TRIGGER update_server_capabilities_configs_timestamp
  BEFORE UPDATE ON server_capabilities_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

INSERT INTO server_capabilities_configs (
  server_id, emoji_usage_enabled, sticker_usage_enabled, web_search_enabled,
  manage_message_enabled, thread_creation_enabled, imagegen_enabled, videogen_enabled,
  voice_message_enabled, tool_use_enabled
)
SELECT
  server_id,
  COALESCE(emoji_usage_enabled, true),
  COALESCE(sticker_usage_enabled, true),
  COALESCE(web_search_enabled, true),
  COALESCE(manage_message_enabled, true),
  COALESCE(thread_creation_enabled, true),
  COALESCE(imagegen_enabled, true),
  COALESCE(videogen_enabled, false),
  COALESCE(voice_message_enabled, true),
  COALESCE(tool_use_enabled, true)
FROM tomori_configs
WHERE server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_novelai_imagegen_configs ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS server_novelai_imagegen_configs (
  server_id             INT       PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,
  nai_preset_name       TEXT,
  nai_style_tags        TEXT[]    NOT NULL DEFAULT '{"8k","absurdres","masterpiece","best quality","good quality","newest"}',
  nai_negative_tags     TEXT[]    NOT NULL DEFAULT '{"lowres","worst quality","low quality","bad quality","old","oldest","unfinished","scan artifacts","jpeg artifacts","jaggy lines","unclear","sketch","blurry","bad anatomy","very displeasing","displeasing","bad hands","bad fingers","missing fingers","bad proportions","bad perspective","bad eyes","bad pupils","multiple heads","extra faces","many arms","poorly drawn face","poorly drawn hands","fused hands","bad feet","too many legs","malformed limbs","extra arms","multiple ears","extra digits","fewer digits","twitter username","username","watermark","signature","2koma","4koma","comic"}',
  nai_sampler           TEXT,
  nai_steps             SMALLINT,
  nai_scale             REAL,
  nai_noise_schedule    TEXT,
  nai_cfg_rescale       REAL,
  nai_diffusion_model_id INT      REFERENCES image_diffusion_models(diffusion_model_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_server_novelai_imagegen_configs_timestamp ON server_novelai_imagegen_configs;
CREATE TRIGGER update_server_novelai_imagegen_configs_timestamp
  BEFORE UPDATE ON server_novelai_imagegen_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

INSERT INTO server_novelai_imagegen_configs (
  server_id, nai_preset_name, nai_style_tags, nai_negative_tags,
  nai_sampler, nai_steps, nai_scale, nai_noise_schedule, nai_cfg_rescale,
  nai_diffusion_model_id
)
SELECT
  server_id,
  nai_preset_name,
  COALESCE(nai_style_tags, '{"8k","absurdres","masterpiece","best quality","good quality","newest"}'),
  COALESCE(nai_negative_tags, '{"lowres","worst quality","low quality","bad quality","old","oldest","unfinished","scan artifacts","jpeg artifacts","jaggy lines","unclear","sketch","blurry","bad anatomy","very displeasing","displeasing","bad hands","bad fingers","missing fingers","bad proportions","bad perspective","bad eyes","bad pupils","multiple heads","extra faces","many arms","poorly drawn face","poorly drawn hands","fused hands","bad feet","too many legs","malformed limbs","extra arms","multiple ears","extra digits","fewer digits","twitter username","username","watermark","signature","2koma","4koma","comic"}'),
  nai_sampler,
  nai_steps,
  nai_scale,
  nai_noise_schedule,
  nai_cfg_rescale,
  nai_diffusion_model_id
FROM tomori_configs
WHERE server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_nsfw_configs ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS server_nsfw_configs (
  server_id                       INT     PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,
  uncensor_injection_enabled      BOOLEAN NOT NULL DEFAULT false,
  uncensor_unicode_space_enabled  BOOLEAN NOT NULL DEFAULT false,
  uncensor_sanitize_enabled       BOOLEAN NOT NULL DEFAULT false,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_server_nsfw_configs_timestamp ON server_nsfw_configs;
CREATE TRIGGER update_server_nsfw_configs_timestamp
  BEFORE UPDATE ON server_nsfw_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

INSERT INTO server_nsfw_configs (
  server_id, uncensor_injection_enabled, uncensor_unicode_space_enabled, uncensor_sanitize_enabled
)
SELECT
  server_id,
  COALESCE(uncensor_injection_enabled, false),
  COALESCE(uncensor_unicode_space_enabled, false),
  COALESCE(uncensor_sanitize_enabled, false)
FROM tomori_configs
WHERE server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_speech_configs ────────────────────────────────────────────────────
-- Note: voice_message_enabled is in server_capabilities_configs (managed by
-- /capabilities manage), not here.

CREATE TABLE IF NOT EXISTS server_speech_configs (
  server_id                  INT    PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,
  voice_transcript_chat_mode BOOLEAN NOT NULL DEFAULT true,
  chatterbox_turbo_enabled   BOOLEAN NOT NULL DEFAULT true,
  chatterbox_cfg_weight      REAL    NOT NULL DEFAULT 0.5,
  chatterbox_exaggeration    REAL    NOT NULL DEFAULT 0.5,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_server_speech_configs_timestamp ON server_speech_configs;
CREATE TRIGGER update_server_speech_configs_timestamp
  BEFORE UPDATE ON server_speech_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

INSERT INTO server_speech_configs (
  server_id, voice_transcript_chat_mode, chatterbox_turbo_enabled,
  chatterbox_cfg_weight, chatterbox_exaggeration
)
SELECT
  server_id,
  COALESCE(voice_transcript_chat_mode, true),
  COALESCE(chatterbox_turbo_enabled, true),
  COALESCE(chatterbox_cfg_weight, 0.5),
  COALESCE(chatterbox_exaggeration, 0.5)
FROM tomori_configs
WHERE server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_byok_configs ──────────────────────────────────────────────────────
-- Kept as a standalone table to prevent capabilities-namespace bleed.

CREATE TABLE IF NOT EXISTS server_byok_configs (
  server_id      INT     PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,
  user_byok_mode BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_server_byok_configs_timestamp ON server_byok_configs;
CREATE TRIGGER update_server_byok_configs_timestamp
  BEFORE UPDATE ON server_byok_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

INSERT INTO server_byok_configs (server_id, user_byok_mode)
SELECT server_id, COALESCE(user_byok_mode, false)
FROM tomori_configs
WHERE server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_memory_configs ────────────────────────────────────────────────────
-- Seeded with one column so future /memory config commands have an obvious home.

CREATE TABLE IF NOT EXISTS server_memory_configs (
  server_id              INT     PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,
  memory_tagging_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_server_memory_configs_timestamp ON server_memory_configs;
CREATE TRIGGER update_server_memory_configs_timestamp
  BEFORE UPDATE ON server_memory_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

INSERT INTO server_memory_configs (server_id, memory_tagging_enabled)
SELECT server_id, COALESCE(memory_tagging_enabled, false)
FROM tomori_configs
WHERE server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;
