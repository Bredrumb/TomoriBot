DELETE FROM minimal_notice_refs WHERE ref_kind = 'generation';

ALTER TABLE minimal_notice_refs
  DROP CONSTRAINT IF EXISTS minimal_notice_refs_payload_check,
  DROP CONSTRAINT IF EXISTS minimal_notice_refs_ref_kind_check,
  DROP COLUMN IF EXISTS generation_source,
  ALTER COLUMN ref_id SET NOT NULL;

ALTER TABLE minimal_notice_refs
  ADD CONSTRAINT minimal_notice_refs_ref_kind_check
    CHECK (ref_kind IN ('server_memory', 'personal_memory', 'task'));
