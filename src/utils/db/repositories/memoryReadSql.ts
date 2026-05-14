import { personalMemorySchema, type PersonalMemoryRow } from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
export async function loadPersonalMemoriesForUserLineage(
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

/**
 * Checks if a user is blacklisted from personalization in a server.
 * @param serverDiscId - Discord server ID.
 * @param userDiscId - Discord user ID.
 * @returns true if user is blacklisted, false otherwise.
 */
