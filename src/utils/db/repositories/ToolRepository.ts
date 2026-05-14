/**
 * ToolRepository — manages guild MCP server configurations.
 *
 * Wraps guildMcpDb.ts, which owns the `guild_mcp_servers` table.
 * The Brave API key status read lives here too since it gates tool availability.
 *
 * Export contract: toExportShape / fromExportShape are required by IRepository
 * and consumed by the Phase 6 (#16.7) export pipeline composition.
 */
import type { GuildMcpServerRow } from "@/types/db/schema";
import {
  loadGuildMcpServers,
  insertGuildMcpServer,
  deleteGuildMcpServer,
  countGuildMcpServers,
  updateGuildMcpServerEnabled,
  decryptGuildMcpAuthToken,
  loadAllEnabledGuildMcpServers,
} from "@/utils/db/guildMcpDb";
import { getBraveApiKeyStatus } from "@/utils/db/repositories/toolReadSql";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { invalidateGuildMcpConfigCache } from "@/utils/cache/guildMcpConfigCache";
import type { IRepository } from "./IRepository";

/** Portable tool config export shape (expanded in Phase 6 #16.7). */
export type ToolExportShape = {
  server_disc_id: string;
  mcp_servers: Array<{ name: string; url: string; server_type: string }>;
};

export class ToolRepository implements IRepository<ToolExportShape> {
  // ── reads ──────────────────────────────────────────────────────────────────

  /**
   * Loads all MCP server configs for a guild.
   *
   * @param serverId - Internal server DB ID
   */
  async loadMcpServers(serverId: number): Promise<GuildMcpServerRow[]> {
    return loadGuildMcpServers(serverId);
  }

  /**
   * Loads all enabled MCP server configs across all guilds.
   * Used during bot startup to register active MCP connections.
   */
  async loadAllEnabledMcpServers(): Promise<GuildMcpServerRow[]> {
    return loadAllEnabledGuildMcpServers();
  }

  /**
   * Returns the count of registered MCP servers for a guild.
   *
   * @param serverId - Internal server DB ID
   */
  async countMcpServers(serverId: number): Promise<number> {
    return countGuildMcpServers(serverId);
  }

  /**
   * Returns true if a Brave Search API key is configured for the server.
   *
   * @param serverId - Internal server DB ID
   */
  async getBraveApiKeyStatus(serverId: number): Promise<boolean> {
    return getBraveApiKeyStatus(serverId);
  }

  /**
   * Decrypts the auth token for a guild MCP server row.
   *
   * @param row - GuildMcpServerRow with an encrypted auth token
   * @returns Decrypted token string or null if absent / decryption failed
   */
  async decryptMcpAuthToken(row: GuildMcpServerRow): Promise<string | null> {
    return decryptGuildMcpAuthToken(row);
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  /**
   * Registers a new MCP server for a guild.
   * Invalidates the guild MCP config cache after write.
   *
   * @param serverId    - Internal server DB ID
   * @param name        - Human-readable server name
   * @param url         - MCP server URL
   * @param authToken   - Optional auth token (stored encrypted)
   * @param serverType  - MCP server type (e.g. "sse", "stdio")
   * @param serverDiscId - Discord server snowflake (required for cache invalidation)
   * @returns Inserted GuildMcpServerRow or null on failure
   */
  async insertMcpServer(
    serverId: number,
    name: string,
    url: string,
    authToken: string | undefined,
    serverType: Parameters<typeof insertGuildMcpServer>[3],
    serverDiscId: string,
  ): Promise<GuildMcpServerRow | null> {
    const row = await insertGuildMcpServer(serverId, name, url, authToken, serverType);
    if (row) {
      invalidateGuildMcpConfigCache(serverId);
      invalidateTomoriStateCache(serverDiscId);
    }
    return row;
  }

  /**
   * Deletes an MCP server from a guild by name.
   * Invalidates the guild MCP config cache after write.
   *
   * @param serverId     - Internal server DB ID
   * @param name         - Server name to delete
   * @param serverDiscId - Discord server snowflake (required for tomori state cache invalidation)
   */
  async deleteMcpServer(serverId: number, name: string, serverDiscId: string): Promise<boolean> {
    const ok = await deleteGuildMcpServer(serverId, name);
    if (ok) {
      invalidateGuildMcpConfigCache(serverId);
      invalidateTomoriStateCache(serverDiscId);
    }
    return ok;
  }

  /**
   * Enables or disables an MCP server for a guild.
   * Invalidates the guild MCP config cache after write.
   *
   * @param serverId     - Internal server DB ID
   * @param name         - Server name to toggle
   * @param enabled      - New enabled state
   * @param serverDiscId - Discord server snowflake (required for tomori state cache invalidation)
   */
  async updateMcpServerEnabled(
    serverId: number,
    name: string,
    enabled: boolean,
    serverDiscId: string,
  ): Promise<boolean> {
    const ok = await updateGuildMcpServerEnabled(serverId, name, enabled);
    if (ok) {
      invalidateGuildMcpConfigCache(serverId);
      invalidateTomoriStateCache(serverDiscId);
    }
    return ok;
  }

  // ── IRepository contract ───────────────────────────────────────────────────

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
