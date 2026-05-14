import type { PersonalMemoryRow, ServerMemoryRow } from "@/types/db/schema";
import { type ErrorContext, personalMemorySchema, serverMemorySchema } from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import { checkPersonalMemoryLimit, checkServerMemoryLimit, validateMemoryContent } from "@/utils/db/memoryLimits";
import { log } from "@/utils/misc/logger";
export async function addServerMemoryByTomori(
  serverId: number,
  tomoriId: number,
  personaLineageId: number,
  taughtByUserId: number,
  content: string,
  tags: string[] = [],
): Promise<ServerMemoryRow | null> {
  // 1. Log the attempt to add a server memory.
  log.info(
    `Tomori is attempting to self-learn a server memory for server ID ${serverId}, tomori ID ${tomoriId}, lineage ${personaLineageId} (triggered by user ID ${taughtByUserId}): "${content.substring(0, 50)}..."`,
  );

  // 2. Validate memory content before database operations
  const contentValidation = validateMemoryContent(content);
  if (!contentValidation.isValid) {
    log.warn(`Server memory content validation failed for server ID ${serverId}: ${contentValidation.error}`);
    return null;
  }

  // 3. Check server memory limit
  const serverLimitCheck = await checkServerMemoryLimit(serverId, personaLineageId);
  if (!serverLimitCheck.isValid) {
    log.warn(
      `Server memory limit exceeded for server ID ${serverId}: ${serverLimitCheck.currentCount}/${serverLimitCheck.maxAllowed}`,
    );
    return null;
  }

  try {
    // 2. Insert the new memory into the server_memories table.
    // The columns now correctly match the serverMemorySchema.
    const [newMemory] = await sql`
			INSERT INTO server_memories (server_id, tomori_id, persona_lineage_id, user_id, content, tags)
			VALUES (${serverId}, ${tomoriId}, ${personaLineageId}, ${taughtByUserId}, ${content}, ${sql.array(tags)})
			RETURNING *
		`;

    // 3. Validate the returned data using Zod schema (Rule 3, Rule 5, Rule 6).
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
      await log.error(`Failed to validate new server memory for server ID ${serverId}`, validatedMemory.error, context);
      return null;
    }

    // 4. Log success and return the validated memory.
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
/**
 * Adds a new lineage-scoped personal memory for a user.
 *
 * @param userId - The internal ID of the user for whom the memory is being saved.
 * @param personaLineageId - Persona lineage namespace for the memory.
 * @param content - The text content of the memory to be appended.
 * @returns The inserted PersonalMemoryRow, or null if the operation failed.
 */
export async function addPersonalMemoryByTomori(
  userId: number,
  personaLineageId: number,
  content: string,
  tags: string[] = [],
): Promise<PersonalMemoryRow | null> {
  // 1. Log the attempt to add a personal memory.
  log.info(
    `Tomori is attempting to self-learn a personal memory for user ${userId} in lineage ${personaLineageId}: "${content.substring(0, 50)}..."`,
  );

  // 2. Validate memory content before database operations
  const contentValidation = validateMemoryContent(content);
  if (!contentValidation.isValid) {
    log.warn(`Personal memory content validation failed for user ID ${userId}: ${contentValidation.error}`);
    return null;
  }

  // 3. Check personal memory limit
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

/**
 * Creates a new reminder in the database
 * @param reminderData - Object containing all reminder details
 * @returns The created ReminderRow object, or null if creation failed
 */
