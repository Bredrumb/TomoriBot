ALTER TABLE pluralbuddy_oauth_connections
  ADD COLUMN access_token BYTEA,
  ADD COLUMN access_token_key_version INTEGER,
  ADD COLUMN access_expires_at TIMESTAMPTZ,
  ADD COLUMN refresh_blocked_at TIMESTAMPTZ,
  ADD COLUMN refresh_retry_after TIMESTAMPTZ,
  ADD CONSTRAINT pluralbuddy_access_token_complete CHECK (
    (access_token IS NULL AND access_token_key_version IS NULL AND access_expires_at IS NULL)
    OR (access_token IS NOT NULL AND access_token_key_version IS NOT NULL AND access_expires_at IS NOT NULL)
  );
