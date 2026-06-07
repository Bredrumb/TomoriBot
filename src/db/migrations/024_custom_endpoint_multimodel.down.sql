-- Rollback 024: revert to one model per custom endpoint label+capability.
--
-- WARNING: if multiple models were registered under a single label+capability after this migration,
-- recreating the stricter unique index will fail until the duplicates are removed manually. The
-- DROP COLUMN also discards the endpoint→model links.

-- 1. Drop the model-aware unique indexes.
DROP INDEX IF EXISTS idx_custom_endpoints_server_label_capability_model_unique;
DROP INDEX IF EXISTS idx_custom_endpoints_user_label_capability_model_unique;

-- 2. Restore the original model-agnostic unique indexes (best effort; see warning above).
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_endpoints_server_label_capability_unique
  ON custom_endpoints(server_id, label, capability)
  WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_endpoints_user_label_capability_unique
  ON custom_endpoints(user_id, label, capability)
  WHERE server_id IS NULL;

-- 3. Drop the link column.
ALTER TABLE custom_endpoints DROP COLUMN IF EXISTS model_ref_id;
