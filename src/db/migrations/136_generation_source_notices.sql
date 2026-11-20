ALTER TABLE minimal_notice_refs
  ADD COLUMN IF NOT EXISTS generation_source JSONB,
  ALTER COLUMN ref_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS minimal_notice_refs_ref_kind_check,
  DROP CONSTRAINT IF EXISTS minimal_notice_refs_payload_check;

ALTER TABLE minimal_notice_refs
  ADD CONSTRAINT minimal_notice_refs_ref_kind_check
    CHECK (ref_kind IN ('server_memory', 'personal_memory', 'task', 'generation')),
  ADD CONSTRAINT minimal_notice_refs_payload_check CHECK (
    (ref_kind = 'generation' AND ref_id IS NULL AND generation_source IS NOT NULL)
    OR (ref_kind <> 'generation' AND ref_id IS NOT NULL AND generation_source IS NULL)
  );
