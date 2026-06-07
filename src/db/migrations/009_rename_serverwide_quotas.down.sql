-- Migration 009 Rollback: Restore serverwide_quotas table name
-- Reverts the rename from image_serverwide_quotas back to serverwide_quotas.

DO $$
DECLARE
  renamed_count BIGINT;
  legacy_count BIGINT;
BEGIN
  IF to_regclass('public.image_serverwide_quotas') IS NOT NULL THEN
    IF to_regclass('public.serverwide_quotas') IS NOT NULL THEN
      SELECT COUNT(*) INTO renamed_count FROM image_serverwide_quotas;
      SELECT COUNT(*) INTO legacy_count FROM serverwide_quotas;

      IF legacy_count = 0 THEN
        DROP TABLE serverwide_quotas;
      ELSIF renamed_count = 0 THEN
        DROP TABLE image_serverwide_quotas;
        RETURN;
      ELSE
        RAISE EXCEPTION
          'Renamed and legacy image quota tables both contain rows; inspect image_serverwide_quotas/serverwide_quotas before rolling back migration 009';
      END IF;
    END IF;

    ALTER TABLE image_serverwide_quotas RENAME TO serverwide_quotas;
  END IF;
END $$;

-- Restore the original trigger naming
DROP TRIGGER IF EXISTS update_image_serverwide_quotas_timestamp ON serverwide_quotas;
DROP TRIGGER IF EXISTS update_serverwide_quotas_timestamp ON serverwide_quotas;
CREATE TRIGGER update_serverwide_quotas_timestamp
BEFORE UPDATE ON serverwide_quotas
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();
