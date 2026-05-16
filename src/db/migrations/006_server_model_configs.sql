-- 006_server_model_configs.sql
--
-- Stage B (Contract): Creates the final server_*_configs split table for the
-- remaining tomori_configs columns that Stage A (migrations 002–004) left in place:
--
--   - Model-selection FKs (llm_id, embedding_model_id, diffusion_model_id,
--     video_model_id, vision_llm_id) — no command-aligned split existed in Stage A.
--   - DEPRECATED Phase 1.5 mirrors (api_key, key_version, llm_temperature,
--     thinking_level, llm_disabled_params) — written by /model commands; runtime
--     reads from here until #14.5 drops them and updates callers to read directly
--     from saved_provider_configs.
--   - DEPRECATED Phase 3 fields (custom_endpoint_url, custom_model_name,
--     custom_num_ctx, fallback_llm_ids, other_model_codename,
--     other_model_capabilities, other_model_capabilities_fetched_at) — superseded
--     by saved_provider_configs but still in active use by custom provider callers.
--   - hide_respond_embed BOOLEAN — deprecated; superseded by tool_notice_hidden_keys
--     in server_notice_embeds_configs.
--
-- After this migration and caller redirect (Step 1b code changes), tomori_configs
-- holds no live data and can be safely dropped by migration 007.
--
-- Down migration: 006_server_model_configs.down.sql

CREATE TABLE IF NOT EXISTS server_model_configs (
  server_id                            INT         PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,

  -- Active model selection (owned by /model text, /model image, /model embedding,
  -- /model video, /model vision commands).
  llm_id                               INT         REFERENCES llms(llm_id) ON DELETE SET NULL,
  embedding_model_id                   INT         REFERENCES embedding_models(embedding_model_id) ON DELETE SET NULL,
  diffusion_model_id                   INT         REFERENCES image_diffusion_models(diffusion_model_id) ON DELETE SET NULL,
  video_model_id                       INT         REFERENCES video_generation_models(video_model_id) ON DELETE SET NULL,
  vision_llm_id                        INT         REFERENCES llms(llm_id) ON DELETE SET NULL,

  -- DEPRECATED Phase 1.5: credential mirrors written by /model commands so that the
  -- runtime can load them without resolving saved_provider_configs. Drop in #14.5
  -- once credentialResolver reads directly from saved_provider_configs.
  api_key                              BYTEA,
  key_version                          INT         NOT NULL DEFAULT 1,
  llm_temperature                      REAL        NOT NULL DEFAULT 1.0,
  thinking_level                       TEXT        NOT NULL DEFAULT 'auto',
  llm_disabled_params                  TEXT[]      NOT NULL DEFAULT '{}',

  -- DEPRECATED Phase 3: legacy inline custom endpoint fields; superseded by the
  -- custom_endpoints table and saved_provider_configs. Drop in #14.5.
  custom_endpoint_url                  TEXT,
  custom_model_name                    TEXT,
  custom_num_ctx                       INT,
  fallback_llm_ids                     JSONB       NOT NULL DEFAULT '[]'::JSONB,

  -- DEPRECATED Phase 3: OpenRouter "other-model" capability cache written at
  -- generation time. Retire after custom endpoint migration completes. Drop in #14.5.
  other_model_codename                 TEXT,
  other_model_capabilities             JSONB,
  other_model_capabilities_fetched_at  TIMESTAMPTZ,

  -- DEPRECATED: legacy migrate source for tool_notice_hidden_keys migration.
  -- Superseded by server_notice_embeds_configs.tool_notice_hidden_keys.
  hide_respond_embed                   BOOLEAN     NOT NULL DEFAULT false,

  created_at                           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_server_model_configs_timestamp ON server_model_configs;
CREATE TRIGGER update_server_model_configs_timestamp
  BEFORE UPDATE ON server_model_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Backfill from tomori_configs (server-scoped rows only; per-persona legacy rows
-- via tomori_id have no server_id and are excluded — they are handled by the
-- persona_configs tables created in migration 003).
INSERT INTO server_model_configs (
  server_id,
  llm_id,
  embedding_model_id,
  diffusion_model_id,
  video_model_id,
  vision_llm_id,
  api_key,
  key_version,
  llm_temperature,
  thinking_level,
  llm_disabled_params,
  custom_endpoint_url,
  custom_model_name,
  custom_num_ctx,
  fallback_llm_ids,
  other_model_codename,
  other_model_capabilities,
  other_model_capabilities_fetched_at,
  hide_respond_embed
)
SELECT
  server_id,
  llm_id,
  embedding_model_id,
  diffusion_model_id,
  video_model_id,
  vision_llm_id,
  api_key,
  COALESCE(key_version, 1),
  COALESCE(llm_temperature, 1.0),
  COALESCE(thinking_level, 'auto'),
  COALESCE(llm_disabled_params, '{}'),
  custom_endpoint_url,
  custom_model_name,
  custom_num_ctx,
  COALESCE(fallback_llm_ids, '[]'::JSONB),
  other_model_codename,
  other_model_capabilities,
  other_model_capabilities_fetched_at,
  COALESCE(hide_respond_embed, false)
FROM tomori_configs
WHERE server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;
