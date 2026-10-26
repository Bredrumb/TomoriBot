ALTER TABLE server_capabilities_configs
  ADD COLUMN IF NOT EXISTS conditioning_interactions_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE server_capabilities_configs ALTER COLUMN conditioning_interactions_enabled SET DEFAULT true;

ALTER TABLE conditioning_history
  ADD COLUMN IF NOT EXISTS actor_persona_id INT REFERENCES personas(persona_id) ON DELETE CASCADE;
ALTER TABLE conditioning_history ALTER COLUMN user_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conditioning_history_actor_check'
    AND conrelid = 'conditioning_history'::regclass) THEN
    ALTER TABLE conditioning_history ADD CONSTRAINT conditioning_history_actor_check
      CHECK ((user_id IS NOT NULL) <> (actor_persona_id IS NOT NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conditioning_history_persona_actor_unique
  ON conditioning_history(server_id, persona_lineage_id, conditioning_type, action_key, reason_normalized, actor_persona_id);
