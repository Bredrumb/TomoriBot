/**
 * ToolRepository — manages guild MCP server configurations.
 *
 * Owns the `guild_mcp_servers` table. The Brave API key status read lives
 * here too since it gates tool availability.
 *
 * Export contract: toExportShape / fromExportShape are required by IRepository
 * and consumed by the Phase 6 (#16.7) export pipeline composition.
 */
import type { GuildMcpServerRow } from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { keyManager } from "@/utils/security/keyManager";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import { invalidateGuildMcpConfigCache } from "@/utils/cache/guildMcpConfigCache";
import type { IRepository } from "./IRepository";

/** Portable tool config export shape (expanded in Phase 6 #16.7). */
export type ToolExportShape = {
  server_disc_id: string;
  mcp_servers: Array<{ name: string; url: string; server_type: string }>;
};

export class ToolRepository implements IRepository<ToolExportShape> {
  /**
   * Loads all MCP server configs for a guild.
   *
   */
  async loadMcpServers(serverId: number): Promise<GuildMcpServerRow[]> {
    return this.sqlLoadGuildMcpServers(serverId);
  }

  /**
   * Loads all enabled MCP server configs across all guilds.
   * Used during bot startup to register active MCP connections.
   */
  async loadAllEnabledMcpServers(): Promise<GuildMcpServerRow[]> {
    return this.sqlLoadAllEnabledGuildMcpServers();
  }

  /**
   * Returns the count of registered MCP servers for a guild.
   *
   */
  async countMcpServers(serverId: number): Promise<number> {
    return this.sqlCountGuildMcpServers(serverId);
  }

  /**
   * Returns true if a Brave Search API key is configured for the server.
   *
   */
  async getBraveApiKeyStatus(serverId: number): Promise<boolean> {
    return this.sqlGetBraveApiKeyStatus(serverId);
  }

  /**
   * Decrypts the auth token for a guild MCP server row.
   *
   * @param row - GuildMcpServerRow with an encrypted auth token
   * @returns Decrypted token string or null if absent / decryption failed
   */
  async decryptMcpAuthToken(row: GuildMcpServerRow): Promise<string | null> {
    return this.sqlDecryptGuildMcpAuthToken(row);
  }

  /**
   * Registers a new MCP server for a guild.
   * Invalidates the guild MCP config cache and tomori state cache after write.
   *
   * @param authToken   - Optional auth token (stored encrypted)
   * @param serverType  - MCP server type for tool deduplication
   * @param serverDiscId - Discord server snowflake (required for cache invalidation)
   * @returns Inserted GuildMcpServerRow or null on failure
   */
  async insertMcpServer(
    serverId: number,
    name: string,
    url: string,
    authToken: string | undefined,
    serverType: string | null | undefined,
    serverDiscId: string,
  ): Promise<GuildMcpServerRow | null> {
    const row = await this.sqlInsertGuildMcpServer(serverId, name, url, authToken, serverType);
    if (row) {
      invalidateGuildMcpConfigCache(serverId);
      invalidateTomoriStateCache(serverDiscId);
    }
    return row;
  }

  /**
   * Deletes an MCP server from a guild by name.
   * Invalidates caches after write.
   *
   * @param serverDiscId - Discord server snowflake (required for tomori state cache invalidation)
   */
  async deleteMcpServer(serverId: number, name: string, serverDiscId: string): Promise<boolean> {
    const ok = await this.sqlDeleteGuildMcpServer(serverId, name);
    if (ok) {
      invalidateGuildMcpConfigCache(serverId);
      invalidateTomoriStateCache(serverDiscId);
    }
    return ok;
  }

  /**
   * Enables or disables an MCP server for a guild.
   * Invalidates caches after write.
   *
   * @param serverDiscId - Discord server snowflake (required for tomori state cache invalidation)
   */
  async updateMcpServerEnabled(
    serverId: number,
    name: string,
    enabled: boolean,
    serverDiscId: string,
  ): Promise<boolean> {
    const ok = await this.sqlUpdateGuildMcpServerEnabled(serverId, name, enabled);
    if (ok) {
      invalidateGuildMcpConfigCache(serverId);
      invalidateTomoriStateCache(serverDiscId);
    }
    return ok;
  }

  private async sqlLoadGuildMcpServers(serverId: number): Promise<GuildMcpServerRow[]> {
    try {
      const rows = await sql`
        SELECT guild_mcp_id, server_id, name, url, auth_token, key_version,
               is_enabled, server_type, created_at, updated_at
        FROM guild_mcp_servers
        WHERE server_id = ${serverId}
        ORDER BY created_at ASC
      `;

      return rows as GuildMcpServerRow[];
    } catch (error) {
      log.error(`[GuildMcpDb] Failed to load MCP servers for server ${serverId}`, error);
      return [];
    }
  }

  private async sqlInsertGuildMcpServer(
    serverId: number,
    name: string,
    url: string,
    rawAuthToken?: string,
    serverType?: string | null,
  ): Promise<GuildMcpServerRow | null> {
    try {
      const currentKey = keyManager.getCurrentKey();
      const currentVersion = keyManager.getCurrentVersion();

      let row: GuildMcpServerRow;

      if (rawAuthToken) {
        const [result] = await sql`
          INSERT INTO guild_mcp_servers (server_id, name, url, auth_token, key_version, server_type)
          VALUES (
            ${serverId}, ${name}, ${url},
            pgp_sym_encrypt(${rawAuthToken.trim()}, ${currentKey}, 'compress-algo=1, cipher-algo=aes256'),
            ${currentVersion}, ${serverType ?? null}
          )
          RETURNING *
        `;
        row = result as GuildMcpServerRow;
      } else {
        const [result] = await sql`
          INSERT INTO guild_mcp_servers (server_id, name, url, server_type)
          VALUES (${serverId}, ${name}, ${url}, ${serverType ?? null})
          RETURNING *
        `;
        row = result as GuildMcpServerRow;
      }

      log.success(`[GuildMcpDb] Registered MCP server "${name}" for server ${serverId}`);
      return row;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("unique") || errorMessage.includes("duplicate")) {
        log.warn(`[GuildMcpDb] Duplicate MCP server name "${name}" for server ${serverId}`);
      } else {
        log.error(`[GuildMcpDb] Failed to insert MCP server "${name}" for server ${serverId}`, error);
      }
      return null;
    }
  }

  private async sqlDeleteGuildMcpServer(serverId: number, name: string): Promise<boolean> {
    try {
      const result = await sql`
        DELETE FROM guild_mcp_servers
        WHERE server_id = ${serverId} AND name = ${name}
      `;

      const deleted = result.count > 0;
      if (deleted) {
        log.success(`[GuildMcpDb] Deleted MCP server "${name}" for server ${serverId}`);
      }
      return deleted;
    } catch (error) {
      log.error(`[GuildMcpDb] Failed to delete MCP server "${name}" for server ${serverId}`, error);
      return false;
    }
  }

  private async sqlCountGuildMcpServers(serverId: number): Promise<number> {
    try {
      const [row] = await sql`
        SELECT COUNT(*) AS count FROM guild_mcp_servers
        WHERE server_id = ${serverId}
      `;

      return Number.parseInt(row?.count as string, 10) || 0;
    } catch (error) {
      log.error(`[GuildMcpDb] Failed to count MCP servers for server ${serverId}`, error);
      return 0;
    }
  }

  private async sqlUpdateGuildMcpServerEnabled(serverId: number, name: string, enabled: boolean): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE guild_mcp_servers
        SET is_enabled = ${enabled}
        WHERE server_id = ${serverId} AND name = ${name}
      `;

      const updated = result.count > 0;
      if (updated) {
        log.success(`[GuildMcpDb] ${enabled ? "Enabled" : "Disabled"} MCP server "${name}" for server ${serverId}`);
      }
      return updated;
    } catch (error) {
      log.error(`[GuildMcpDb] Failed to update MCP server enabled state for "${name}" on server ${serverId}`, error);
      return false;
    }
  }

  private async sqlDecryptGuildMcpAuthToken(row: GuildMcpServerRow): Promise<string | null> {
    if (!row.auth_token) return null;

    try {
      const keyVersion = row.key_version || 1;
      const key = keyManager.getKey(keyVersion);

      const [result] = await sql`
        SELECT pgp_sym_decrypt(${row.auth_token}, ${key}) AS decrypted_token
      `;

      if (!result?.decrypted_token) {
        log.warn(`[GuildMcpDb] Decryption returned empty for MCP server "${row.name}"`);
        return null;
      }

      const decryptedToken = result.decrypted_token.toString();

      const currentVersion = keyManager.getCurrentVersion();
      if (keyVersion !== currentVersion) {
        log.info(`[GuildMcpDb] Rotating auth token for "${row.name}" from key v${keyVersion} to v${currentVersion}`);
        const currentKey = keyManager.getCurrentKey();
        await sql`
          UPDATE guild_mcp_servers
          SET auth_token = pgp_sym_encrypt(${decryptedToken}, ${currentKey}, 'compress-algo=1, cipher-algo=aes256'),
              key_version = ${currentVersion}
          WHERE guild_mcp_id = ${row.guild_mcp_id}
        `;
        log.success(`[GuildMcpDb] Key rotation completed for MCP server "${row.name}"`);
      }

      return decryptedToken;
    } catch (error) {
      log.error(`[GuildMcpDb] Failed to decrypt auth token for MCP server "${row.name}"`, error);
      return null;
    }
  }

  private async sqlGetBraveApiKeyStatus(serverId: number): Promise<boolean> {
    try {
      const result = await sql`
        SELECT api_key FROM opt_api_keys
        WHERE server_id = ${serverId}
        AND service_name = 'brave-search'
        LIMIT 1
      `;
      return result && result.length > 0;
    } catch (error) {
      log.error(`Error checking Brave API key status for server ${serverId}:`, error);
      return false;
    }
  }

  private async sqlLoadAllEnabledGuildMcpServers(): Promise<GuildMcpServerRow[]> {
    try {
      const rows = await sql`
        SELECT guild_mcp_id, server_id, name, url, auth_token, key_version,
               is_enabled, server_type, created_at, updated_at
        FROM guild_mcp_servers
        WHERE is_enabled = true
        ORDER BY server_id ASC, created_at ASC
      `;

      return rows as GuildMcpServerRow[];
    } catch (error) {
      log.error("[GuildMcpDb] Failed to load all enabled guild MCP servers", error);
      return [];
    }
  }

  /**
   * Tool config export is handled by ImportExportRepository.
   * Stub satisfies IRepository contract pending Phase 6 #16.7.
   *
   * @param ownerId - Discord server snowflake (unused until Phase 6)
   */
  async toExportShape(ownerId: string | number): Promise<ToolExportShape | null> {
    return { server_disc_id: String(ownerId), mcp_servers: [] };
  }

  /**
   * Tool config import is handled by ImportExportRepository.
   * Stub satisfies IRepository contract pending Phase 6 #16.7.
   */
  async fromExportShape(_ownerId: string | number, _data: ToolExportShape): Promise<boolean> {
    return false;
  }
}

/** Singleton instance — import this in callers. */
export const toolRepository = new ToolRepository();
