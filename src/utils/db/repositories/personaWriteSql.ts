import { type ErrorContext, type TomoriRow, tomoriSchema } from "@/types/db/schema";
import type { SqlParameterArray } from "@/types/db/sqlOperations";
import { sql } from "@/utils/db/client";
import { validateTomoriFields } from "@/utils/db/sqlSecurity";
import { log } from "@/utils/misc/logger";
export async function updateTomori(tomoriId: number, tomoriData: Partial<TomoriRow>): Promise<TomoriRow | null> {
  try {
    // Validate the partial data with Zod (Rule #7)
    const validTomoriData = tomoriSchema.partial().parse(tomoriData);

    // Extract field names and values for the SQL query.
    // Filter to only keys present in the original input — Zod injects defaults
    // for all schema fields with .default(), which would incorrectly expand the
    // SET clause (e.g. attribute_list: [] would overwrite existing data).
    const fields = Object.keys(validTomoriData).filter((key) => key !== "tomori_id" && key in tomoriData);

    if (fields.length === 0) {
      log.warn(`No fields provided to update for tomori_id: ${tomoriId}`);
      return null;
    }

    // Security validation: Ensure all field names are whitelisted to prevent SQL injection
    validateTomoriFields(fields);

    // 1. Prepare arrays for placeholders and values
    const setParts: string[] = [];
    const values: SqlParameterArray = [];

    // 2. Iterate through fields to build SET clause parts and collect values.
    // sql.unsafe() cannot infer PostgreSQL column types, so JavaScript arrays
    // must be manually serialized to PostgreSQL array literals (e.g. {"a","b"}).
    fields.forEach((field, index) => {
      setParts.push(`${field} = $${index + 1}`); // Use $1, $2, etc.
      const rawValue = validTomoriData[field as keyof typeof validTomoriData];
      if (Array.isArray(rawValue)) {
        // Serialize to PostgreSQL array literal: {"val1","val2"} or {}
        const escaped = rawValue.map((v) => `"${String(v).replace(/(["\\])/g, "\\$1")}"`);
        values.push(`{${escaped.join(",")}}`);
      } else {
        values.push(rawValue);
      }
    });

    // 3. Join the SET parts
    const setClause = setParts.join(", ");

    // 4. Add the tomoriId as the last parameter for the WHERE clause
    const finalPlaceholderIndex = values.length + 1;
    values.push(tomoriId);

    // 5. Execute the UPDATE using sql.unsafe() with the values array (not spread —
    // Bun SQL expects a single array argument, not individual arguments).
    const result = await sql.unsafe(
      `
			UPDATE tomoris
			SET ${setClause}
			WHERE tomori_id = $${finalPlaceholderIndex}
			RETURNING *
		`,
      values, // Pass values as a single array — sql.unsafe(query, valuesArray)
    );

    if (!result.length) {
      const context: ErrorContext = {
        tomoriId,
        errorType: "DatabaseUpdateError",
        metadata: {
          operation: "updateTomori",
          fields,
        },
      };
      await log.error(`No tomori found with id: ${tomoriId}`, new Error("Tomori not found"), context);
      return null;
    }

    // Validate the returned data for type safety
    const updatedTomori = tomoriSchema.safeParse(result[0]);
    if (!updatedTomori.success) {
      const context: ErrorContext = {
        tomoriId,
        errorType: "SchemaValidationError",
        metadata: {
          operation: "updateTomori",
          validationErrors: updatedTomori.error.flatten(),
        },
      };
      await log.error(`Failed to validate updated tomori for id: ${tomoriId}`, updatedTomori.error, context);
      return null;
    }

    return updatedTomori.data;
  } catch (error) {
    const context: ErrorContext = {
      tomoriId,
      errorType: "DatabaseUpdateError",
      metadata: {
        operation: "updateTomori",
      },
    };
    await log.error(`Error updating tomori for id: ${tomoriId}`, error, context);
    return null;
  }
}

/**
 * Updates a User record with partial data.
 * Uses zod's .partial() schema for validation and SQL RETURNING for atomicity.
 *
 * @param userId - The user_id to update
 * @param userData - Partial data to update (only specified fields will be changed)
 * @returns The updated UserRow or null if update failed
 */
