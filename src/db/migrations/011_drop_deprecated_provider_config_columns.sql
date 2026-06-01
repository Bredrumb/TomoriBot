-- Migration 011: Drop deprecated columns from saved_provider_configs and
-- user_saved_provider_configs that accumulated during Phase 3 and Pass B.
--
-- saved_provider_configs columns dropped:
--   custom_endpoint_url, custom_model_name, custom_num_ctx  (Phase 3 — now in custom_endpoints)
--   fallback_llm_ids                                         (Phase 3 — superseded by fallback_model_refs)
--   channel_llm_overrides, persona_llm_overrides JSONB      (Pass B switch-snapshot baggage)
--
-- user_saved_provider_configs columns dropped:
--   custom_endpoint_url, custom_model_name, custom_num_ctx  (Phase 3 — now in custom_endpoints)
--   fallback_llm_ids                                         (Phase 3 — superseded by fallback_model_refs)
--
-- Pre-drop: backfill fallback_model_refs from fallback_llm_ids for any rows
-- where fallback_model_refs is still empty but fallback_llm_ids has entries.
-- This mirrors the seed.sql backfill block which ran on every startup during
-- the rollout period; running it here ensures correctness before the drop.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'saved_provider_configs'
      AND column_name = 'fallback_llm_ids'
  ) THEN
    UPDATE saved_provider_configs
    SET fallback_model_refs = COALESCE((
        SELECT jsonb_agg(
            jsonb_build_object(
                'type', 'llm',
                'id', fallback_entry.value::INTEGER
            )
            ORDER BY fallback_entry.ordinality
        )
        FROM jsonb_array_elements_text(
            CASE
                WHEN jsonb_typeof(COALESCE(saved_provider_configs.fallback_llm_ids, '[]'::JSONB)) = 'array'
                    THEN COALESCE(saved_provider_configs.fallback_llm_ids, '[]'::JSONB)
                ELSE '[]'::JSONB
            END
        ) WITH ORDINALITY AS fallback_entry(value, ordinality)
    ), '[]'::JSONB)
    WHERE (
            CASE
                WHEN jsonb_typeof(COALESCE(saved_provider_configs.fallback_model_refs, '[]'::JSONB)) = 'array'
                    THEN jsonb_array_length(COALESCE(saved_provider_configs.fallback_model_refs, '[]'::JSONB))
                ELSE 0
            END
        ) = 0
      AND (
            CASE
                WHEN jsonb_typeof(COALESCE(saved_provider_configs.fallback_llm_ids, '[]'::JSONB)) = 'array'
                    THEN jsonb_array_length(COALESCE(saved_provider_configs.fallback_llm_ids, '[]'::JSONB))
                ELSE 0
            END
        ) > 0;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_saved_provider_configs'
      AND column_name = 'fallback_llm_ids'
  ) THEN
    UPDATE user_saved_provider_configs
    SET fallback_model_refs = COALESCE((
        SELECT jsonb_agg(
            jsonb_build_object(
                'type', 'llm',
                'id', fallback_entry.value::INTEGER
            )
            ORDER BY fallback_entry.ordinality
        )
        FROM jsonb_array_elements_text(
            CASE
                WHEN jsonb_typeof(COALESCE(user_saved_provider_configs.fallback_llm_ids, '[]'::JSONB)) = 'array'
                    THEN COALESCE(user_saved_provider_configs.fallback_llm_ids, '[]'::JSONB)
                ELSE '[]'::JSONB
            END
        ) WITH ORDINALITY AS fallback_entry(value, ordinality)
    ), '[]'::JSONB)
    WHERE (
            CASE
                WHEN jsonb_typeof(COALESCE(user_saved_provider_configs.fallback_model_refs, '[]'::JSONB)) = 'array'
                    THEN jsonb_array_length(COALESCE(user_saved_provider_configs.fallback_model_refs, '[]'::JSONB))
                ELSE 0
            END
        ) = 0
      AND (
            CASE
                WHEN jsonb_typeof(COALESCE(user_saved_provider_configs.fallback_llm_ids, '[]'::JSONB)) = 'array'
                    THEN jsonb_array_length(COALESCE(user_saved_provider_configs.fallback_llm_ids, '[]'::JSONB))
                ELSE 0
            END
        ) > 0;
  END IF;
END $$;

-- Drop deprecated columns from saved_provider_configs
ALTER TABLE saved_provider_configs DROP COLUMN IF EXISTS custom_endpoint_url;
ALTER TABLE saved_provider_configs DROP COLUMN IF EXISTS custom_model_name;
ALTER TABLE saved_provider_configs DROP COLUMN IF EXISTS custom_num_ctx;
ALTER TABLE saved_provider_configs DROP COLUMN IF EXISTS fallback_llm_ids;
ALTER TABLE saved_provider_configs DROP COLUMN IF EXISTS channel_llm_overrides;
ALTER TABLE saved_provider_configs DROP COLUMN IF EXISTS persona_llm_overrides;

-- Drop deprecated columns from user_saved_provider_configs
ALTER TABLE user_saved_provider_configs DROP COLUMN IF EXISTS custom_endpoint_url;
ALTER TABLE user_saved_provider_configs DROP COLUMN IF EXISTS custom_model_name;
ALTER TABLE user_saved_provider_configs DROP COLUMN IF EXISTS custom_num_ctx;
ALTER TABLE user_saved_provider_configs DROP COLUMN IF EXISTS fallback_llm_ids;
