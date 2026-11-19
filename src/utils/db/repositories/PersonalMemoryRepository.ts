import { memoryDecayRepository, type MemorySaveResult } from "@/utils/db/repositories/MemoryDecayRepository";
import { MEMORY_DORMANT_DAYS, isMemoryDecayEnabled } from "@/utils/memory/memoryDecay";
import { isRagAvailable } from "@/utils/db/ragAvailability";
import type { ErrorContext, PersonalMemoryRow } from "@/types/db/schema";
import { personalMemorySchema } from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import { type MemoryValidationResult, getMemoryLimits, validateMemoryContent } from "@/utils/misc/memoryLimits";
import { log } from "@/utils/misc/logger";
import type { IRepository } from "./IRepository";

type PersonalMemoryExportShape = {
  user_disc_id: string;
  memories: Array<{ content: string; tags: string[]; persona_lineage_id: number }>;
};

class PersonalMemoryRepository implements IRepository<PersonalMemoryExportShape> {
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

  // Lineage 0 is excluded so counts match loadForUserLineage with includeGlobalMemories false, and grouping fits the
  // 25-option Discord selector.
  async memoryCountsByLineage(userId: number): Promise<Map<number, number>> {
    try {
      const rows = await sql<Array<{ persona_lineage_id: number | string; count: string | number }>>`
        SELECT persona_lineage_id, COUNT(*) AS count
        FROM personal_memories
        WHERE user_id = ${userId}
          AND persona_lineage_id <> 0
        GROUP BY persona_lineage_id
      `;
      return new Map(rows.map((row) => [Number(row.persona_lineage_id), Number(row.count)]));
    } catch (error) {
      log.error(`Error counting personal memories per lineage for user ${userId}:`, error);
      return new Map();
    }
  }

  // The nickname join stays unscoped by server because lineages are account-global untrusted display labels, and
  // callers offer lineage 0 separately.
  async destinationLineages(userId: number): Promise<Array<{ lineageId: number; nickname: string | null }>> {
    try {
      const rows = await sql<Array<{ persona_lineage_id: number | string; persona_nickname: string | null }>>`
        SELECT pm.persona_lineage_id,
          (
            SELECT p.persona_nickname
            FROM personas p
            WHERE p.persona_lineage_id = pm.persona_lineage_id
            ORDER BY p.updated_at DESC NULLS LAST, p.persona_id DESC
            LIMIT 1
          ) AS persona_nickname
        FROM personal_memories pm
        WHERE pm.user_id = ${userId}
          AND pm.persona_lineage_id <> 0
        GROUP BY pm.persona_lineage_id
      `;
      return rows
        .map((row) => ({ lineageId: Number(row.persona_lineage_id), nickname: row.persona_nickname ?? null }))
        .filter((row) => Number.isSafeInteger(row.lineageId) && row.lineageId > 0)
        .sort((left, right) => left.lineageId - right.lineageId);
    } catch (error) {
      log.error(`Error loading personal memory destination lineages for user ${userId}:`, error);
      return [];
    }
  }

  async countAllForUser(userId: number): Promise<number> {
    try {
      const rows = await sql<Array<{ count: string | number }>>`
        SELECT COUNT(*) as count
        FROM personal_memories
        WHERE user_id = ${userId}
      `;
      return Number(rows[0]?.count ?? 0);
    } catch (error) {
      log.error(`Error counting personal memories for user ${userId}:`, error);
      return 0;
    }
  }

  async edit(
    personalMemoryId: number,
    content: string,
    tags: string[] = [],
    options?: { manuallyWritten: true },
  ): Promise<boolean> {
    try {
      return await sql.transaction(async (tx) => {
        const [previous] =
          await tx`SELECT content FROM personal_memories WHERE personal_memory_id = ${personalMemoryId} FOR UPDATE`;
        if (!previous) return false;
        const [updated] = await tx`
        UPDATE personal_memories
        SET content = ${content}, tags = ${sql.array(tags, "TEXT")},
          manually_written = manually_written OR ${options?.manuallyWritten ?? false}, updated_at = NOW()
        WHERE personal_memory_id = ${personalMemoryId}
        RETURNING personal_memory_id
      `;
        if (updated)
          await memoryDecayRepository.deleteVectorsForEdit(
            tx,
            { kind: "personal", id: personalMemoryId },
            previous.content,
            content,
          );
        return !!updated;
      });
    } catch (error) {
      log.error(`Error editing personal memory ${personalMemoryId}:`, error);
      return false;
    }
  }

  async remove(personalMemoryId: number): Promise<boolean> {
    try {
      const [deleted] = await sql`
        DELETE FROM personal_memories
        WHERE personal_memory_id = ${personalMemoryId}
        RETURNING personal_memory_id
      `;
      return !!deleted;
    } catch (error) {
      log.error(`Error removing personal memory ${personalMemoryId}:`, error);
      return false;
    }
  }

  async removeByIdForUserAndLineage(
    memoryId: number,
    userId: number,
    personaLineageId: number,
  ): Promise<{ personal_memory_id: number; content: string } | null> {
    const [row] = await sql`
      DELETE FROM personal_memories
      WHERE personal_memory_id = ${memoryId}
        AND user_id = ${userId}
        AND (
          persona_lineage_id = ${personaLineageId}
          OR persona_lineage_id = 0
        )
      RETURNING personal_memory_id, content
    `;
    return row
      ? {
          personal_memory_id: row.personal_memory_id as number,
          content: row.content as string,
        }
      : null;
  }

  async updateByIdForUserAndLineage(
    memoryId: number,
    content: string,
    userId: number,
    personaLineageId: number,
  ): Promise<{ personal_memory_id: number; content: string } | null> {
    return await sql.transaction(async (tx) => {
      const [previous] =
        await tx`SELECT content FROM personal_memories WHERE personal_memory_id = ${memoryId} FOR UPDATE`;
      if (!previous) return null;
      const [row] = await tx`
      UPDATE personal_memories
      SET content = ${content}, updated_at = CURRENT_TIMESTAMP
      WHERE personal_memory_id = ${memoryId}
        AND user_id = ${userId}
        AND (
          persona_lineage_id = ${personaLineageId}
          OR persona_lineage_id = 0
        )
      RETURNING personal_memory_id, content
    `;
      if (row)
        await memoryDecayRepository.deleteVectorsForEdit(
          tx,
          { kind: "personal", id: memoryId },
          previous.content,
          content,
        );
      return row
        ? {
            personal_memory_id: row.personal_memory_id as number,
            content: row.content as string,
          }
        : null;
    });
  }

  async addBatch(
    userId: number,
    personaLineageId: number,
    memories: string[],
    tags: string[] = [],
    options?: { manuallyWritten: true },
  ): Promise<boolean> {
    if (memories.length === 0) return true;

    try {
      await sql.transaction(async (tx) => {
        for (const memory of memories) {
          await tx`
            INSERT INTO personal_memories (user_id, persona_lineage_id, content, tags, manually_written)
            VALUES (${userId}, ${personaLineageId}, ${memory}, ${sql.array(tags, "TEXT")}, ${options?.manuallyWritten ?? false})
          `;
        }
      });
      return true;
    } catch (error) {
      const context: ErrorContext = {
        userId,
        errorType: "DatabaseInsertError",
        metadata: {
          operation: "addBatchPersonalMemories",
          personaLineageId,
          insertCount: memories.length,
        },
      };
      await log.error(
        `Error batch-inserting personal memories for user ${userId} in lineage ${personaLineageId}`,
        error,
        context,
      );
      return false;
    }
  }

  // Personal memories skip cache invalidation on write because they have no server-level cache and load fresh per
  // context build.
  async add(
    userId: number,
    personaLineageId: number,
    content: string,
    tags: string[] = [],
    options?: { manuallyWritten: true },
  ): Promise<PersonalMemoryRow | null> {
    log.info(
      `Attempting to learn a personal memory for user ${userId} in lineage ${personaLineageId}: "${content.substring(0, 50)}..."`,
    );

    const contentValidation = validateMemoryContent(content);
    if (!contentValidation.isValid) {
      log.warn(`Personal memory content validation failed for user ID ${userId}: ${contentValidation.error}`);
      return null;
    }

    const personalLimitCheck = await this.checkPersonalMemoryLimit(userId, personaLineageId, true);
    if (!personalLimitCheck.isValid) {
      log.warn(
        `Personal memory limit exceeded for user ID ${userId}: ${personalLimitCheck.currentCount}/${personalLimitCheck.maxAllowed}`,
      );
      return null;
    }

    try {
      const [insertedMemory] = await sql`
        INSERT INTO personal_memories (user_id, persona_lineage_id, content, tags, manually_written)
        VALUES (${userId}, ${personaLineageId}, ${content}, ${sql.array(tags, "TEXT")}, ${options?.manuallyWritten ?? false})
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

  async checkPersonalMemoryLimit(
    userId: number,
    personaLineageId = 0,
    includeGlobalMemories = true,
  ): Promise<MemoryValidationResult> {
    const limits = getMemoryLimits();

    try {
      const [countResult] =
        includeGlobalMemories && personaLineageId !== 0
          ? await sql`
              SELECT COUNT(*) as memory_count
              FROM personal_memories
              WHERE user_id = ${userId}
                AND (
                  persona_lineage_id = ${personaLineageId}
                  OR persona_lineage_id = 0
                )
            `
          : await sql`
              SELECT COUNT(*) as memory_count
              FROM personal_memories
              WHERE user_id = ${userId}
                AND persona_lineage_id = ${personaLineageId}
            `;

      const currentCount = Number(countResult?.memory_count || 0);

      if (currentCount >= limits.maxPersonalMemories) {
        return {
          isValid: false,
          error: "PERSONAL_MEMORY_LIMIT_EXCEEDED",
          currentCount,
          maxAllowed: limits.maxPersonalMemories,
        };
      }

      return { isValid: true, currentCount, maxAllowed: limits.maxPersonalMemories };
    } catch (error) {
      log.error(`Error checking personal memory limit for user ${userId}:`, error);
      return { isValid: false, error: "PERSONAL_MEMORY_LIMIT_EXCEEDED" };
    }
  }

  // This stub returns null because ImportExportRepository owns personal memory export and this method only satisfies
  // IRepository.
  async toExportShape(_ownerId: string | number): Promise<PersonalMemoryExportShape | null> {
    return null;
  }

  // This stub returns false because ImportExportRepository owns personal memory import and this method only satisfies
  // IRepository.
  async fromExportShape(_ownerId: string | number, _data: PersonalMemoryExportShape): Promise<boolean> {
    return false;
  }
  // Owner row locking via FOR UPDATE is required because concurrent model saves must serialize before rechecking the
  // cap and evicting a memory.
  async addWithEviction(
    userId: number,
    personaLineageId: number,
    content: string,
    embeddingResolved: boolean,
    tags: string[] = [],
  ): Promise<MemorySaveResult<PersonalMemoryRow>> {
    const validation = validateMemoryContent(content);
    if (!validation.isValid) throw new Error(`Invalid memory content: ${validation.error}`);
    if (personaLineageId === 0) throw new Error("Model saves require a specific persona lineage");
    const limit = getMemoryLimits().maxPersonalMemories;
    const result = await sql.transaction(async (tx): Promise<MemorySaveResult<PersonalMemoryRow>> => {
      const [owner] = await tx`SELECT user_id FROM users WHERE user_id = ${userId} FOR UPDATE`;
      if (!owner) throw new Error("Memory owner does not exist");
      const [count] = await tx`SELECT count(*) AS count FROM personal_memories
        WHERE user_id = ${userId} AND (persona_lineage_id = ${personaLineageId} OR persona_lineage_id = 0)`;
      const currentCount = Number(count.count);
      let evicted: { id: number; content: string; decay_days: number } | null = null;
      if (currentCount >= limit) {
        if (!isMemoryDecayEnabled() || !isRagAvailable() || !embeddingResolved)
          return { status: "refused", currentCount, limit };
        const [candidate] = await tx`
          SELECT m.personal_memory_id AS id, m.content, m.decay_days FROM personal_memories m
          WHERE m.user_id = ${userId} AND m.persona_lineage_id = ${personaLineageId}
            AND NOT m.manually_written AND m.decay_days >= ${MEMORY_DORMANT_DAYS}
          ORDER BY m.reinforced_on ASC NULLS FIRST, m.created_at ASC, m.personal_memory_id ASC
          LIMIT 1 FOR UPDATE
        `;
        if (!candidate) return { status: "refused", currentCount, limit };
        evicted = { id: candidate.id, content: candidate.content, decay_days: candidate.decay_days };
        await tx`DELETE FROM personal_memories WHERE personal_memory_id = ${evicted.id}`;
      }
      const [inserted] =
        await tx`INSERT INTO personal_memories (user_id, persona_lineage_id, content, tags, manually_written)
        VALUES (${userId}, ${personaLineageId}, ${content}, ${sql.array(tags, "TEXT")}, false) RETURNING *`;
      return { status: "saved", memory: personalMemorySchema.parse(inserted), evicted };
    });
    return result;
  }
}

export const personalMemoryRepository = new PersonalMemoryRepository();
