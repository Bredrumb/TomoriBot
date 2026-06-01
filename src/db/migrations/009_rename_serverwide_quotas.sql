-- Migration 009: Rename serverwide_quotas to image_serverwide_quotas
-- Aligns image quota table naming with text_serverwide_quotas and video_serverwide_quotas.
-- The table stores server-wide image generation quota usage and period tracking.

DO $$
DECLARE
  legacy_count BIGINT;
  renamed_count BIGINT;
BEGIN
  IF to_regclass('public.serverwide_quotas') IS NOT NULL THEN
    IF to_regclass('public.image_serverwide_quotas') IS NOT NULL THEN
      SELECT COUNT(*) INTO legacy_count FROM serverwide_quotas;
      SELECT COUNT(*) INTO renamed_count FROM image_serverwide_quotas;

      IF renamed_count = 0 THEN
        DROP TABLE image_serverwide_quotas;
      ELSIF legacy_count = 0 THEN
        DROP TABLE serverwide_quotas;
        RETURN;
      ELSE
        RAISE EXCEPTION
          'Legacy and renamed image quota tables both contain rows; inspect serverwide_quotas/image_serverwide_quotas before applying migration 009';
      END IF;
    END IF;

    ALTER TABLE serverwide_quotas RENAME TO image_serverwide_quotas;
  END IF;
END $$;

-- Rename the updated_at trigger if it exists. Drop the new name too so fresh
-- schema installs can record this migration after schema.sql has created it.
DROP TRIGGER IF EXISTS update_serverwide_quotas_timestamp ON image_serverwide_quotas;
DROP TRIGGER IF EXISTS update_image_serverwide_quotas_timestamp ON image_serverwide_quotas;
CREATE TRIGGER update_image_serverwide_quotas_timestamp
BEFORE UPDATE ON image_serverwide_quotas
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();
