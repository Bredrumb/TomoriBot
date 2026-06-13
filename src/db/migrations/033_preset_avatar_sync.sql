-- Migration 033: Preset avatar syncing (alter live-resolve + main fan-out).
--
-- Extends the copy-on-write preset-pointer model from text/sprites to avatars.
-- Avatars have two delivery channels with different sync stories:
--
--   * Alter avatars are delivered per-message as a webhook avatarURL, exactly
--     like sprites, so they can live-resolve from one shared image. A pointer
--     alter with a NULL webhook_avatar_url resolves persona_presets.preset_avatar_shared_url.
--   * Main persona avatars are the bot's Discord guild member avatar (Discord-owned
--     state) and cannot live-resolve; they must be PATCHed per guild. The reconciler
--     gates every PATCH on a real byte change using the two hash columns below.
--
-- This migration is additive (three nullable TEXT columns); no rows are deleted
-- and no destructive changes occur.

-- 1. persona_presets: the shared CDN/storage URL of the official avatar, plus a
--    content hash version token. Both are populated by the avatar seed step.
SELECT add_column_if_not_exists('persona_presets', 'preset_avatar_shared_url', 'TEXT');
SELECT add_column_if_not_exists('persona_presets', 'preset_avatar_hash', 'TEXT');

-- 2. personas: the preset_avatar_hash last successfully PATCHed onto this
--    persona's guild member avatar. NULL means "never synced"; the reconciler
--    skips a persona once applied_avatar_hash == its preset's preset_avatar_hash.
SELECT add_column_if_not_exists('personas', 'applied_avatar_hash', 'TEXT');
