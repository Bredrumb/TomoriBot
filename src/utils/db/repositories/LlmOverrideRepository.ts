// LlmOverrideRepository omits IRepository because override state is transient and excluded from per-server exports.
import type { FallbackModelRef, LlmRow } from "@/types/db/schema";
import { invalidateAllChannelLlmCacheForServer, invalidateChannelLlmCache } from "@/utils/cache/channelLlmCacheStore";
import { getCachedLLM } from "@/utils/cache/llmCache";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import { configRepository } from "@/utils/db/repositories/ConfigRepository";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";

const FALLBACK_DEBUG_ENABLED = new Set(["1", "true", "yes", "on"]).has(
  (process.env.FALLBACK_DEBUG_ENABLED ?? "").trim().toLowerCase(),
);

type LlmOverrideCacheOptions = {
  serverDiscId?: string;
};

class LlmOverrideRepository {
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

  async loadPersonaLlmOverridesForServer(serverId: number): Promise<{ persona_id: number; llm_id: number }[]> {
    try {
      const rows = await sql`
        SELECT pc.persona_id, pc.llm_id
        FROM persona_configs pc
        JOIN personas t ON t.persona_id = pc.persona_id
        WHERE t.server_id = ${serverId}
          AND pc.llm_id IS NOT NULL
      `;
      return rows.map((row: { persona_id: number; llm_id: number }) => ({
        persona_id: row.persona_id,
        llm_id: row.llm_id,
      }));
    } catch (error) {
      log.error(`Error loading persona LLM overrides for server ${serverId}:`, error);
      return [];
    }
  }

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

  async setPersonaLlmOverride(
    personaId: number,
    llmId: number | null,
    options: LlmOverrideCacheOptions = {},
  ): Promise<boolean> {
    const ok = await this.writePersonaOverrideSql(personaId, llmId);
    if (ok && options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    return ok;
  }

  async clearAllPersonaLlmOverridesForServer(
    serverId: number,
    options: LlmOverrideCacheOptions = {},
  ): Promise<boolean> {
    const ok = await this.clearAllPersonaOverridesSql(serverId);
    if (ok && options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    return ok;
  }

  async clearPersonaLlmOverridesForModel(
    serverId: number,
    llmId: number,
    options: LlmOverrideCacheOptions = {},
  ): Promise<boolean> {
    const ok = await this.clearPersonaOverridesForModelSql(serverId, llmId);
    if (ok && options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    return ok;
  }

  async setFallbackLlms(serverId: number, llmIds: number[], options: LlmOverrideCacheOptions = {}): Promise<boolean> {
    try {
      const ok = await configRepository.updateModelConfig(serverId, { fallback_llm_ids: llmIds });

      if (!ok) {
        log.warn(
          `[FallbackConfig] setFallbackLlms matched 0 rows for server_id ${serverId} (requested ids: [${llmIds.join(", ")}])`,
        );
        return false;
      }

      if (FALLBACK_DEBUG_ENABLED) {
        log.info(`[FallbackDebug][setFallbackLlms] server_id=${serverId} requested_ids=[${llmIds.join(", ")}]`);
      }

      if (options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
      return true;
    } catch (error) {
      log.error(`Error setting fallback LLMs for server ${serverId} (ids: [${llmIds.join(", ")}]):`, error);
      return false;
    }
  }

  async setFallbackModelRefs(
    serverId: number,
    refs: FallbackModelRef[],
    options: LlmOverrideCacheOptions = {},
  ): Promise<boolean> {
    try {
      // Mirror llm-only IDs into the legacy column so older code paths keep working
      const legacyIds = refs.filter((r) => r.type === "llm").map((r) => r.id);

      const [refsOk, idsOk] = await Promise.all([
        configRepository.updateChatConfig(serverId, { fallback_model_refs: refs }),
        configRepository.updateModelConfig(serverId, { fallback_llm_ids: legacyIds }),
      ]);

      if (!refsOk || !idsOk) {
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

  // Callers must invalidate caches after restoreOverridesFromSnapshot because it calls raw SQL helpers to avoid
  // per-override cache thrashing.
  async restoreOverridesFromSnapshot(
    serverId: number,
    channelOverrides: { channel_disc_id: string; llm_id: number }[],
    personaOverrides: { persona_id: number; llm_id: number }[],
    validChannelIds: Set<string>,
  ): Promise<{
    channelRestored: number;
    personaRestored: number;
    skipped: number;
    restoredChannelOverrides: { channel_disc_id: string; llm_id: number }[];
    restoredPersonaOverrides: { persona_id: number; llm_id: number }[];
  }> {
    let channelRestored = 0;
    let personaRestored = 0;
    let skipped = 0;
    const restoredChannelOverrides: { channel_disc_id: string; llm_id: number }[] = [];
    const restoredPersonaOverrides: { persona_id: number; llm_id: number }[] = [];

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
        SELECT persona_id FROM personas
        WHERE persona_id = ${override.persona_id} AND server_id = ${serverId}
        LIMIT 1
      `;
      if (personaCheck.length === 0) {
        skipped++;
        log.info(
          `Skipping persona override: persona_id ${override.persona_id} no longer exists for server ${serverId}`,
        );
        continue;
      }

      const llmCheck = await sql`SELECT llm_id FROM llms WHERE llm_id = ${override.llm_id} LIMIT 1`;
      if (llmCheck.length === 0) {
        skipped++;
        log.info(
          `Skipping persona override for persona_id ${override.persona_id}: llm_id ${override.llm_id} no longer exists`,
        );
        continue;
      }

      const success = await this.writePersonaOverrideSql(override.persona_id, override.llm_id);
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

      // Avoid ANY($1) array binding, because Bun SQL intermittently fails with 08P01 on array parameters.
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

  private async clearAllChannelOverridesSql(serverId: number): Promise<boolean> {
    try {
      await sql`DELETE FROM channel_llm_overrides WHERE server_id = ${serverId}`;
      return true;
    } catch (error) {
      log.error(`Error clearing channel LLM overrides for server ${serverId}:`, error);
      return false;
    }
  }

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

  private async writePersonaOverrideSql(personaId: number, llmId: number | null): Promise<boolean> {
    try {
      await sql`
        INSERT INTO persona_configs (persona_id, llm_id)
        VALUES (${personaId}, ${llmId})
        ON CONFLICT (persona_id)
        DO UPDATE SET llm_id = EXCLUDED.llm_id, updated_at = CURRENT_TIMESTAMP
      `;
      return true;
    } catch (error) {
      log.error(`Error setting persona LLM override for persona_id ${personaId}:`, error);
      return false;
    }
  }

  private async clearAllPersonaOverridesSql(serverId: number): Promise<boolean> {
    try {
      await sql`
        UPDATE persona_configs
        SET llm_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE persona_id IN (
          SELECT persona_id FROM personas WHERE server_id = ${serverId}
        )
      `;
      return true;
    } catch (error) {
      log.error(`Error clearing persona LLM overrides for server ${serverId}:`, error);
      return false;
    }
  }

  private async clearPersonaOverridesForModelSql(serverId: number, llmId: number): Promise<boolean> {
    try {
      await sql`
        UPDATE persona_configs
        SET llm_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE llm_id = ${llmId}
          AND persona_id IN (
            SELECT persona_id FROM personas WHERE server_id = ${serverId}
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
