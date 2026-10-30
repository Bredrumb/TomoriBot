CREATE TABLE IF NOT EXISTS guild_mcp_oauth (
  guild_mcp_id INT PRIMARY KEY REFERENCES guild_mcp_servers(guild_mcp_id) ON DELETE CASCADE,
  issuer TEXT NOT NULL,
  token_endpoint TEXT NOT NULL,
  resource TEXT NOT NULL,
  client_id TEXT NOT NULL,
  granted_scopes TEXT,
  requested_scopes TEXT,
  access_token BYTEA NOT NULL,
  access_token_key_version INT NOT NULL,
  refresh_token BYTEA,
  refresh_token_key_version INT,
  expires_at TIMESTAMPTZ,
  needs_reauthorization BOOLEAN NOT NULL DEFAULT false,
  retry_at TIMESTAMPTZ,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT guild_mcp_oauth_refresh_token_complete CHECK ((refresh_token IS NULL) = (refresh_token_key_version IS NULL))
);

DROP TRIGGER IF EXISTS update_guild_mcp_oauth_timestamp ON guild_mcp_oauth;
CREATE TRIGGER update_guild_mcp_oauth_timestamp
  BEFORE UPDATE ON guild_mcp_oauth
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  issuer TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  client_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (issuer, redirect_uri)
);
