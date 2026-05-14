import { type ErrorContext, type UserRow, userSchema } from "@/types/db/schema";
import type { SqlParameterArray } from "@/types/db/sqlOperations";
import { invalidateUserCache } from "@/utils/cache/userCache";
import { sql } from "@/utils/db/client";
import { validateUserFields } from "@/utils/db/sqlSecurity";
import { log } from "@/utils/misc/logger";

/**
 * Registers a user in the database if missing and returns the current row.
 * Existing nicknames and preferences are preserved on re-registration.
 *
 * @param userDiscId - Discord user ID of the user to register
 * @param displayName - User's display name or nickname
 * @param language - Preferred language/locale code (e.g., 'en-US'), defaults to 'en'
 * @returns The validated UserRow object, or null if registration failed
 */
export async function registerUser(userDiscId: string, displayName: string, language = "en"): Promise<UserRow | null> {
  try {
    log.info(`Ensuring user ${userDiscId} exists (${displayName})`);

    // registration_locale is only set on INSERT (static field for analytics)
    // Preserve existing nickname/preferences when the user already exists.
    const [userData] = await sql`
            WITH inserted_user AS (
                INSERT INTO users (
                    user_disc_id,
                    user_nickname,
                    language_pref,
                    registration_locale
                ) VALUES (
                    ${userDiscId},
                    ${displayName},
                    ${language},
                    ${language}
                )
                ON CONFLICT (user_disc_id) DO NOTHING
                RETURNING *
            )
            SELECT *
            FROM inserted_user
            UNION ALL
            SELECT *
            FROM users
            WHERE user_disc_id = ${userDiscId}
              AND NOT EXISTS (SELECT 1 FROM inserted_user)
            LIMIT 1
        `;

    // Validate with Zod schema (Rules #3, #6)
    const validatedUser = userSchema.safeParse(userData);

    if (!validatedUser.success) {
      log.error(`Failed to validate registered user data for ${userDiscId}:`, validatedUser.error);
      return null;
    }

    invalidateUserCache(userDiscId);
    return validatedUser.data;
  } catch (error) {
    log.error(`Error registering user ${userDiscId}:`, error);
    return null;
  }
}

/**
 * Sets the privacy level for a user globally across all servers.
 * This function ensures the user exists in the database before updating their privacy setting.
 *
 * @param userDiscId - Discord user ID of the user
 * @param level - Privacy level to set (0=MINIMAL, 1=PARTIAL, 2=FULL)
 * @returns The updated UserRow object, or null if the operation failed
 */
export async function setPrivacyLevel(
  userDiscId: string,
  level: import("@/types/db/schema").PrivacyLevel,
): Promise<UserRow | null> {
  try {
    log.info(`Setting privacy level to ${level} for user ${userDiscId}`);

    // 1. Validate level
    if (![0, 1, 2].includes(level)) {
      log.error(`Invalid privacy level ${level} for user ${userDiscId}`);
      return null;
    }

    // 2. Update privacy level
    const [userData] = await sql`
			UPDATE users
			SET privacy_level = ${level}
			WHERE user_disc_id = ${userDiscId}
			RETURNING *
		`;

    // 3. Check if user was found and updated
    if (!userData) {
      log.warn(`Cannot set privacy level: User ${userDiscId} not found in database`);
      return null;
    }

    // 4. Validate with Zod schema
    const validatedUser = userSchema.safeParse(userData);

    if (!validatedUser.success) {
      log.error(`Failed to validate user data after privacy update for ${userDiscId}:`, validatedUser.error);
      return null;
    }

    log.success(`Privacy level successfully set to ${level} for user ${userDiscId}`);
    return validatedUser.data;
  } catch (error) {
    log.error(`Error setting privacy level for user ${userDiscId}:`, error);
    return null;
  }
}

/**
 * Backward compatibility wrapper for setPrivacyOptOut
 * @deprecated Use setPrivacyLevel() instead
 */
export async function setPrivacyOptOut(userDiscId: string, optedOut: boolean): Promise<UserRow | null> {
  const { PrivacyLevel } = await import("@/types/db/schema");
  const level = optedOut ? PrivacyLevel.FULL : PrivacyLevel.MINIMAL; // optedOut=true maps to Level 2 (FULL privacy)
  return setPrivacyLevel(userDiscId, level);
}

/**
 * Toggle user's cross-server short-term memory sharing preference
 *
 * Phase 4: User Controls & Privacy
 *
 * @param userDiscId - Discord user ID
 * @returns New opt-in value (true if enabled, false if disabled)
 */
export async function toggleCrossServerShortTermMemoryOptIn(userDiscId: string): Promise<boolean> {
  try {
    // Toggle the setting
    const [updated] = await sql`
			UPDATE users
			SET shortterm_cache_crossserver_opt_in = NOT shortterm_cache_crossserver_opt_in
			WHERE user_disc_id = ${userDiscId}
			RETURNING shortterm_cache_crossserver_opt_in
		`;

    // Return the toggled value directly — only one column was returned
    return updated?.shortterm_cache_crossserver_opt_in ?? false;
  } catch (error) {
    log.error(`Error toggling cross-server short-term memory opt-in for user ${userDiscId}:`, error);
    // Re-throw to allow caller to handle
    throw error;
  }
}

export async function updateUser(userId: number, userData: Partial<UserRow>): Promise<UserRow | null> {
  try {
    // Validate the partial data with Zod (Rule #7)
    const validUserData = userSchema.partial().parse(userData);

    // Extract field names and values for the SQL query.
    // Filter to only keys present in the original input — Zod injects defaults
    // for all schema fields with .default(), which would incorrectly expand the
    // SET clause (e.g. personal_memories: [] would overwrite existing data).
    const fields = Object.keys(validUserData).filter((key) => key !== "user_id" && key in userData);

    if (fields.length === 0) {
      log.warn(`No fields provided to update for user_id: ${userId}`);
      return null;
    }

    // Security validation: Ensure all field names are whitelisted to prevent SQL injection
    validateUserFields(fields);

    // 1. Prepare arrays for placeholders and values
    const setParts: string[] = [];
    const values: SqlParameterArray = [];

    // 2. Iterate through fields to build SET clause parts and collect values.
    // sql.unsafe() cannot infer PostgreSQL column types, so JavaScript arrays
    // must be manually serialized to PostgreSQL array literals (e.g. {"a","b"}).
    fields.forEach((field, index) => {
      setParts.push(`${field} = $${index + 1}`); // Use $1, $2, etc.
      const rawValue = validUserData[field as keyof typeof validUserData];
      if (Array.isArray(rawValue)) {
        const escaped = rawValue.map((v) => `"${String(v).replace(/(["\\])/g, "\\$1")}"`);
        values.push(`{${escaped.join(",")}}`);
      } else {
        values.push(rawValue);
      }
    });

    // 3. Join the SET parts
    const setClause = setParts.join(", ");

    // 4. Add the userId as the last parameter for the WHERE clause
    const finalPlaceholderIndex = values.length + 1;
    values.push(userId);

    // 5. Execute the UPDATE using sql.unsafe() with the values array (not spread —
    // Bun SQL expects a single array argument, not individual arguments).
    const result = await sql.unsafe(
      `
            UPDATE users
            SET ${setClause}
            WHERE user_id = $${finalPlaceholderIndex}
            RETURNING *
        `,
      values, // Pass values as a single array — sql.unsafe(query, valuesArray)
    );

    if (!result.length) {
      const context: ErrorContext = {
        userId,
        errorType: "DatabaseUpdateError",
        metadata: {
          operation: "updateUser",
          fields,
        },
      };
      await log.error(`No user found with id: ${userId}`, new Error("User not found"), context);
      return null;
    }

    // Validate the returned data for type safety
    const updatedUser = userSchema.safeParse(result[0]);
    if (!updatedUser.success) {
      const context: ErrorContext = {
        userId,
        errorType: "SchemaValidationError",
        metadata: {
          operation: "updateUser",
          validationErrors: updatedUser.error.flatten(),
        },
      };
      await log.error(`Failed to validate updated user for id: ${userId}`, updatedUser.error, context);
      return null;
    }

    return updatedUser.data;
  } catch (error) {
    const context: ErrorContext = {
      userId,
      errorType: "DatabaseUpdateError",
      metadata: {
        operation: "updateUser",
      },
    };
    await log.error(`Error updating user for id: ${userId}`, error, context);
    return null;
  }
}

/**
 * Adds a new server-wide memory, initiated by Tomori itself due to an interaction.
 * This memory is associated with a specific server and the user whose interaction triggered the learning.
 *
 * @param serverId - The internal ID of the server this memory pertains to.
 * @param tomoriId - The internal persona ID this memory belongs to.
 * @param personaLineageId - Shared persona lineage namespace for this memory.
 * @param taughtByUserId - The internal ID of the user whose interaction led to Tomori learning this.
 * @param content - The text content of the memory to be saved.
 * @returns The newly created ServerMemoryRow, or null if the operation failed.
 */
