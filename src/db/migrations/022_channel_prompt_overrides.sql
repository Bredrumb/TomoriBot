-- Migration 022: Per-channel system prompt overrides.
--
-- Adds the channel_prompt_overrides table backing the `/server channel-prompt`
-- command. When a row exists for a channel, its prompt either appends after
-- (mode = 'append') or fully replaces (mode = 'replace') the server-level
-- system prompt in that channel only. Persona prompt and persona attributes are
-- never affected. Per-channel data is server-local and is not exported.

-- 1. Create the per-channel prompt override table.
CREATE TABLE IF NOT EXISTS channel_prompt_overrides (
    server_id INT NOT NULL REFERENCES servers(server_id) ON DELETE CASCADE,
    channel_disc_id TEXT NOT NULL,
    channel_prompt TEXT NOT NULL,
    channel_prompt_mode TEXT NOT NULL DEFAULT 'append' CHECK (channel_prompt_mode IN ('append', 'replace')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (server_id, channel_disc_id)
);

-- 2. Index for fast per-server channel prompt lookups.
CREATE INDEX IF NOT EXISTS idx_channel_prompt_overrides_server ON channel_prompt_overrides(server_id);

-- 3. updated_at trigger for channel_prompt_overrides (DROP first for idempotency).
DROP TRIGGER IF EXISTS update_channel_prompt_overrides_timestamp ON channel_prompt_overrides;
CREATE TRIGGER update_channel_prompt_overrides_timestamp
    BEFORE UPDATE ON channel_prompt_overrides
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();
