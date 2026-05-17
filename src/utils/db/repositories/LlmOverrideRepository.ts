/**
 * LlmOverrideRepository — manages channel/persona LLM override assignments and fallback refs.
 *
 * Covered tables: channel_llm_overrides, persona_configs (llm_id column),
 * tomori_configs (fallback_llm_ids + fallback_model_refs columns).
 *
 * No IRepository implementation — override state is transient and not exported per-server.
 */
import type { FallbackModelRef, LlmRow } from "@/types/db/schema";
import { invalidateAllChannelLlmCacheForServer, invalidateChannelLlmCache } from "@/utils/cache/channelLlmCacheStore";
import { getCachedLLM } from "@/utils/cache/llmCache";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";

const FALLBACK_DEBUG_ENABLED = new Set(["1", "true", "yes", "on"]).has(
  (process.env.FALLBACK_DEBUG_ENABLED ?? "").trim().toLowerCase(),
);

/** Cache invalidation options for override writes. */
export type LlmOverrideCacheOptions = {
  serverDiscId?: string;
};

/** Extends LlmOverrideCacheOptions with optional per-channel invalidation. */
export type ChannelLlmOverrideCacheOptions = LlmOverrideCacheOptions & {
  channelDiscId?: string;
};

export class LlmOverrideRepository {
  // ── channel override reads ──────────────────────────────────────────────────

  /**
   * Returns the LLM assigned as a channel-level override, or null if none is set.
   * Resolves the llm_id via the LLM cache before falling back to a direct DB query.
   *
   * @param serverId      - Internal server DB ID
   * @param channelDiscId - Discord snowflake ID of the channel
   */
  async getChannelLlmOverride(serverId: number, channelDiscId: string): Promise<LlmRow | null> {
    try {
      const overrideRows = await sql`
        SELECT llm_id
        FROM channel_llm_overrides
        WHERE server_id = ${serverId}
          AND channel_disc_id = ${channelDiscId}
        LIMIT 1
      `;
      if (!overrideRows.length) return null;

      const llmId = overrideRows[0].llm_id as number;

      const cached = getCachedLLM(llmId);
      if (cached) return cached as LlmRow;

      const llmRows = await sql`SELECT * FROM llms WHERE llm_id = ${llmId} LIMIT 1`;
      if (!llmRows.length) return null;

      return llmRows[0] as LlmRow;
    } catch (error) {
      log.error(`Error fetching channel LLM override for server ${serverId} channel ${channelDiscId}:`, error);
      return null;
    }
  }

  /**
   * Returns all channel-level LLM overrides for a server, each paired with the resolved LlmRow.
   * Used by the status command to display per-channel model overrides.
   *
   * @param serverId - Internal server DB ID
   */
  async getAllChannelLlmOverridesForServer(serverId: number): Promise<{ channelDiscId: string; llm: LlmRow }[]> {
    try {
      const overrideRows = await sql`
        SELECT channel_disc_id, llm_id
        FROM channel_llm_overrides
        WHERE server_id = ${serverId}
        ORDER BY channel_disc_id
      `;
      if (!overrideRows.length) return [];

      const results: { channelDiscId: string; llm: LlmRow }[] = [];
      for (const row of overrideRows) {
        const llmId = row.llm_id as number;
        const cached = getCachedLLM(llmId);
        if (cached) {
          results.push({ channelDiscId: row.channel_disc_id as string, llm: cached as LlmRow });
          continue;
        }
        const llmRows = await sql`SELECT * FROM llms WHERE llm_id = ${llmId} LIMIT 1`;
        if (llmRows.length) {
          results.push({ channelDiscId: row.channel_disc_id as string, llm: llmRows[0] as LlmRow });
        }
      }
      return results;
    } catch (error) {
      log.error(`Error fetching all channel LLM overrides for server ${serverId}:`, error);
      return [];
    }
  }

  /**
   * Returns all persona-level LLM overrides for a server as raw {tomori_id, llm_id} pairs.
   * Only returns personas with a non-null llm_id override. Used for snapshotting during provider switch.
   *
   * @param serverId - Internal server DB ID
   */
  async loadPersonaLlmOverridesForServer(serverId: number): Promise<{ tomori_id: number; llm_id: number }[]> {
    try {
      const rows = await sql`
        SELECT pc.tomori_id, pc.llm_id
        FROM persona_configs pc
        JOIN tomoris t ON t.tomori_id = pc.tomori_id
        WHERE t.server_id = ${serverId}
          AND pc.llm_id IS NOT NULL
      `;
      return rows.map((row: { tomori_id: number; llm_id: number }) => ({
        tomori_id: row.tomori_id,
        llm_id: row.llm_id,
      }));
    } catch (error) {
      log.error(`Error loading persona LLM overrides for server ${serverId}:`, error);
      return [];
    }
  }

  // ── channel override writes ─────────────────────────────────────────────────

  /**
   * Upserts a channel-level LLM override and invalidates the channel LLM cache.
   *
   * @param serverId      - Internal server DB ID
   * @param channelDiscId - Discord snowflake ID of the channel
   * @param llmId         - LLM ID to assign as the override
   * @param options       - Optional cache invalidation scope
   */
  async setChannelLlmOverride(
    serverId: number,
    channelDiscId: string,
    llmId: number,
    options: LlmOverrideCacheOptions = {},
  ): Promise<boolean> {
    const ok = await this.writeChannelOverrideSql(serverId, channelDiscId, llmId);
    if (ok) {
      invalidateChannelLlmCache(serverId, channelDiscId);
      if (options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    }
    return ok;
  }

  /**
   * Deletes the channel-level LLM override for a single channel and invalidates its cache.
   *
   * @param serverId      - Internal server DB ID
   * @param channelDiscId - Discord snowflake ID of the channel
   * @param options       - Optional cache invalidation scope
   */
  async deleteChannelLlmOverride(
    serverId: number,
    channelDiscId: string,
    options: LlmOverrideCacheOptions = {},
  ): Promise<boolean> {
    const ok = await this.deleteChannelOverrideSql(serverId, channelDiscId);
    if (ok) {
      invalidateChannelLlmCache(serverId, channelDiscId);
      if (options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    }
    return ok;
  }

  /**
   * Deletes all channel-level LLM overrides for a server and invalidates the server-wide cache.
   * Called when the server switches providers so stale model references are removed.
   *
   * @param serverId - Internal server DB ID
   * @param options  - Optional cache invalidation scope
   */
  async clearAllChannelLlmOverridesForServer(
    serverId: number,
    options: LlmOverrideCacheOptions = {},
  ): Promise<boolean> {
    const ok = await this.clearAllChannelOverridesSql(serverId);
    if (ok) {
      invalidateAllChannelLlmCacheForServer(serverId);
      if (options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    }
    return ok;
  }

  /**
   * Deletes all channel-level overrides in a server that point at a specific LLM.
   * Used when removing custom/scoped model registrations so unrelated overrides survive.
   *
   * @param serverId - Internal server DB ID
   * @param llmId    - LLM ID being removed
   * @param options  - Optional cache invalidation scope
   */
  async deleteChannelLlmOverridesForModel(
    serverId: number,
    llmId: number,
    options: LlmOverrideCacheOptions = {},
  ): Promise<boolean> {
    const ok = await this.deleteChannelOverridesForModelSql(serverId, llmId);
    if (ok) {
      invalidateAllChannelLlmCacheForServer(serverId);
      if (options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    }
    return ok;
  }

  // ── persona override writes ─────────────────────────────────────────────────

  /**
   * Upserts a persona-level LLM override in persona_configs.
   * Creates the persona_configs row if it does not yet exist.
   *
   * @param tomoriId - The persona's tomori_id
   * @param llmId    - LLM ID to set as the override, or null to clear it
   * @param options  - Optional cache invalidation scope
   */
  async setPersonaLlmOverride(
    tomoriId: number,
    llmId: number | null,
    options: LlmOverrideCacheOptions = {},
  ): Promise<boolean> {
    const ok = await this.writePersonaOverrideSql(tomoriId, llmId);
    if (ok && options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    return ok;
  }

  /**
   * Nulls out the llm_id override for every persona belonging to a server.
   * Called when the server switches providers so stale model references are removed.
   *
   * @param serverId - Internal server DB ID
   * @param options  - Optional cache invalidation scope
   */
  async clearAllPersonaLlmOverridesForServer(
    serverId: number,
    options: LlmOverrideCacheOptions = {},
  ): Promise<boolean> {
    const ok = await this.clearAllPersonaOverridesSql(serverId);
    if (ok && options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    return ok;
  }

  /**
   * Nulls persona-level overrides in a server that point at a specific LLM.
   * Used when removing custom/scoped model registrations so unrelated overrides survive.
   *
   * @param serverId - Internal server DB ID
   * @param llmId    - LLM ID being removed
   * @param options  - Optional cache invalidation scope
   */
  async clearPersonaLlmOverridesForModel(
    serverId: number,
    llmId: number,
    options: LlmOverrideCacheOptions = {},
  ): Promise<boolean> {
    const ok = await this.clearPersonaOverridesForModelSql(serverId, llmId);
    if (ok && options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    return ok;
  }

  // ── fallback config writes ──────────────────────────────────────────────────

  /**
   * Sets the ordered fallback LLM model chain for a server.
   * Pass an empty array to clear all configured fallback models.
   *
   * @param serverId - Internal server DB ID
   * @param llmIds   - Ordered array of llm_id values (up to 5), or [] to clear
   * @param options  - Optional cache invalidation scope
   */
  async setFallbackLlms(serverId: number, llmIds: number[], options: LlmOverrideCacheOptions = {}): Promise<boolean> {
    try {
      const fallbackJson = JSON.stringify(llmIds);
      // Match server-scoped rows (server_id = serverId) first.
      // Legacy rows have server_id = NULL and are linked via tomori_id → tomoris.server_id,
      // so include them in the same UPDATE to avoid silently writing nothing.
      const updatedRows = await sql<
        Array<{
          tomori_config_id: number;
          server_id: number | null;
          tomori_id: number | null;
          fallback_llm_ids: unknown;
        }>
      >`
        UPDATE tomori_configs
        SET fallback_llm_ids = ${fallbackJson}::JSONB,
            updated_at = CURRENT_TIMESTAMP
        WHERE server_id = ${serverId}
           OR (
               server_id IS NULL
               AND tomori_id IN (
                   SELECT tomori_id FROM tomoris
                   WHERE server_id = ${serverId}
                     AND is_alter = false
               )
           )
        RETURNING tomori_config_id, server_id, tomori_id, fallback_llm_ids
      `;

      if (updatedRows.length === 0) {
        log.warn(
          `[FallbackConfig] setFallbackLlms matched 0 rows for server_id ${serverId} (requested ids: [${llmIds.join(", ")}])`,
        );
        return false;
      }

      if (FALLBACK_DEBUG_ENABLED) {
        const updatedRowSummary = updatedRows.map((row) => ({
          tomori_config_id: row.tomori_config_id,
          server_id: row.server_id,
          tomori_id: row.tomori_id,
          fallback_llm_ids: row.fallback_llm_ids,
        }));
        log.info(
          `[FallbackDebug][setFallbackLlms] server_id=${serverId} requested_ids=[${llmIds.join(", ")}] updated_rows=${JSON.stringify(updatedRowSummary)}`,
        );
      }

      if (options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
      return true;
    } catch (error) {
      log.error(`Error setting fallback LLMs for server ${serverId} (ids: [${llmIds.join(", ")}]):`, error);
      return false;
    }
  }

  /**
   * Writes the ordered fallback model reference list to a server's config.
   * Supports mixed provider types (llm and custom_endpoint). Also mirrors llm-only IDs into the
   * legacy fallback_llm_ids column for backward compatibility with readers not yet using fallback_model_refs.
   *
   * @param serverId - Internal server DB ID
   * @param refs     - Ordered array of FallbackModelRef entries (up to 5), or [] to clear
   * @param options  - Optional cache invalidation scope
   */
  async setFallbackModelRefs(
    serverId: number,
    refs: FallbackModelRef[],
    options: LlmOverrideCacheOptions = {},
  ): Promise<boolean> {
    try {
      const refsJson = JSON.stringify(refs);
      // Mirror llm-only IDs into the legacy column so older code paths keep working
      const legacyIds = refs.filter((r) => r.type === "llm").map((r) => r.id);
      const legacyJson = JSON.stringify(legacyIds);

      const updatedRows = await sql`
        UPDATE tomori_configs
        SET
          fallback_model_refs = ${refsJson}::JSONB,
          fallback_llm_ids    = ${legacyJson}::JSONB,
          updated_at          = CURRENT_TIMESTAMP
        WHERE server_id = ${serverId}
           OR (
               server_id IS NULL
               AND tomori_id IN (
                   SELECT tomori_id FROM tomoris
                   WHERE server_id = ${serverId}
                     AND is_alter = false
               )
           )
        RETURNING tomori_config_id
      `;

      if (updatedRows.length === 0) {
        log.warn(`[FallbackConfig] setFallbackModelRefs matched 0 rows for server_id ${serverId}`);
        return false;
      }

      if (options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
      return true;
    } catch (error) {
      log.error(`Error setting fallback model refs for server ${serverId}:`, error);
      return false;
    }
  }

  // ── snapshot restore & cleanup ──────────────────────────────────────────────

  /**
   * Restores channel and persona LLM overrides from a saved provider config snapshot.
   * Validates that each referenced llm_id still exists before restoring.
   * Dead overrides (missing LLM, deleted channel) are silently skipped.
   *
   * Calls private SQL methods directly to avoid per-override cache thrashing;
   * the caller is responsible for invalidating caches after the bulk restore.
   *
   * @param serverId        - Internal server DB ID
   * @param channelOverrides - {channel_disc_id, llm_id} pairs from saved config
   * @param personaOverrides - {tomori_id, llm_id} pairs from saved config
   * @param validChannelIds  - Discord channel IDs currently present in the guild
   */
  async restoreOverridesFromSnapshot(
    serverId: number,
    channelOverrides: { channel_disc_id: string; llm_id: number }[],
    personaOverrides: { tomori_id: number; llm_id: number }[],
    validChannelIds: Set<string>,
  ): Promise<{
    channelRestored: number;
    personaRestored: number;
    skipped: number;
    restoredChannelOverrides: { channel_disc_id: string; llm_id: number }[];
    restoredPersonaOverrides: { tomori_id: number; llm_id: number }[];
  }> {
    let channelRestored = 0;
    let personaRestored = 0;
    let skipped = 0;
    const restoredChannelOverrides: { channel_disc_id: string; llm_id: number }[] = [];
    const restoredPersonaOverrides: { tomori_id: number; llm_id: number }[] = [];

    for (const override of channelOverrides) {
      if (!validChannelIds.has(override.channel_disc_id)) {
        skipped++;
        log.info(`Skipping dead channel override: channel ${override.channel_disc_id} no longer exists`);
        continue;
      }

      const llmCheck = await sql`SELECT llm_id FROM llms WHERE llm_id = ${override.llm_id} LIMIT 1`;
      if (llmCheck.length === 0) {
        skipped++;
        log.info(
          `Skipping channel override for ${override.channel_disc_id}: llm_id ${override.llm_id} no longer exists`,
        );
        continue;
      }

      const success = await this.writeChannelOverrideSql(serverId, override.channel_disc_id, override.llm_id);
      if (success) {
        channelRestored++;
        restoredChannelOverrides.push(override);
      } else {
        skipped++;
      }
    }

    for (const override of personaOverrides) {
      const personaCheck = await sql`
        SELECT tomori_id FROM tomoris
        WHERE tomori_id = ${override.tomori_id} AND server_id = ${serverId}
        LIMIT 1
      `;
      if (personaCheck.length === 0) {
        skipped++;
        log.info(`Skipping persona override: tomori_id ${override.tomori_id} no longer exists for server ${serverId}`);
        continue;
      }

      const llmCheck = await sql`SELECT llm_id FROM llms WHERE llm_id = ${override.llm_id} LIMIT 1`;
      if (llmCheck.length === 0) {
        skipped++;
        log.info(
          `Skipping persona override for tomori_id ${override.tomori_id}: llm_id ${override.llm_id} no longer exists`,
        );
        continue;
      }

      const success = await this.writePersonaOverrideSql(override.tomori_id, override.llm_id);
      if (success) {
        personaRestored++;
        restoredPersonaOverrides.push(override);
      } else {
        skipped++;
      }
    }

    log.info(
      `Override restore for server ${serverId}: ${channelRestored} channel, ${personaRestored} persona restored, ${skipped} skipped`,
    );
    return { channelRestored, personaRestored, skipped, restoredChannelOverrides, restoredPersonaOverrides };
  }

  /**
   * Removes channel LLM overrides for channels that no longer exist in the guild.
   *
   * @param serverId       - Internal server DB ID
   * @param validChannelIds - Discord channel IDs currently present in the guild
   * @returns Number of dead overrides removed
   */
  async cleanupDeadChannelOverrides(serverId: number, validChannelIds: Set<string>): Promise<number> {
    try {
      const overrideRows = await sql`
        SELECT channel_disc_id FROM channel_llm_overrides
        WHERE server_id = ${serverId}
      `;
      if (!overrideRows.length) return 0;

      const deadChannelIds = overrideRows
        .map((row: { channel_disc_id: string }) => row.channel_disc_id)
        .filter((channelId: string) => !validChannelIds.has(channelId));

      if (deadChannelIds.length === 0) return 0;

      // Avoid ANY($1) array binding — Bun SQL intermittently fails with 08P01 on array parameters.
      const placeholders = deadChannelIds.map((_: string, i: number) => `$${i + 2}`).join(", ");
      await sql.unsafe(
        `DELETE FROM channel_llm_overrides WHERE server_id = $1 AND channel_disc_id IN (${placeholders})`,
        [serverId, ...deadChannelIds],
      );

      log.info(`Cleaned up ${deadChannelIds.length} dead channel override(s) for server ${serverId}`);
      return deadChannelIds.length;
    } catch (error) {
      log.error(`Error cleaning up dead channel overrides for server ${serverId}:`, error);
      return 0;
    }
  }

  // ── private SQL helpers (no cache side-effects) ─────────────────────────────

  /**
   * Raw SQL upsert for a channel LLM override row. No cache invalidation.
   * Called directly by restoreOverridesFromSnapshot to avoid per-override cache thrashing.
   */
  private async writeChannelOverrideSql(serverId: number, channelDiscId: string, llmId: number): Promise<boolean> {
    try {
      await sql`
        INSERT INTO channel_llm_overrides (server_id, channel_disc_id, llm_id)
        VALUES (${serverId}, ${channelDiscId}, ${llmId})
        ON CONFLICT (server_id, channel_disc_id)
        DO UPDATE SET llm_id = EXCLUDED.llm_id, updated_at = CURRENT_TIMESTAMP
      `;
      return true;
    } catch (error) {
      log.error(`Error setting channel LLM override for server ${serverId} channel ${channelDiscId}:`, error);
      return false;
    }
  }

  /** Raw SQL delete for a single channel LLM override row. No cache invalidation. */
  private async deleteChannelOverrideSql(serverId: number, channelDiscId: string): Promise<boolean> {
    try {
      await sql`
        DELETE FROM channel_llm_overrides
        WHERE server_id = ${serverId}
          AND channel_disc_id = ${channelDiscId}
      `;
      return true;
    } catch (error) {
      log.error(`Error deleting channel LLM override for server ${serverId} channel ${channelDiscId}:`, error);
      return false;
    }
  }

  /** Raw SQL delete for all channel LLM override rows for a server. No cache invalidation. */
  private async clearAllChannelOverridesSql(serverId: number): Promise<boolean> {
    try {
      await sql`DELETE FROM channel_llm_overrides WHERE server_id = ${serverId}`;
      return true;
    } catch (error) {
      log.error(`Error clearing channel LLM overrides for server ${serverId}:`, error);
      return false;
    }
  }

  /** Raw SQL delete for channel override rows pointing at one model. No cache invalidation. */
  private async deleteChannelOverridesForModelSql(serverId: number, llmId: number): Promise<boolean> {
    try {
      await sql`
        DELETE FROM channel_llm_overrides
        WHERE server_id = ${serverId}
          AND llm_id = ${llmId}
      `;
      return true;
    } catch (error) {
      log.error(`Error deleting channel LLM overrides for server ${serverId} model ${llmId}:`, error);
      return false;
    }
  }

  /**
   * Raw SQL upsert for a persona LLM override in persona_configs. No cache invalidation.
   * Called directly by restoreOverridesFromSnapshot to avoid per-override cache thrashing.
   */
  private async writePersonaOverrideSql(tomoriId: number, llmId: number | null): Promise<boolean> {
    try {
      await sql`
        INSERT INTO persona_configs (tomori_id, llm_id)
        VALUES (${tomoriId}, ${llmId})
        ON CONFLICT (tomori_id)
        DO UPDATE SET llm_id = EXCLUDED.llm_id, updated_at = CURRENT_TIMESTAMP
      `;
      return true;
    } catch (error) {
      log.error(`Error setting persona LLM override for tomori_id ${tomoriId}:`, error);
      return false;
    }
  }

  /** Raw SQL update to null all persona llm_id overrides for a server. No cache invalidation. */
  private async clearAllPersonaOverridesSql(serverId: number): Promise<boolean> {
    try {
      await sql`
        UPDATE persona_configs
        SET llm_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE tomori_id IN (
          SELECT tomori_id FROM tomoris WHERE server_id = ${serverId}
        )
      `;
      return true;
    } catch (error) {
      log.error(`Error clearing persona LLM overrides for server ${serverId}:`, error);
      return false;
    }
  }

  /** Raw SQL update to null persona overrides pointing at one model. No cache invalidation. */
  private async clearPersonaOverridesForModelSql(serverId: number, llmId: number): Promise<boolean> {
    try {
      await sql`
        UPDATE persona_configs
        SET llm_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE llm_id = ${llmId}
          AND tomori_id IN (
            SELECT tomori_id FROM tomoris WHERE server_id = ${serverId}
          )
      `;
      return true;
    } catch (error) {
      log.error(`Error clearing persona LLM overrides for server ${serverId} model ${llmId}:`, error);
      return false;
    }
  }
}

export const llmOverrideRepo = new LlmOverrideRepository();
