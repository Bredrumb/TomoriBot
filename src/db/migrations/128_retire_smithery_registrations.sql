-- Smithery's relay closed, so a `.run.tools` row would otherwise send the retired account key to that host as a bearer token.
UPDATE guild_mcp_servers
SET is_enabled = false, auth_token = NULL, failing_since = NULL, failure_reason = NULL
WHERE url ~* '^https?://[^/?#]*\.run\.tools(:[0-9]+)?([/?#]|$)';
