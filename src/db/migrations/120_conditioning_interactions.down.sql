DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM conditioning_history WHERE actor_persona_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Remove persona-authored conditioning through /conditioning before rolling back';
  END IF;
END $$;

DROP INDEX IF EXISTS idx_conditioning_history_persona_actor_unique;
ALTER TABLE conditioning_history DROP CONSTRAINT IF EXISTS conditioning_history_actor_check;
ALTER TABLE conditioning_history DROP COLUMN IF EXISTS actor_persona_id;
ALTER TABLE conditioning_history ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE server_capabilities_configs DROP COLUMN IF EXISTS conditioning_interactions_enabled;
