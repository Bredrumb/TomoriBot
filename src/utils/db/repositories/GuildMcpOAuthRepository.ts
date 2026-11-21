/**
 * GuildMcpOAuthRepository: owns `guild_mcp_oauth` (the grant behind a signed-in guild MCP
 * registration) and `mcp_oauth_clients` (Dynamic Client Registration results per issuer).
 */
import type { SQL } from "bun";
import { sql as defaultSql } from "@/utils/db/client";

export interface GuildMcpOAuthGrant {
  issuer: string;
  tokenEndpoint: string;
  resource: string;
  clientId: string;
  requestedScopes: string | null;
  grantedScopes: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

interface GuildMcpOAuthRefreshRow {
  client_id: string;
  access_token: Buffer;
  access_token_key_version: number;
  refresh_token: Buffer | null;
  refresh_token_key_version: number | null;
  expires_at: Date | null;
  requested_scopes: string | null;
  needs_reauthorization: boolean;
  retry_at: Date | null;
}

class GuildMcpOAuthRepository {
  constructor(private readonly client: SQL = defaultSql) {}

  /** Runs inside the caller's transaction so the grant commits with its registration row. */
  async insertGrant(
    tx: SQL,
    guildMcpId: number,
    grant: GuildMcpOAuthGrant,
    key: string,
    version: number,
  ): Promise<void> {
    await tx`
      INSERT INTO guild_mcp_oauth (
        guild_mcp_id, issuer, token_endpoint, resource, client_id, granted_scopes, requested_scopes,
        access_token, access_token_key_version, refresh_token, refresh_token_key_version, expires_at
      )
      VALUES (
        ${guildMcpId}, ${grant.issuer}, ${grant.tokenEndpoint}, ${grant.resource}, ${grant.clientId},
        ${grant.grantedScopes}, ${grant.requestedScopes},
        pgp_sym_encrypt(${grant.accessToken}, ${key}, 'compress-algo=1, cipher-algo=aes256'), ${version},
        ${grant.refreshToken === null ? null : tx`pgp_sym_encrypt(${grant.refreshToken}, ${key}, 'compress-algo=1, cipher-algo=aes256')`},
        ${grant.refreshToken === null ? null : version},
        ${grant.expiresAt}
      )
    `;
  }

  async loadEndpoint(guildMcpId: number): Promise<{ token_endpoint: string; resource: string } | null> {
    const [row] = await this.client<{ token_endpoint: string; resource: string }[]>`
      SELECT token_endpoint, resource FROM guild_mcp_oauth WHERE guild_mcp_id = ${guildMcpId}
    `;
    return row ?? null;
  }

  async loadRequestedScopes(guildMcpId: number): Promise<string | null> {
    const [row] = await this.client<{ requested_scopes: string | null }[]>`
      SELECT requested_scopes FROM guild_mcp_oauth WHERE guild_mcp_id = ${guildMcpId}
    `;
    return row?.requested_scopes ?? null;
  }

  async needsReauthorization(guildMcpId: number): Promise<boolean | null> {
    const [row] = await this.client<{ needs_reauthorization: boolean }[]>`
      SELECT needs_reauthorization FROM guild_mcp_oauth WHERE guild_mcp_id = ${guildMcpId}
    `;
    return row?.needs_reauthorization ?? null;
  }

  async loadForUpdate(tx: SQL, guildMcpId: number): Promise<GuildMcpOAuthRefreshRow | null> {
    const [row] = await tx<GuildMcpOAuthRefreshRow[]>`
      SELECT client_id, access_token, access_token_key_version, refresh_token, refresh_token_key_version,
        expires_at, requested_scopes, needs_reauthorization, retry_at
      FROM guild_mcp_oauth
      WHERE guild_mcp_id = ${guildMcpId}
      FOR UPDATE
    `;
    return row ?? null;
  }

  async decrypt(tx: SQL, encrypted: Buffer, key: string): Promise<string | null> {
    const [row] = await tx<{ value: string | null }[]>`SELECT pgp_sym_decrypt(${encrypted}, ${key}) AS value`;
    return row?.value ?? null;
  }

  async storeRefreshedTokens(
    tx: SQL,
    guildMcpId: number,
    tokens: { accessToken: string; refreshToken: string; expiresAt: Date | null; grantedScopes: string | null },
    key: string,
    version: number,
  ): Promise<void> {
    await tx`
      UPDATE guild_mcp_oauth
      SET access_token = pgp_sym_encrypt(${tokens.accessToken}, ${key}, 'compress-algo=1, cipher-algo=aes256'),
        access_token_key_version = ${version},
        refresh_token = pgp_sym_encrypt(${tokens.refreshToken}, ${key}, 'compress-algo=1, cipher-algo=aes256'),
        refresh_token_key_version = ${version},
        expires_at = ${tokens.expiresAt},
        granted_scopes = COALESCE(${tokens.grantedScopes}, granted_scopes),
        retry_at = NULL
      WHERE guild_mcp_id = ${guildMcpId}
    `;
  }

  async setRefreshState(
    tx: SQL,
    guildMcpId: number,
    needsReauthorization: boolean,
    retryAt: Date | null,
  ): Promise<void> {
    await tx`
      UPDATE guild_mcp_oauth
      SET needs_reauthorization = needs_reauthorization OR ${needsReauthorization}, retry_at = ${retryAt}
      WHERE guild_mcp_id = ${guildMcpId}
    `;
  }

  /** Makes the next token read refresh instead of returning the access token the server just rejected. */
  async expireAccessToken(tx: SQL, guildMcpId: number): Promise<void> {
    await tx`UPDATE guild_mcp_oauth SET expires_at = NOW() - INTERVAL '1 second' WHERE guild_mcp_id = ${guildMcpId}`;
  }

  async requireReauthorization(tx: SQL, guildMcpId: number, requestedScopes?: string): Promise<void> {
    await tx`
      UPDATE guild_mcp_oauth
      SET needs_reauthorization = true, requested_scopes = COALESCE(${requestedScopes ?? null}, requested_scopes)
      WHERE guild_mcp_id = ${guildMcpId}
    `;
  }

  /** Runs inside the caller's transaction so a reconnected grant commits with its refreshed registration. */
  async replaceGrant(
    tx: SQL,
    guildMcpId: number,
    grant: GuildMcpOAuthGrant,
    key: string,
    version: number,
  ): Promise<boolean> {
    const updated = await tx`
      UPDATE guild_mcp_oauth
      SET issuer = ${grant.issuer}, token_endpoint = ${grant.tokenEndpoint}, resource = ${grant.resource},
        client_id = ${grant.clientId}, granted_scopes = ${grant.grantedScopes}, requested_scopes = ${grant.requestedScopes},
        access_token = pgp_sym_encrypt(${grant.accessToken}, ${key}, 'compress-algo=1, cipher-algo=aes256'),
        access_token_key_version = ${version},
        refresh_token = ${grant.refreshToken === null ? null : tx`pgp_sym_encrypt(${grant.refreshToken}, ${key}, 'compress-algo=1, cipher-algo=aes256')`},
        refresh_token_key_version = ${grant.refreshToken === null ? null : version},
        expires_at = ${grant.expiresAt},
        needs_reauthorization = false,
        retry_at = NULL
      WHERE guild_mcp_id = ${guildMcpId}
      RETURNING guild_mcp_id
    `;
    return updated.length > 0;
  }

  async findRegisteredClient(issuer: string, redirectUri: string): Promise<string | null> {
    const [row] = await this.client<{ client_id: string }[]>`
      SELECT client_id FROM mcp_oauth_clients WHERE issuer = ${issuer} AND redirect_uri = ${redirectUri}
    `;
    return row?.client_id ?? null;
  }

  /** Two concurrent registrations for one issuer both succeed upstream; the first stored one is kept. */
  async saveRegisteredClient(issuer: string, redirectUri: string, clientId: string): Promise<string> {
    const [row] = await this.client<{ client_id: string }[]>`
      INSERT INTO mcp_oauth_clients (issuer, redirect_uri, client_id)
      VALUES (${issuer}, ${redirectUri}, ${clientId})
      ON CONFLICT (issuer, redirect_uri) DO UPDATE SET client_id = mcp_oauth_clients.client_id
      RETURNING client_id
    `;
    return row.client_id;
  }
}

export const guildMcpOAuthRepository = new GuildMcpOAuthRepository();
