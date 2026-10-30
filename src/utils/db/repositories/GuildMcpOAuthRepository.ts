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
