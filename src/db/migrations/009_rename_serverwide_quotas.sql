-- Migration 009: Rename serverwide_quotas to image_serverwide_quotas
-- Aligns image quota table naming with text_serverwide_quotas and video_serverwide_quotas.
-- The table stores server-wide image generation quota usage and period tracking.

ALTER TABLE serverwide_quotas RENAME TO image_serverwide_quotas;

-- Rename the updated_at trigger if it exists
DROP TRIGGER IF EXISTS update_serverwide_quotas_timestamp ON image_serverwide_quotas;
CREATE TRIGGER update_image_serverwide_quotas_timestamp
BEFORE UPDATE ON image_serverwide_quotas
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();
