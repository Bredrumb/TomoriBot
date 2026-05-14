import {
  type ErrorContext,
  type NaiPresetRow,
  type TomoriConfigRow,
  tomoriConfigSchema,
  type TomoriRow,
  tomoriSchema,
} from "@/types/db/schema";
import type { SqlParameterArray } from "@/types/db/sqlOperations";
import { sql } from "@/utils/db/client";
import { validateTomoriConfigFields } from "@/utils/db/sqlSecurity";
import { log } from "@/utils/misc/logger";

function rollAutochatTarget(minThreshold: number, maxThreshold: number): number {
  const normalizedMin = Math.max(minThreshold, 0);
  const normalizedMax = Math.max(maxThreshold, normalizedMin);

  if (normalizedMin <= 0 || normalizedMax <= 0) {
    return 0;
  }

  if (normalizedMin === normalizedMax) {
    return normalizedMin;
  }

  return Math.floor(Math.random() * (normalizedMax - normalizedMin + 1)) + normalizedMin;
}

/**
 * Advances the shared auto-chat cycle for a Tomori instance.
 * Fixed thresholds are represented as min=max, while ranged thresholds reroll
 * a new inclusive target after each successful auto-chat hit.
 * @param tomoriId - The ID of the Tomori instance.
 * @param minThreshold - The minimum auto-chat threshold from config.
 * @param maxThreshold - The maximum auto-chat threshold from config.
 * @returns The updated TomoriRow with the new counter/target state, or null on error.
 */
export async function incrementTomoriCounter(
  tomoriId: number,
  minThreshold: number,
  maxThreshold: number,
): Promise<TomoriRow | null> {
  try {
    const normalizedMin = Math.max(minThreshold, 0);
    const normalizedMax = Math.max(maxThreshold, normalizedMin);

    // Range disabled or always-reply mode: keep counter inert.
    if (normalizedMin <= 0 || normalizedMax <= 0) {
      const [incrementedTomori] = await sql`
				UPDATE tomoris
				SET autoch_counter = 0,
					autoch_next_target = 0
				WHERE tomori_id = ${tomoriId}
				RETURNING *
			`;

      // Validate and return
      const parsedTomori = tomoriSchema.safeParse(incrementedTomori);
      return parsedTomori.success ? parsedTomori.data : null;
    }

    const updatedTomori = await sql.transaction(async (tx) => {
      const [currentTomori] = await tx`
				SELECT *
				FROM tomoris
				WHERE tomori_id = ${tomoriId}
				FOR UPDATE
			`;

      if (!currentTomori) {
        return null;
      }

      const parsedCurrentTomori = tomoriSchema.safeParse(currentTomori);
      if (!parsedCurrentTomori.success) {
        const context: ErrorContext = {
          tomoriId,
          errorType: "SchemaValidationError",
          metadata: {
            operation: "incrementTomoriCounter",
            validationErrors: parsedCurrentTomori.error.flatten(),
          },
        };

        await log.error("Failed to validate Tomori data before counter update", parsedCurrentTomori.error, context);
        return null;
      }

      const currentTomoriRow = parsedCurrentTomori.data;
      const currentTarget = currentTomoriRow.autoch_next_target;
      const shouldStartNewCycle = currentTarget > 0 && currentTomoriRow.autoch_counter >= currentTarget;
      const nextTarget =
        shouldStartNewCycle || currentTarget <= 0 ? rollAutochatTarget(normalizedMin, normalizedMax) : currentTarget;
      const nextCounter = shouldStartNewCycle ? 1 : currentTomoriRow.autoch_counter + 1;

      const [updatedRow] = await tx`
				UPDATE tomoris
				SET autoch_counter = ${nextCounter},
					autoch_next_target = ${nextTarget}
				WHERE tomori_id = ${tomoriId}
				RETURNING *
			`;

      return updatedRow ?? null;
    });

    if (!updatedTomori) {
      const context: ErrorContext = {
        tomoriId,
        errorType: "DatabaseUpdateError",
        metadata: {
          operation: "incrementTomoriCounter",
          minThreshold: normalizedMin,
          maxThreshold: normalizedMax,
        },
      };

      await log.error(
        `Failed to increment auto-chat counter for Tomori ${tomoriId}`,
        new Error("Tomori not found"),
        context,
      );
      return null;
    }

    // Validate the returned data
    const parsedTomori = tomoriSchema.safeParse(updatedTomori);
    if (!parsedTomori.success) {
      const context: ErrorContext = {
        tomoriId,
        errorType: "SchemaValidationError",
        metadata: {
          operation: "incrementTomoriCounter",
          validationErrors: parsedTomori.error.flatten(),
        },
      };

      await log.error("Failed to validate Tomori data after counter update", parsedTomori.error, context);
      return null;
    }

    return parsedTomori.data;
  } catch (error) {
    const context: ErrorContext = {
      tomoriId,
      errorType: "DatabaseOperationError",
      metadata: {
        operation: "incrementTomoriCounter",
        minThreshold,
        maxThreshold,
      },
    };

    await log.error(`Error incrementing auto counter for Tomori ${tomoriId}`, error, context);
    return null;
  }
}

/**
 * Sets up a new server with Tomori in a single atomic transaction.
 * Creates server record, Tomori instance, config, and registers all server emojis.
 * Supports both guild channels and DM contexts (pseudo-servers).
 *
 * @param guild - The Discord guild to setup (null for DM contexts)
 * @param config - Configuration data for server setup
 * @returns All database rows created during setup
 * @throws If validation fails or any part of the setup transaction fails
 */
export async function updateTomoriConfig(
  serverId: number,
  configData: Partial<TomoriConfigRow>,
): Promise<TomoriConfigRow | null> {
  try {
    // Validate the partial data with Zod (Rule #7)
    const validConfigData = tomoriConfigSchema.partial().parse(configData);

    // Extract field names and values for the SQL query.
    // Filter to only keys that were in the original input — Zod injects defaults for all
    // schema fields with .default(), which would incorrectly expand the SET clause.
    const fields = Object.keys(validConfigData).filter(
      (key) => key !== "tomori_id" && key !== "tomori_config_id" && key in configData,
    );

    if (fields.length === 0) {
      log.warn(`No fields provided to update for server_id: ${serverId}`);
      return null;
    }

    // Security validation: Ensure all field names are whitelisted to prevent SQL injection
    validateTomoriConfigFields(fields);

    // Dynamically build the SQL SET clause
    // 1. Prepare arrays for placeholders and values
    const setParts: string[] = [];
    const values: SqlParameterArray = [];

    // 2. Iterate through fields to build SET clause parts and collect values
    fields.forEach((field, index) => {
      // Use PostgreSQL standard placeholders ($1, $2, etc.)
      setParts.push(`${field} = $${index + 1}`);
      // Add the corresponding value to the values array
      values.push(validConfigData[field as keyof typeof validConfigData]);
    });

    // 3. Join the SET parts
    const setClause = setParts.join(", ");

    // 4. Add the tomoriId as the last parameter for the WHERE clause
    const finalPlaceholderIndex = values.length + 1;
    values.push(serverId);

    // 5. Execute the UPDATE using sql.unsafe() with the values array (not spread —
    // Bun SQL expects a single array argument, not individual arguments).
    const result = await sql.unsafe(
      `
			UPDATE tomori_configs
			SET ${setClause}
			WHERE server_id = $${finalPlaceholderIndex}
			RETURNING *
		`,
      values, // Pass values as a single array — sql.unsafe(query, valuesArray)
    );

    if (!result.length) {
      const context: ErrorContext = {
        serverId,
        errorType: "DatabaseUpdateError",
        metadata: {
          operation: "updateTomoriConfig",
          fields,
        },
      };
      await log.error(`No tomori_config found with server_id: ${serverId}`, new Error("Config not found"), context);
      return null;
    }

    // Validate the returned data for type safety (Rule #5)
    const updatedConfig = tomoriConfigSchema.safeParse(result[0]);
    if (!updatedConfig.success) {
      const context: ErrorContext = {
        serverId,
        errorType: "SchemaValidationError",
        metadata: {
          operation: "updateTomoriConfig",
          validationErrors: updatedConfig.error.flatten(),
        },
      };
      await log.error(`Failed to validate updated config for server_id: ${serverId}`, updatedConfig.error, context);
      return null;
    }

    return updatedConfig.data;
  } catch (error) {
    const context: ErrorContext = {
      serverId,
      errorType: "DatabaseUpdateError",
      metadata: {
        operation: "updateTomoriConfig",
      },
    };
    await log.error(`Error updating tomori_config for server_id: ${serverId}`, error, context);
    return null;
  }
}

/**
 * Previously converted NAI-scale temperature back to a Gemini-centric scale.
 * Now a direct passthrough — temperature is stored as-is across all providers.
 *
 * @param naiTemp - Temperature from the NAI preset
 * @param _model - The LLM codename (unused, kept for call-site compatibility)
 * @returns The temperature unchanged, clamped to the valid DB range [0.0, 2.0]
 */
function invertNaiTemperature(naiTemp: number, _model: string): number {
  return Math.min(2.0, Math.max(0.0, naiTemp));
}

/**
 * Applies a NovelAI sampling preset to a server's configuration.
 *
 * Extracts schema-compatible fields (temperature, top_k, top_p, min_p) from
 * the preset's parameters, converts temperature back to Gemini scale, and
 * writes them alongside nai_preset_name to tomori_configs. NAI-specific fields
 * (order, tail_free_sampling, phrase_rep_pen, etc.) remain in the preset row
 * and are merged at generation time via extractNonSchemaPresetParams().
 *
 * @param serverId - Database server_id of the server to update
 * @param preset - The NaiPresetRow to apply
 * @param model - LLM codename (e.g. "kayra-v1") for temperature conversion
 * @returns The updated TomoriConfigRow, or null if the update failed
 */
export async function applyNaiPreset(
  serverId: number,
  preset: NaiPresetRow,
  model: string,
): Promise<TomoriConfigRow | null> {
  const params = preset.parameters;

  // 1. Extract schema-compatible sampling fields from the preset.
  //    Absent values fall back to neutral/disabled DB defaults.
  const naiTemp = typeof params.temperature === "number" ? params.temperature : 1.35;
  const llm_temperature = invertNaiTemperature(naiTemp, model);
  const llm_top_k = typeof params.top_k === "number" ? Math.round(params.top_k) : 0;
  const llm_top_p = typeof params.top_p === "number" ? params.top_p : 1.0;
  const llm_min_p = typeof params.min_p === "number" ? params.min_p : 0.05;

  // 2. Write to DB, linking the preset name for non-schema field lookup at generation time.
  return updateTomoriConfig(serverId, {
    llm_temperature,
    llm_top_k,
    llm_top_p,
    llm_min_p,
    nai_preset_name: preset.preset_name,
  });
}

/**
 * Updates a Tomori record with partial data.
 * Uses zod's .partial() schema for validation and SQL RETURNING for atomicity.
 *
 * @param tomoriId - The tomori_id to update
 * @param tomoriData - Partial data to update (only specified fields will be changed)
 * @returns The updated TomoriRow or null if update failed
 */
