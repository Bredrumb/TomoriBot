/**
 * PersonalMemoryRepository — manages the `personal_memories` table.
 *
 * Personal memories are long-term facts Tomori learns about a specific user,
 * scoped to a persona lineage (or lineage 0 for global cross-persona memories).
 *
 * Export contract: toExportShape / fromExportShape are required by IRepository
 * and consumed by the Phase 6 (#16.7) export pipeline composition.
 */
import type { ErrorContext, PersonalMemoryRow } from "@/types/db/schema";
import { personalMemorySchema } from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import { checkPersonalMemoryLimit, validateMemoryContent } from "@/utils/db/memoryLimits";
import { log } from "@/utils/misc/logger";
import type { IRepository } from "./IRepository";

/** Portable personal memory export shape (expanded in Phase 6 #16.7). */
export type PersonalMemoryExportShape = {
  user_disc_id: string;
  memories: Array<{ content: string; tags: string[]; persona_lineage_id: number }>;
};

export class PersonalMemoryRepository implements IRepository<PersonalMemoryExportShape> {
  // ── reads ──────────────────────────────────────────────────────────────────

  /**
   * Loads personal memories for a user scoped to a persona lineage.
   * When includeGlobalMemories is true (default), lineage-0 memories are also included.
   *
   * @param userId            - Internal user DB ID
   * @param personaLineageId  - Persona lineage to load for (0 = global)
   * @param includeGlobalMemories - Whether to also include lineage-0 memories
   * @returns Array of PersonalMemoryRow, newest first
   */
  async loadForUserLineage(
    userId: number,
    personaLineageId: number,
    includeGlobalMemories = true,
  ): Promise<PersonalMemoryRow[]> {
    try {
      const rows =
        includeGlobalMemories && personaLineageId !== 0
          ? await sql`
            SELECT *
            FROM personal_memories
            WHERE user_id = ${userId}
              AND (
                persona_lineage_id = ${personaLineageId}
                OR persona_lineage_id = 0
              )
            ORDER BY created_at DESC, personal_memory_id DESC
          `
          : await sql`
            SELECT *
            FROM personal_memories
            WHERE user_id = ${userId}
              AND persona_lineage_id = ${personaLineageId}
            ORDER BY created_at DESC, personal_memory_id DESC
          `;

      const parsedRows: PersonalMemoryRow[] = [];
      for (const row of rows) {
        const parsed = personalMemorySchema.safeParse(row);
        if (parsed.success) {
          parsedRows.push(parsed.data);
        } else {
          log.warn(`Skipping invalid personal memory row for user ${userId}:`, parsed.error.flatten());
        }
      }

      return parsedRows;
    } catch (error) {
      log.error(`Error loading personal memories for user ${userId} and lineage ${personaLineageId}:`, error);
      return [];
    }
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  /**
   * Inserts a new personal memory for a user.
   * Personal memories have no associated server-level cache to invalidate;
   * they are loaded fresh per context build via loadForUserLineage.
   *
   * @param userId           - Internal user DB ID
   * @param personaLineageId - Persona lineage this memory belongs to
   * @param content          - Memory content string
   * @param tags             - Optional classification tags
   * @returns Inserted PersonalMemoryRow or null on failure
   */
  async add(
    userId: number,
    personaLineageId: number,
    content: string,
    tags: string[] = [],
  ): Promise<PersonalMemoryRow | null> {
    log.info(
      `Tomori is attempting to self-learn a personal memory for user ${userId} in lineage ${personaLineageId}: "${content.substring(0, 50)}..."`,
    );

    const contentValidation = validateMemoryContent(content);
    if (!contentValidation.isValid) {
      log.warn(`Personal memory content validation failed for user ID ${userId}: ${contentValidation.error}`);
      return null;
    }

    const personalLimitCheck = await checkPersonalMemoryLimit(userId, personaLineageId, true);
    if (!personalLimitCheck.isValid) {
      log.warn(
        `Personal memory limit exceeded for user ID ${userId}: ${personalLimitCheck.currentCount}/${personalLimitCheck.maxAllowed}`,
      );
      return null;
    }

    try {
      const [insertedMemory] = await sql`
        INSERT INTO personal_memories (user_id, persona_lineage_id, content, tags)
        VALUES (${userId}, ${personaLineageId}, ${content}, ${sql.array(tags)})
        RETURNING *
      `;

      if (!insertedMemory) {
        log.warn(`Attempted to insert personal memory for non-existent user ${userId}`);
        return null;
      }

      const validatedMemory = personalMemorySchema.safeParse(insertedMemory);
      if (!validatedMemory.success) {
        const context: ErrorContext = {
          userId,
          errorType: "SchemaValidationError",
          metadata: {
            operation: "addPersonalMemoryByTomori",
            personaLineageId,
            contentAttempted: content.substring(0, 100),
            validationErrors: validatedMemory.error.flatten(),
          },
        };
        await log.error(
          `Failed to validate inserted personal memory for user ${userId} in lineage ${personaLineageId}`,
          validatedMemory.error,
          context,
        );
        return null;
      }

      log.success(
        `Tomori successfully inserted personal memory (ID: ${validatedMemory.data.personal_memory_id}) for user ${userId} in lineage ${personaLineageId}.`,
      );
      return validatedMemory.data;
    } catch (error) {
      const context: ErrorContext = {
        userId,
        errorType: "DatabaseUpdateError",
        metadata: {
          operation: "addPersonalMemoryByTomori",
          personaLineageId,
          contentAttempted: content.substring(0, 100),
        },
      };
      await log.error(
        `Error inserting personal memory for user ${userId} in lineage ${personaLineageId}`,
        error,
        context,
      );
      return null;
    }
  }

  // ── IRepository contract ───────────────────────────────────────────────────

  /**
   * Personal memory export is handled by ImportExportRepository.
   * Stub satisfies IRepository contract pending Phase 6 #16.7.
   *
   * @param _ownerId - Discord user snowflake (unused until Phase 6)
   */
  async toExportShape(_ownerId: string | number): Promise<PersonalMemoryExportShape | null> {
    return null;
  }

  /**
   * Personal memory import is handled by ImportExportRepository.
   * Stub satisfies IRepository contract pending Phase 6 #16.7.
   */
  async fromExportShape(_ownerId: string | number, _data: PersonalMemoryExportShape): Promise<boolean> {
    return false;
  }
}

/** Singleton instance — import this in callers. */
export const personalMemoryRepository = new PersonalMemoryRepository();
