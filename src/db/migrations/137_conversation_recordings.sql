CREATE TABLE IF NOT EXISTS conversation_recording_sessions (
  session_id UUID PRIMARY KEY,
  owner_user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  server_id INT NOT NULL REFERENCES servers(server_id) ON DELETE CASCADE,
  revision INT NOT NULL DEFAULT 1 CHECK (revision > 0),
  context TEXT NOT NULL CHECK (context IN ('own', 'surrounding')),
  duration TEXT NOT NULL CHECK (duration IN ('24h', '7d', '14d', '30d', 'unlimited')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ends_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  evicted_excerpts BIGINT NOT NULL DEFAULT 0,
  evicted_bytes BIGINT NOT NULL DEFAULT 0,
  last_evicted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_recording_active_owner_server
  ON conversation_recording_sessions (owner_user_id, server_id) WHERE stopped_at IS NULL;
CREATE INDEX IF NOT EXISTS conversation_recording_sessions_server
  ON conversation_recording_sessions (server_id, owner_user_id);
CREATE INDEX IF NOT EXISTS conversation_recording_sessions_owner
  ON conversation_recording_sessions (owner_user_id, server_id);
CREATE INDEX IF NOT EXISTS conversation_recording_sessions_end
  ON conversation_recording_sessions (ends_at) WHERE stopped_at IS NULL;

CREATE TABLE IF NOT EXISTS conversation_recording_aliases (
  session_id UUID NOT NULL REFERENCES conversation_recording_sessions(session_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('participant', 'channel', 'role')),
  source_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  PRIMARY KEY (session_id, kind, source_id),
  UNIQUE (session_id, kind, alias)
);

CREATE TABLE IF NOT EXISTS conversation_recording_messages (
  session_id UUID NOT NULL REFERENCES conversation_recording_sessions(session_id) ON DELETE CASCADE,
  source_message_id TEXT NOT NULL,
  source_channel_id TEXT NOT NULL,
  source_parent_channel_id TEXT,
  source_author_id TEXT NOT NULL,
  privacy_user_ids TEXT[] NOT NULL,
  message_id UUID NOT NULL UNIQUE,
  transcript JSONB NOT NULL CHECK (jsonb_typeof(transcript) = 'object'),
  logical_bytes INT NOT NULL CHECK (logical_bytes > 0),
  PRIMARY KEY (session_id, source_message_id)
);
CREATE INDEX IF NOT EXISTS conversation_recording_messages_source
  ON conversation_recording_messages (source_channel_id, source_message_id);
CREATE INDEX IF NOT EXISTS conversation_recording_messages_privacy
  ON conversation_recording_messages USING GIN (privacy_user_ids);

CREATE TABLE IF NOT EXISTS conversation_recording_excerpts (
  excerpt_id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES conversation_recording_sessions(session_id) ON DELETE CASCADE,
  trigger_source_message_id TEXT NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL,
  context TEXT NOT NULL CHECK (context IN ('own', 'surrounding')),
  overhead_bytes INT NOT NULL CHECK (overhead_bytes > 0),
  UNIQUE (session_id, trigger_source_message_id),
  FOREIGN KEY (session_id, trigger_source_message_id)
    REFERENCES conversation_recording_messages(session_id, source_message_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS conversation_recording_excerpts_time
  ON conversation_recording_excerpts (triggered_at, excerpt_id);

CREATE TABLE IF NOT EXISTS conversation_recording_excerpt_messages (
  excerpt_id UUID NOT NULL REFERENCES conversation_recording_excerpts(excerpt_id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES conversation_recording_messages(message_id) ON DELETE CASCADE,
  position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 10),
  reply_to UUID REFERENCES conversation_recording_messages(message_id) ON DELETE SET NULL,
  PRIMARY KEY (excerpt_id, position),
  UNIQUE (excerpt_id, message_id)
);
CREATE INDEX IF NOT EXISTS conversation_recording_excerpt_messages_message
  ON conversation_recording_excerpt_messages (message_id);
CREATE INDEX IF NOT EXISTS conversation_recording_excerpt_messages_reply
  ON conversation_recording_excerpt_messages (reply_to) WHERE reply_to IS NOT NULL;

CREATE OR REPLACE VIEW conversation_recording_excerpt_sizes AS
SELECT e.excerpt_id, e.session_id, e.triggered_at,
  e.overhead_bytes + (
    SELECT COALESCE(SUM(m.logical_bytes + CASE WHEN r.reply_to IS NULL THEN 0
      ELSE octet_length(to_json(r.reply_to)::text) - octet_length('null') END), 0)
      + GREATEST(COUNT(*) - 1, 0)
    FROM conversation_recording_excerpt_messages r
    JOIN conversation_recording_messages m ON m.message_id = r.message_id
    WHERE r.excerpt_id = e.excerpt_id
  ) AS logical_bytes
FROM conversation_recording_excerpts e;
