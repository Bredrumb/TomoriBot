-- Migration 009 Rollback: Restore serverwide_quotas table name
-- Reverts the rename from image_serverwide_quotas back to serverwide_quotas.

ALTER TABLE image_serverwide_quotas RENAME TO serverwide_quotas;

-- Restore the original trigger naming
DROP TRIGGER IF EXISTS update_image_serverwide_quotas_timestamp ON serverwide_quotas;
CREATE TRIGGER update_serverwide_quotas_timestamp
BEFORE UPDATE ON serverwide_quotas
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();
