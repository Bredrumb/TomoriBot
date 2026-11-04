CREATE TABLE IF NOT EXISTS cluster_leases (
  name TEXT PRIMARY KEY CHECK (name <> ''),
  holder TEXT NOT NULL CHECK (holder <> ''),
  token BIGINT NOT NULL CHECK (token > 0),
  expires_at TIMESTAMPTZ NOT NULL
);
