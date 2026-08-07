-- Rollback for migration 058: return the personal fallback chain to the
-- per-provider rows.
--
-- The chain is copied back onto the row enabled for the "text" capability,
-- since that is the only row the pre-058 reader consulted. Chains belonging to
-- users with no text-enabled provider are dropped: pre-058 had nowhere to put
-- them. Writing a plain JSONB array here (not the double-encoded string the old
-- writer produced) is deliberate, because the old reader normalizes both.
UPDATE user_saved_provider_configs AS uspc
SET fallback_model_refs = ufc.fallback_model_refs
FROM user_fallback_chains AS ufc
WHERE uspc.user_id = ufc.user_id
  AND 'text' = ANY(uspc.enabled_capabilities);

DROP TABLE IF EXISTS user_fallback_chains;
