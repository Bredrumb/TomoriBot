-- Migration 034: Per-channel context note storage.
--
-- Adds the channel_context_notes table backing the channel scope of
-- `/config context-note set`. When a row exists for a channel, its note is
-- injected into the dialogue history at the configured depth alongside any
-- active persona-scoped note (additive). The global note from
-- server_chat_configs is only used when neither persona nor channel has one.
-- Per-channel data is server-local and is not exported.

-- 1. Create the per-channel context note table.
CREATE TABLE IF NOT EXISTS channel_context_notes (
    server_id           INT  NOT NULL REFERENCES servers(server_id) ON DELETE CASCADE,
    channel_disc_id     TEXT NOT NULL,
    context_note        TEXT NOT NULL,
    context_note_depth  INT  NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (server_id, channel_disc_id)
);

-- 2. Index for fast per-server channel note lookups.
CREATE INDEX IF NOT EXISTS idx_channel_context_notes_server ON channel_context_notes(server_id);

-- 3. updated_at trigger for channel_context_notes (DROP first for idempotency).
DROP TRIGGER IF EXISTS update_channel_context_notes_timestamp ON channel_context_notes;
CREATE TRIGGER update_channel_context_notes_timestamp
    BEFORE UPDATE ON channel_context_notes
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();
