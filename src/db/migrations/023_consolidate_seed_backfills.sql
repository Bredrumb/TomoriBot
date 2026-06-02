-- Consolidates legacy compatibility/backfill work that previously lived in src/db/seed.sql.
--
-- Seed catalog data still runs every startup from src/db/seed/*.sql. These
-- blocks are schema compatibility guards and one-time legacy data repairs, so
-- they belong in the numbered migration stream and are intentionally idempotent.

-- Column compatibility guards formerly at the top of seed.sql.

SELECT add_column_if_not_exists('llms', 'is_scoped_registration', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('image_diffusion_models', 'is_scoped_registration', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('video_generation_models', 'is_scoped_registration', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('embedding_models', 'is_scoped_registration', 'BOOLEAN', 'false');
-- Deliberate tool mode columns live in server_trigger_behavior_configs (per-domain split, May 2026).
-- channel_memory_enabled lives in server_memory_configs (per-domain split, May 2026).
SELECT add_column_if_not_exists('users', 'personal_deliberate_tool_mode', 'TEXT', '''follow''');

-- Ensure all required columns exist in saved_provider_configs table
SELECT add_column_if_not_exists('saved_provider_configs', 'fallback_model_refs', 'JSONB', '''[]''::JSONB');

-- Ensure all required columns exist in user_saved_provider_configs table
SELECT add_column_if_not_exists('user_saved_provider_configs', 'fallback_model_refs', 'JSONB', '''[]''::JSONB');

-- Ensure all required columns exist in persona_configs table
SELECT add_column_if_not_exists('persona_configs', 'reward_conditioning_enabled', 'BOOLEAN', 'true');
SELECT add_column_if_not_exists('persona_configs', 'punish_conditioning_enabled', 'BOOLEAN', 'true');

-- Ensure all required columns exist in conditioning_history table
SELECT add_column_if_not_exists('conditioning_history', 'action_text', 'TEXT');

-- Ensure all required columns exist in llms table
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

-- Ensure all required columns exist in image_diffusion_models table
SELECT add_column_if_not_exists('image_diffusion_models', 'is_scoped_registration', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('image_diffusion_models', 'is_default', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('image_diffusion_models', 'is_deprecated', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('image_diffusion_models', 'is_free', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('image_diffusion_models', 'is_uncensored', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('image_diffusion_models', 'model_description', 'TEXT');
SELECT add_column_if_not_exists('image_diffusion_models', 'ja_description', 'TEXT');

-- Ensure all required columns exist in embedding_models table
SELECT add_column_if_not_exists('embedding_models', 'is_scoped_registration', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('embedding_models', 'model_family', 'TEXT');
SELECT add_column_if_not_exists('embedding_models', 'model_description', 'TEXT');
SELECT add_column_if_not_exists('embedding_models', 'ja_description', 'TEXT');
SELECT add_column_if_not_exists('embedding_models', 'is_default', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('embedding_models', 'is_deprecated', 'BOOLEAN', 'false');

-- Persona speech compatibility columns formerly near the voice_samples seed block.

SELECT add_column_if_not_exists('personas', 'speech_voice_sample_id', 'INTEGER');
SELECT add_column_if_not_exists('personas', 'speech_voice_id', 'TEXT');
SELECT add_column_if_not_exists('personas', 'speech_voice_name', 'TEXT');
SELECT add_column_if_not_exists('personas', 'speech_voice_design_prompt', 'TEXT');

-- One-time legacy data backfills formerly run from seed.sql.

-- Mark account-setting as deprecated (legacy codename no longer used for new configs).
-- Databases that still have this row will see it deprecated; new installs get it via the INSERT below.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM llms WHERE llm_codename = 'account-setting') THEN
        UPDATE llms SET is_deprecated = true WHERE llm_codename = 'account-setting';
        RAISE NOTICE 'Marked account-setting as deprecated';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'account-setting deprecation skipped: %', SQLERRM;
END $$;

-- Migrate previously-saved legacy Z.ai Coding snapshots to the renamed coding provider.
-- This must only touch old plain-GLM snapshots. New general Z.ai snapshots use
-- prefixed `zai/...` model rows and should remain mapped to `zai`.
DO $$
BEGIN
    UPDATE saved_provider_configs spc
    SET provider = 'zaicoding'
    WHERE spc.provider = 'zai'
      AND (
          EXISTS (
              SELECT 1
              FROM llms l
              WHERE l.llm_id = spc.llm_id
                AND l.llm_provider = 'zaicoding'
          )
          OR EXISTS (
              SELECT 1
              FROM llms l
              WHERE l.llm_id = spc.vision_llm_id
                AND l.llm_provider = 'zaicoding'
          )
          OR EXISTS (
              SELECT 1
              FROM image_diffusion_models dm
              WHERE dm.diffusion_model_id = spc.diffusion_model_id
                AND dm.provider = 'zaicoding'
          )
      );
EXCEPTION
    WHEN undefined_table THEN
        RAISE NOTICE 'saved_provider_configs not found, skipping provider migration';
END $$;

-- Phase 1 provider rehaul: promote saved_provider_configs to the canonical
-- provider-credentials vault by backfilling active provider rows and relevant
-- optional-key providers on every startup until production data is confirmed.

DO $$
DECLARE
    inserted_count INTEGER := 0;
    novelai_default_diffusion_id INTEGER;
BEGIN
    SELECT dm.diffusion_model_id
    INTO novelai_default_diffusion_id
    FROM image_diffusion_models dm
    WHERE dm.provider = 'novelai'
      AND dm.is_deprecated = false
    ORDER BY CASE WHEN dm.is_default THEN 0 ELSE 1 END, dm.diffusion_model_id ASC
    LIMIT 1;

    INSERT INTO saved_provider_configs (
        server_id,
        provider,
        api_key,
        key_version,
        llm_id,
        diffusion_model_id,
        embedding_model_id,
        video_model_id,
        nai_diffusion_model_id,
        vision_llm_id,
        nai_preset_name,
        thinking_level,
        llm_logit_biases,
        llm_disabled_params
    )
    SELECT
        oak.server_id,
        'novelai',
        oak.api_key,
        COALESCE(oak.key_version, 1),
        (
            SELECT l.llm_id
            FROM llms l
            WHERE l.llm_provider = 'novelai'
              AND l.is_deprecated = false
            ORDER BY CASE WHEN l.is_default THEN 0 ELSE 1 END, l.llm_id ASC
            LIMIT 1
        ),
        NULL,
        NULL,
        NULL,
        novelai_default_diffusion_id,
        NULL,
        NULL,
        'auto',
        '[]'::JSONB,
        ARRAY[]::TEXT[]
    FROM opt_api_keys oak
    WHERE oak.service_name = 'novelai'
      AND NOT EXISTS (
          SELECT 1
          FROM saved_provider_configs spc
          WHERE spc.server_id = oak.server_id
            AND spc.provider = 'novelai'
      )
    ON CONFLICT (server_id, provider) DO NOTHING;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    IF inserted_count > 0 THEN
        RAISE NOTICE 'Phase 1 backfill inserted % NovelAI saved config row(s) from opt_api_keys', inserted_count;
    END IF;

EXCEPTION
    WHEN undefined_table THEN
        RAISE NOTICE 'Phase 1 NovelAI opt-key backfill skipped: required table missing';
END $$;

DO $$
DECLARE
    inserted_count INTEGER := 0;
BEGIN
    INSERT INTO saved_provider_configs (
        server_id,
        provider,
        api_key,
        key_version,
        llm_id,
        diffusion_model_id,
        embedding_model_id,
        video_model_id,
        nai_diffusion_model_id,
        vision_llm_id,
        nai_preset_name,
        thinking_level,
        llm_logit_biases,
        llm_disabled_params
    )
    SELECT
        oak.server_id,
        'google',
        oak.api_key,
        COALESCE(oak.key_version, 1),
        (
            SELECT l.llm_id
            FROM llms l
            WHERE l.llm_provider = 'google'
              AND l.is_deprecated = false
            ORDER BY CASE WHEN l.is_default THEN 0 ELSE 1 END, l.llm_id ASC
            LIMIT 1
        ),
        (
            SELECT dm.diffusion_model_id
            FROM image_diffusion_models dm
            WHERE dm.provider = 'google'
              AND dm.is_deprecated = false
            ORDER BY CASE WHEN dm.is_default THEN 0 ELSE 1 END, dm.diffusion_model_id ASC
            LIMIT 1
        ),
        (
            SELECT em.embedding_model_id
            FROM embedding_models em
            WHERE em.provider = 'google'
              AND em.is_deprecated = false
            ORDER BY CASE WHEN em.is_default THEN 0 ELSE 1 END, em.embedding_model_id ASC
            LIMIT 1
        ),
        (
            SELECT vm.video_model_id
            FROM video_generation_models vm
            WHERE vm.provider = 'google'
              AND vm.is_deprecated = false
            ORDER BY CASE WHEN vm.is_default THEN 0 ELSE 1 END, vm.video_model_id ASC
            LIMIT 1
        ),
        NULL,
        (
            SELECT l.llm_id
            FROM llms l
            WHERE l.llm_provider = 'google'
              AND l.sees_images = true
              AND l.is_deprecated = false
            ORDER BY CASE WHEN l.is_default THEN 0 ELSE 1 END, l.llm_id ASC
            LIMIT 1
        ),
        NULL,
        'auto',
        '[]'::JSONB,
        ARRAY[]::TEXT[]
    FROM opt_api_keys oak
    WHERE oak.service_name = 'google'
      AND NOT EXISTS (
          SELECT 1
          FROM saved_provider_configs spc
          WHERE spc.server_id = oak.server_id
            AND spc.provider = 'google'
      )
    ON CONFLICT (server_id, provider) DO NOTHING;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    IF inserted_count > 0 THEN
        RAISE NOTICE 'Phase 1 backfill inserted % Google saved config row(s) from opt_api_keys', inserted_count;
    END IF;
EXCEPTION
    WHEN undefined_table THEN
        RAISE NOTICE 'Phase 1 Google opt-key backfill skipped: required table missing';
END $$;

-- Rename legacy NovelAI diffusion codenames that used period separators (4.5 -> 4-5).
-- Preserve the old seed.sql behavior: rename in-place only when the stable row
-- is absent. If both rows already exist, keep the legacy row and its references.
DO $$
DECLARE
    old_id INTEGER;
    new_id INTEGER;
BEGIN
    SELECT diffusion_model_id INTO old_id
    FROM image_diffusion_models
    WHERE provider = 'novelai'
      AND codename = 'nai-diffusion-4.5-full';

    SELECT diffusion_model_id INTO new_id
    FROM image_diffusion_models
    WHERE provider = 'novelai'
      AND codename = 'nai-diffusion-4-5-full';

    IF old_id IS NOT NULL AND new_id IS NULL THEN
        UPDATE image_diffusion_models
        SET codename = 'nai-diffusion-4-5-full'
        WHERE diffusion_model_id = old_id;
    END IF;

    SELECT diffusion_model_id INTO old_id
    FROM image_diffusion_models
    WHERE provider = 'novelai'
      AND codename = 'nai-diffusion-4.5-curated';

    SELECT diffusion_model_id INTO new_id
    FROM image_diffusion_models
    WHERE provider = 'novelai'
      AND codename = 'nai-diffusion-4-5-curated';

    IF old_id IS NOT NULL AND new_id IS NULL THEN
        UPDATE image_diffusion_models
        SET codename = 'nai-diffusion-4-5-curated'
        WHERE diffusion_model_id = old_id;
    END IF;
EXCEPTION
    WHEN undefined_table THEN
        RAISE NOTICE 'image diffusion codename migration skipped: required table missing';
    WHEN undefined_column THEN
        RAISE NOTICE 'image diffusion codename migration skipped: required column missing';
END $$;

-- Rename legacy Gemini embedding preview codenames into stable rows.
-- Preserve the old seed.sql behavior: rename in-place only when the stable row
-- is absent. If both rows already exist, keep the legacy row and its references.
DO $$
DECLARE
    mapping RECORD;
    old_id INTEGER;
    new_id INTEGER;
BEGIN
    FOR mapping IN
        SELECT *
        FROM (VALUES
            ('google', 'gemini-embedding-2-preview', 'gemini-embedding-2'),
            ('vertex', 'gemini-embedding-2-preview', 'gemini-embedding-2'),
            ('openrouter', 'google/gemini-embedding-2-preview', 'google/gemini-embedding-2')
        ) AS codename_map(provider, old_codename, new_codename)
    LOOP
        SELECT embedding_model_id INTO old_id
        FROM embedding_models
        WHERE provider = mapping.provider
          AND codename = mapping.old_codename;

        SELECT embedding_model_id INTO new_id
        FROM embedding_models
        WHERE provider = mapping.provider
          AND codename = mapping.new_codename;

        IF old_id IS NOT NULL AND new_id IS NULL THEN
            UPDATE embedding_models
            SET codename = mapping.new_codename,
                model_family = 'gemini-embedding-2',
                is_default = mapping.provider IN ('google', 'vertex'),
                is_deprecated = false,
                model_description = CASE mapping.provider
                    WHEN 'google' THEN 'Default Gemini embedding model for document retrieval'
                    WHEN 'vertex' THEN 'Default Gemini embedding model for document retrieval via Vertex AI'
                    ELSE 'Gemini embedding model via OpenRouter (same family as Google)'
                END,
                ja_description = CASE mapping.provider
                    WHEN 'google' THEN '文書検索向けのGeminiデフォルト埋め込みモデル'
                    WHEN 'vertex' THEN 'Vertex AI経由の文書検索向けGeminiデフォルト埋め込みモデル'
                    ELSE 'OpenRouter経由のGemini埋め込みモデル（Googleと同一ファミリー）'
                END,
                updated_at = CURRENT_TIMESTAMP
            WHERE embedding_model_id = old_id;
        END IF;
    END LOOP;
EXCEPTION
    WHEN undefined_table THEN
        RAISE NOTICE 'embedding codename migration skipped: required table missing';
    WHEN undefined_column THEN
        RAISE NOTICE 'embedding codename migration skipped: required column missing';
END $$;

-- Migrate quota configs: reset all non-zero quota defaults to 0 (unlimited)
-- Only matches rows that still have the original default values
UPDATE image_quota_configs
SET daily_user_quota = 0
WHERE daily_user_quota = 10
  AND serverwide_quota = 0
  AND serverwide_quota_resets_in = 365
  AND enabled = true;

UPDATE video_quota_configs
SET daily_user_quota = 0
WHERE daily_user_quota = 3
  AND serverwide_quota = 0
  AND serverwide_quota_resets_in = 365
  AND enabled = true;

-- 4. ElevenLabs migration: copy encrypted key from opt_api_keys into
--    saved_provider_configs so it can be resolved via the custom endpoint pathway.
--    Provider name format matches buildServerCustomProviderName(serverId, "elevenlabs"):
--    "custom:s{server_id}:elevenlabs"
INSERT INTO saved_provider_configs (
    server_id,
    provider,
    api_key,
    key_version,
    llm_id,
    diffusion_model_id,
    embedding_model_id,
    nai_diffusion_model_id,
    nai_preset_name,
    thinking_level
)
SELECT
    o.server_id,
    'custom:s' || o.server_id::TEXT || ':elevenlabs',
    o.api_key,
    o.key_version,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'auto'
FROM opt_api_keys o
WHERE o.service_name = 'elevenlabs'
  AND NOT EXISTS (
      SELECT 1 FROM saved_provider_configs spc
      WHERE spc.server_id = o.server_id
        AND spc.provider = 'custom:s' || o.server_id::TEXT || ':elevenlabs'
  );

-- 5. Create a speech custom_endpoint row (capability="speech", api_style="elevenlabs")
--    for each server that has an ElevenLabs key.
INSERT INTO custom_endpoints (
    server_id,
    label,
    capability,
    api_style,
    endpoint_url,
    display_name,
    requires_auth,
    extra_config,
    is_default
)
SELECT
    o.server_id,
    'elevenlabs',
    'speech',
    'elevenlabs',
    'https://api.elevenlabs.io',
    'ElevenLabs TTS',
    true,
    '{"script_markup":"bracket-tags","supports_instruct":false}'::JSONB,
    true
FROM opt_api_keys o
WHERE o.service_name = 'elevenlabs'
  AND NOT EXISTS (
      SELECT 1 FROM custom_endpoints ce
      WHERE ce.server_id = o.server_id
        AND ce.label = 'elevenlabs'
        AND ce.capability = 'speech'
        AND ce.user_id IS NULL
  );

-- 6. Create a transcription custom_endpoint row (capability="transcription",
--    api_style="elevenlabs-transcription") for each server with an ElevenLabs key.
INSERT INTO custom_endpoints (
    server_id,
    label,
    capability,
    api_style,
    endpoint_url,
    display_name,
    requires_auth,
    extra_config,
    is_default
)
SELECT
    o.server_id,
    'elevenlabs',
    'transcription',
    'elevenlabs-transcription',
    'https://api.elevenlabs.io',
    'ElevenLabs STT',
    true,
    '{}'::JSONB,
    true
FROM opt_api_keys o
WHERE o.service_name = 'elevenlabs'
  AND NOT EXISTS (
      SELECT 1 FROM custom_endpoints ce
      WHERE ce.server_id = o.server_id
        AND ce.label = 'elevenlabs'
        AND ce.capability = 'transcription'
        AND ce.user_id IS NULL
  );
