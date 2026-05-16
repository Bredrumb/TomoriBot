/**
 * ServerMemoryRepository — manages the `server_memories` table.
 *
 * Server memories are long-term facts Tomori learns about a Discord server,
 * scoped to a persona lineage. They are read back as part of TomoriState
 * (loaded by PersonaRepository.loadState) and written here.
 *
 * Export contract: toExportShape / fromExportShape are required by IRepository
 * and consumed by the Phase 6 (#16.7) export pipeline composition.
 */
import type { ErrorContext, ServerMemoryRow } from "@/types/db/schema";
import { serverMemorySchema } from "@/types/db/schema";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import { sql } from "@/utils/db/client";
import { type MemoryValidationResult, getMemoryLimits, validateMemoryContent } from "@/utils/misc/memoryLimits";
import { log } from "@/utils/misc/logger";
import type { IRepository } from "./IRepository";

/** Row shape for server_memory_configs (Phase 6 Stage A). */
export type ServerMemoryConfigsRow = {
  memory_tagging_enabled: boolean;
};

/**
 * Export shape for ServerMemoryRepository.
 * Includes the Phase 6 Stage A server_memory_configs table in addition to
 * the existing memories array (expanded in Phase 6 #16.7).
 */
export type ServerMemoryExportShape = {
  server_disc_id: string;
  memory_configs: ServerMemoryConfigsRow | null;
  memories: Array<{ content: string; tags: string[] }>;
};

export class ServerMemoryRepository implements IRepository<ServerMemoryExportShape> {
  // ── writes ─────────────────────────────────────────────────────────────────

  /**
   * Inserts a new server memory taught by Tomori.
   * Invalidates the tomori state cache so the next context build reads the new memory.
   *
   * @param serverId        - Internal server DB ID
   * @param tomoriId        - Internal tomori DB ID
   * @param personaLineageId - Persona lineage the memory belongs to
   * @param taughtByUserId  - Internal DB ID of the user who triggered the memory
   * @param content         - Memory content string
   * @param tags            - Optional classification tags
   * @param serverDiscId    - Discord server snowflake (required for cache invalidation)
   * @returns Inserted ServerMemoryRow or null on failure
   */
  async add(
    serverId: number,
    tomoriId: number,
    personaLineageId: number,
    taughtByUserId: number,
    content: string,
    tags: string[] = [],
    serverDiscId?: string,
  ): Promise<ServerMemoryRow | null> {
    log.info(
      `Tomori is attempting to self-learn a server memory for server ID ${serverId}, tomori ID ${tomoriId}, lineage ${personaLineageId} (triggered by user ID ${taughtByUserId}): "${content.substring(0, 50)}..."`,
    );

    const contentValidation = validateMemoryContent(content);
    if (!contentValidation.isValid) {
      log.warn(`Server memory content validation failed for server ID ${serverId}: ${contentValidation.error}`);
      return null;
    }

    const serverLimitCheck = await this.checkServerMemoryLimit(serverId, personaLineageId);
    if (!serverLimitCheck.isValid) {
      log.warn(
        `Server memory limit exceeded for server ID ${serverId}: ${serverLimitCheck.currentCount}/${serverLimitCheck.maxAllowed}`,
      );
      return null;
    }

    const row = await this.addServerMemoryRow(serverId, tomoriId, personaLineageId, taughtByUserId, content, tags);
    if (row && serverDiscId) invalidateTomoriStateCache(serverDiscId);
    return row;
  }

  // ── limit checks ───────────────────────────────────────────────────────────

  /**
   * Check if a server has reached its memory limit.
   *
   * @param serverId         - Internal server DB ID
   * @param personaLineageId - Optional persona lineage scope
   * @returns MemoryValidationResult indicating whether the limit is exceeded
   */
  async checkServerMemoryLimit(serverId: number, personaLineageId?: number): Promise<MemoryValidationResult> {
    const limits = getMemoryLimits();

    try {
      const [countResult] =
        personaLineageId !== undefined
          ? await sql`
              SELECT COUNT(*) as memory_count
              FROM server_memories
              WHERE server_id = ${serverId}
                AND persona_lineage_id = ${personaLineageId}
            `
          : await sql`
              SELECT COUNT(*) as memory_count
              FROM server_memories
              WHERE server_id = ${serverId}
            `;

      const currentCount = Number(countResult?.memory_count || 0);

      if (currentCount >= limits.maxServerMemories) {
        return {
          isValid: false,
          error: "SERVER_MEMORY_LIMIT_EXCEEDED",
          currentCount,
          maxAllowed: limits.maxServerMemories,
        };
      }

      return { isValid: true, currentCount, maxAllowed: limits.maxServerMemories };
    } catch (error) {
      log.error(`Error checking server memory limit for server ${serverId}:`, error);
      return { isValid: false, error: "SERVER_MEMORY_LIMIT_EXCEEDED" };
    }
  }

  // ── IRepository contract ───────────────────────────────────────────────────

  /**
   * Reads server_memory_configs for the given server.
   * Memory rows are exported by ExportRepository; this method covers the config table.
   *
   * @param ownerId - Discord server snowflake
   */
  async toExportShape(ownerId: string | number): Promise<ServerMemoryExportShape | null> {
    const serverDiscId = String(ownerId);
    const serverId = await this.resolveServerId(serverDiscId);
    if (!serverId) return null;

    const memoryConfigs = await this.sqlLoadMemoryConfigs(serverId);
    return { server_disc_id: serverDiscId, memory_configs: memoryConfigs, memories: [] };
  }

  /**
   * Restores server_memory_configs for a server.
   * @param ownerId - Discord server snowflake
   * @param data    - Previously exported ServerMemoryExportShape
   */
  async fromExportShape(ownerId: string | number, data: ServerMemoryExportShape): Promise<boolean> {
    const serverDiscId = String(ownerId);
    const serverId = await this.resolveServerId(serverDiscId);
    if (!serverId) {
      log.error(`ServerMemoryRepository.fromExportShape: server ${serverDiscId} not found`);
      return false;
    }

    if (!data.memory_configs) return true;

    try {
      await this.sqlUpsertMemoryConfigs(serverId, data.memory_configs);
      invalidateTomoriStateCache(serverDiscId);
      return true;
    } catch (error) {
      log.error(`ServerMemoryRepository.fromExportShape: write failed for ${serverDiscId}:`, error);
      return false;
    }
  }

  // ── Stage A: resolve internal server ID ──────────────────────────────────

  private async resolveServerId(serverDiscId: string): Promise<number | null> {
    const [row] = await sql`
      SELECT server_id FROM servers WHERE server_disc_id = ${serverDiscId} LIMIT 1
    `;
    return (row?.server_id as number | undefined) ?? null;
  }

  // ── Stage A: config table read ────────────────────────────────────────────

  private async sqlLoadMemoryConfigs(serverId: number): Promise<ServerMemoryConfigsRow | null> {
    try {
      const [row] = await sql`
        SELECT memory_tagging_enabled FROM server_memory_configs WHERE server_id = ${serverId}
      `;
      return row ? (row as unknown as ServerMemoryConfigsRow) : null;
    } catch (error) {
      log.error(`Error loading server_memory_configs for server ${serverId}:`, error);
      return null;
    }
  }

  // ── Stage A: config table upsert ─────────────────────────────────────────

  private async sqlUpsertMemoryConfigs(serverId: number, row: ServerMemoryConfigsRow): Promise<void> {
    await sql`
      INSERT INTO server_memory_configs (server_id, memory_tagging_enabled)
      VALUES (${serverId}, ${row.memory_tagging_enabled})
      ON CONFLICT (server_id) DO UPDATE SET
        memory_tagging_enabled = EXCLUDED.memory_tagging_enabled,
        updated_at             = NOW()
    `;
  }

  private async addServerMemoryRow(
    serverId: number,
    tomoriId: number,
    personaLineageId: number,
    taughtByUserId: number,
    content: string,
    tags: string[],
  ): Promise<ServerMemoryRow | null> {
    try {
      const [newMemory] = await sql`
        INSERT INTO server_memories (server_id, tomori_id, persona_lineage_id, user_id, content, tags)
        VALUES (${serverId}, ${tomoriId}, ${personaLineageId}, ${taughtByUserId}, ${content}, ${sql.array(tags)})
        RETURNING *
      `;

      const validatedMemory = serverMemorySchema.safeParse(newMemory);
      if (!validatedMemory.success) {
        const context: ErrorContext = {
          serverId,
          tomoriId,
          userId: taughtByUserId,
          errorType: "SchemaValidationError",
          metadata: {
            operation: "addServerMemoryByTomori",
            contentAttempted: content.substring(0, 100),
            validationErrors: validatedMemory.error.flatten(),
          },
        };
        await log.error(
          `Failed to validate new server memory for server ID ${serverId}`,
          validatedMemory.error,
          context,
        );
        return null;
      }

      log.success(
        `Tomori successfully saved a new server memory (ID: ${validatedMemory.data.server_memory_id}) for server ID ${serverId}, tomori ID ${tomoriId}, taught by user ID ${taughtByUserId}.`,
      );
      return validatedMemory.data;
    } catch (error) {
      const context: ErrorContext = {
        serverId,
        tomoriId,
        userId: taughtByUserId,
        errorType: "DatabaseInsertError",
        metadata: {
          operation: "addServerMemoryByTomori",
          contentAttempted: content.substring(0, 100),
        },
      };
      await log.error(`Error adding server memory for server ID ${serverId}`, error, context);
      return null;
    }
  }
}

/** Singleton instance — import this in callers. */
export const serverMemoryRepository = new ServerMemoryRepository();
