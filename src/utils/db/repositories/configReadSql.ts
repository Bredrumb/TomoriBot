import {
  naiPresetSchema,
  type NaiPresetRow,
  type SystemPromptPresetRow,
  type TomoriPresetRow,
} from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
export async function loadNaiPresetsForModel(target: "kayra" | "erato"): Promise<NaiPresetRow[]> {
  try {
    const rows = await sql`
			SELECT * FROM nai_presets
			WHERE model_target = ${target}
			ORDER BY is_default DESC, preset_name ASC
		`;

    const presets: NaiPresetRow[] = [];
    for (const row of rows) {
      const parsed = naiPresetSchema.safeParse(row);
      if (parsed.success) {
        presets.push(parsed.data);
      } else {
        log.warn(`Invalid nai_preset row for target ${target}:`, parsed.error.flatten());
      }
    }
    return presets;
  } catch (error) {
    log.error(`Error loading NAI presets for model target ${target}:`, error);
    return [];
  }
}

/**
 * Loads the complete Tomori state (base row + config + server memories) for a given server.
 * Validates the combined state using Zod.
 * @param serverDiscId - The Discord ID of the server.
 * @returns The validated TomoriState object, or null if not found or invalid.
 */
export async function loadPresetOptions(
  maxDescriptionLength = 100,
): Promise<Array<{ name: string; description: string }> | null> {
  try {
    // 1. Query for all presets with descriptions
    const presetRows = await sql`
			SELECT tomori_preset_name, tomori_preset_desc
			FROM tomori_presets
			ORDER BY tomori_preset_name ASC
		`;

    // 2. Check if any rows were returned
    if (!presetRows || presetRows.length === 0) {
      log.warn("No personality presets found in the database.");
      return null;
    }

    // 3. Process and truncate descriptions
    const presetOptions = presetRows.map((row: Record<string, unknown>) => {
      const description = row.tomori_preset_desc as string;
      const truncatedDescription =
        description.length > maxDescriptionLength
          ? `${description.substring(0, maxDescriptionLength - 3)}...`
          : description;

      return {
        name: row.tomori_preset_name as string,
        description: truncatedDescription,
      };
    });

    log.info(`Found ${presetOptions.length} personality presets for selection menu.`);
    return presetOptions;
  } catch (error) {
    // 4. Log any unexpected errors during the database query
    log.error("Error loading preset options from database:", error);
    return null;
  }
}

/**
 * Loads personality presets filtered by locale with truncated descriptions for dynamic select menus.
 * Implements fallback logic: tries exact locale match → base language → 'en-US' fallback.
 * @param locale - The locale code to filter by (e.g., 'en-US', 'ja')
 * @param maxDescriptionLength - Maximum length for preset descriptions (default: 100)
 * @returns An array of preset options with truncated descriptions, or null if error or none found.
 */
export async function loadPresetOptionsByLocale(
  locale: string,
  maxDescriptionLength = 100,
): Promise<Array<{ name: string; description: string }> | null> {
  try {
    // 1. Try exact locale match (e.g., 'ja')
    let presetRows = await sql`
			SELECT tomori_preset_name, tomori_preset_desc
			FROM tomori_presets
			WHERE preset_language = ${locale}
			ORDER BY tomori_preset_name ASC
		`;

    // 2. If no exact match, try base language (e.g., 'ja' from 'ja-JP')
    if (presetRows.length === 0) {
      const baseLanguage = locale.split("-")[0];
      presetRows = await sql`
				SELECT tomori_preset_name, tomori_preset_desc
				FROM tomori_presets
				WHERE preset_language = ${baseLanguage}
				ORDER BY tomori_preset_name ASC
			`;

      if (presetRows.length > 0) {
        log.info(`No presets found for locale '${locale}', using base language '${baseLanguage}' instead.`);
      }
    }

    // 3. If still no presets, fall back to 'en-US'
    if (presetRows.length === 0 && locale !== "en-US") {
      presetRows = await sql`
				SELECT tomori_preset_name, tomori_preset_desc
				FROM tomori_presets
				WHERE preset_language = 'en-US'
				ORDER BY tomori_preset_name ASC
			`;

      if (presetRows.length > 0) {
        log.info(`No presets found for locale '${locale}', falling back to English presets.`);
      }
    }

    // 4. Check if any rows were returned after all fallback attempts
    if (!presetRows || presetRows.length === 0) {
      log.warn(`No personality presets found for locale '${locale}' or any fallback language.`);
      return null;
    }

    // 5. Process and truncate descriptions
    const presetOptions = presetRows.map((row: Record<string, unknown>) => {
      const description = row.tomori_preset_desc as string;
      const truncatedDescription =
        description.length > maxDescriptionLength
          ? `${description.substring(0, maxDescriptionLength - 3)}...`
          : description;

      return {
        name: row.tomori_preset_name as string,
        description: truncatedDescription,
      };
    });

    log.info(`Found ${presetOptions.length} personality presets for locale '${locale}' (selection menu).`);
    return presetOptions;
  } catch (error) {
    // 6. Log any unexpected errors during the database query
    log.error(`Error loading preset options for locale '${locale}' from database:`, error);
    return null;
  }
}

/**
 * Loads full personality preset rows filtered by locale.
 * Implements fallback logic: tries exact locale match → base language → 'en-US' fallback.
 * Returns complete TomoriPresetRow objects with all fields (attributes, sample dialogues, etc.).
 * @param locale - The locale code to filter by (e.g., 'en-US', 'ja')
 * @returns An array of TomoriPresetRow objects, or null if error or none found.
 */
export async function loadPresetRowsByLocale(locale: string): Promise<TomoriPresetRow[] | null> {
  try {
    // 1. Try exact locale match (e.g., 'ja')
    let presets = await sql`
			SELECT * FROM tomori_presets
			WHERE preset_language = ${locale}
			ORDER BY tomori_preset_name ASC
		`;

    // 2. If no exact match, try base language (e.g., 'ja' from 'ja-JP')
    if (presets.length === 0) {
      const baseLanguage = locale.split("-")[0];
      presets = await sql`
				SELECT * FROM tomori_presets
				WHERE preset_language = ${baseLanguage}
				ORDER BY tomori_preset_name ASC
			`;

      if (presets.length > 0) {
        log.info(`No presets found for locale '${locale}', using base language '${baseLanguage}' instead.`);
      }
    }

    // 3. If still no presets, fall back to 'en-US'
    if (presets.length === 0 && locale !== "en-US") {
      presets = await sql`
				SELECT * FROM tomori_presets
				WHERE preset_language = 'en-US'
				ORDER BY tomori_preset_name ASC
			`;

      if (presets.length > 0) {
        log.info(`No presets found for locale '${locale}', falling back to English presets.`);
      }
    }

    // 4. Check if any rows were returned after all fallback attempts
    if (!presets || presets.length === 0) {
      log.warn(`No personality presets found for locale '${locale}' or any fallback language.`);
      return null;
    }

    log.info(`Found ${presets.length} personality preset rows for locale '${locale}'.`);
    return presets as TomoriPresetRow[];
  } catch (error) {
    // 5. Log any unexpected errors during the database query
    log.error(`Error loading preset rows for locale '${locale}' from database:`, error);
    return null;
  }
}

/**
 * Loads all preset rows from the database (all locales)
 * Used for initializing preset avatar cache at startup
 * @returns Promise that resolves to array of all preset rows or null on error
 */
export async function loadAllPresets(): Promise<TomoriPresetRow[] | null> {
  try {
    const presets = await sql`
			SELECT * FROM tomori_presets
			ORDER BY tomori_preset_name ASC
		`;

    if (!presets || presets.length === 0) {
      log.warn("No personality presets found in database.");
      return null;
    }

    log.info(`Loaded ${presets.length} personality presets from database.`);
    return presets as TomoriPresetRow[];
  } catch (error) {
    log.error("Error loading all presets from database:", error);
    return null;
  }
}

/**
 * Loads all system prompt presets from the database
 * @returns Promise that resolves to array of SystemPromptPresetRow or null on error
 */
export async function loadSystemPromptPresets(): Promise<SystemPromptPresetRow[] | null> {
  try {
    // 1. Query all system prompt presets ordered by ID
    const presets = await sql`
			SELECT * FROM system_prompt_presets
			ORDER BY system_prompt_preset_id ASC
		`;

    // 2. Check if any presets were found
    if (!presets || presets.length === 0) {
      log.warn("No system prompt presets found in database.");
      return null;
    }

    // 3. Log successful load
    log.info(`Loaded ${presets.length} system prompt presets from database.`);

    // 4. Return the presets
    return presets as SystemPromptPresetRow[];
  } catch (error) {
    // 5. Log any errors during the database query
    log.error("Error loading system prompt presets from database:", error);
    return null;
  }
}

/**
 * Loads all stickers for a given server's Discord ID from the database.
 * @param serverDiscId - The Discord ID of the server.
 * @returns A promise that resolves to an array of ServerStickerRow or null if server not found/error.
 *          Returns an empty array if the server is found but has no stickers.
 */
