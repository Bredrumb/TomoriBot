-- Rollback migration 036: remove personal timezone_offset from users table.
ALTER TABLE users DROP COLUMN IF EXISTS timezone_offset;
