-- Migration 036: Personal timezone offset for users.
--
-- Adds a nullable timezone_offset (SMALLINT) to the users table so each user
-- can opt into their own UTC offset (-12..+14). NULL = not set / not opted in.
-- Mirrors the server timezone (server_chat_configs.timezone_offset) in type and
-- range, reusing timezoneHelper.ts as-is. Phase 6 Stage B will sweep this into
-- user_personalization_configs when that normalization resumes.

ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone_offset SMALLINT NULL;
