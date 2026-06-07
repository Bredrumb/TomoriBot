-- Migration 024: Allow multiple models per custom endpoint label+capability. (Checkpoint)
--
-- A "Custom Endpoint" (label) is one logical connection (shared base URL / api_style / auth key).
-- Previously a (owner, label, capability) triple could hold only one model. This migration lets a
-- label host several models of the same capability, distinguished by model_name, and wires each
-- endpoint row to the synthetic model row it owns via model_ref_id so the runtime can resolve the
-- specific selected model back to its endpoint.
--
-- The index drop/recreate is flagged destructive by the pre-deploy gate; it is safe here because the
-- new index is strictly looser (adds model_name to the key), so existing one-model-per-triple rows
-- already satisfy it. No row deletion occurs.

-- 1. Link column: id of the synthetic model row this endpoint owns (table chosen by `capability`).
ALTER TABLE custom_endpoints ADD COLUMN IF NOT EXISTS model_ref_id INT;

-- 2. Backfill model_ref_id from the existing one-model-per-(provider, capability) synthetic rows.
--    The synthetic model's provider name is reconstructed from scope + label (see
--    buildServerCustomProviderName / buildUserCustomProviderName); before this migration there was
--    exactly one synthetic model per custom provider+capability, so the lookup is unambiguous.
UPDATE custom_endpoints e
SET model_ref_id = (
  SELECT l.llm_id FROM llms l
  WHERE l.llm_provider = (
    CASE WHEN e.server_id IS NOT NULL
      THEN 'custom:s' || e.server_id || ':' || e.label
      ELSE 'custom:u' || e.user_id || ':' || e.label
    END
  )
  LIMIT 1
)
WHERE e.capability = 'text' AND e.model_ref_id IS NULL;

UPDATE custom_endpoints e
SET model_ref_id = (
  SELECT m.embedding_model_id FROM embedding_models m
  WHERE m.provider = (
    CASE WHEN e.server_id IS NOT NULL
      THEN 'custom:s' || e.server_id || ':' || e.label
      ELSE 'custom:u' || e.user_id || ':' || e.label
    END
  )
  LIMIT 1
)
WHERE e.capability = 'embedding' AND e.model_ref_id IS NULL;

UPDATE custom_endpoints e
SET model_ref_id = (
  SELECT m.diffusion_model_id FROM image_diffusion_models m
  WHERE m.provider = (
    CASE WHEN e.server_id IS NOT NULL
      THEN 'custom:s' || e.server_id || ':' || e.label
      ELSE 'custom:u' || e.user_id || ':' || e.label
    END
  )
  LIMIT 1
)
WHERE e.capability = 'image' AND e.model_ref_id IS NULL;

UPDATE custom_endpoints e
SET model_ref_id = (
  SELECT m.video_model_id FROM video_generation_models m
  WHERE m.provider = (
    CASE WHEN e.server_id IS NOT NULL
      THEN 'custom:s' || e.server_id || ':' || e.label
      ELSE 'custom:u' || e.user_id || ':' || e.label
    END
  )
  LIMIT 1
)
WHERE e.capability = 'video' AND e.model_ref_id IS NULL;

-- 3. Widen the per-(owner, label, capability) uniqueness to include model_name. COALESCE collapses
--    NULL model_name to '' so two unnamed rows still collide (at most one unnamed + any named).
DROP INDEX IF EXISTS idx_custom_endpoints_server_label_capability_unique;
DROP INDEX IF EXISTS idx_custom_endpoints_user_label_capability_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_endpoints_server_label_capability_model_unique
  ON custom_endpoints(server_id, label, capability, COALESCE(model_name, ''))
  WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_endpoints_user_label_capability_model_unique
  ON custom_endpoints(user_id, label, capability, COALESCE(model_name, ''))
  WHERE server_id IS NULL;
