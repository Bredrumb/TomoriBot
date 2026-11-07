-- Dropping decay state and vectors loses reinforcement history but preserves memory content.
DO $$
BEGIN
  IF to_regclass('public.memory_embeddings') IS NULL THEN
    RETURN;
  END IF;
  DROP TABLE memory_embeddings;
END;
$$;
ALTER TABLE server_memories DROP COLUMN IF EXISTS decay_days, DROP COLUMN IF EXISTS decay_counted_on,
  DROP COLUMN IF EXISTS reinforced_on, DROP COLUMN IF EXISTS manually_written;
ALTER TABLE personal_memories DROP COLUMN IF EXISTS decay_days, DROP COLUMN IF EXISTS decay_counted_on,
  DROP COLUMN IF EXISTS reinforced_on, DROP COLUMN IF EXISTS manually_written;
