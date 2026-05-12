/**
 * ConfigRepository — manages `tomori_configs` and preset tables.
 *
 * Owns all writes to tomori_configs plus preset reads and fallback LLM config.
 * Persona identity fields (nickname, lineage) live in PersonaRepository.
 *
 * Export contract: toExportShape / fromExportShape are required by IRepository
 * and consumed by the Phase 6 (#16.7) export pipeline composition.
 */
import type { ErrorContext, TomoriConfigRow, NaiPresetRow } from "@/types/db/schema";
import { tomoriConfigSchema, tomoriSchema, naiPresetSchema } from "@/types/db/schema";
import type { TomoriPresetRow, SystemPromptPresetRow } from "@/types/db/schema";
import type { FallbackModelRef } from "@/types/db/schema";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import type { SqlParameterArray } from "@/types/db/sqlOperations";
import { sql } from "@/utils/db/client";
import { validateTomoriConfigFields } from "@/utils/db/sqlSecurity";
import { log } from "@/utils/misc/logger";
import type { IRepository } from "./IRepository";

/** Portable config export shape (expanded in Phase 6 #16.7). */
export type ConfigExportShape = Partial<TomoriConfigRow>;

export class ConfigRepository implements IRepository<ConfigExportShape> {
  // ── reads ──────────────────────────────────────────────────────────────────

  /**
   * Loads NAI sampling presets available for a given NAI model target.
   *
   * @param target - "kayra" or "erato"
   */
  async loadNaiPresets(target: "kayra" | "erato"): Promise<NaiPresetRow[]> {
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
   * Loads preset option rows with an optional max description length.
   *
   * @param maxDescriptionLength - Truncate descriptions to this length (default 100)
   */
  async loadPresetOptions(maxDescriptionLength?: number): Promise<Array<{ name: string; description: string }> | null> {
    try {
      const descriptionLength = maxDescriptionLength ?? 100;
      const presetRows = await sql`
        SELECT tomori_preset_name, tomori_preset_desc
        FROM tomori_presets
        ORDER BY tomori_preset_name ASC
      `;

      if (!presetRows || presetRows.length === 0) {
        log.warn("No personality presets found in the database.");
        return null;
      }

      const presetOptions = presetRows.map((row: Record<string, unknown>) => {
        const description = row.tomori_preset_desc as string;
        const truncatedDescription =
          description.length > descriptionLength
            ? `${description.substring(0, descriptionLength - 3)}...`
            : description;

        return {
          name: row.tomori_preset_name as string,
          description: truncatedDescription,
        };
      });

      log.info(`Found ${presetOptions.length} personality presets for selection menu.`);
      return presetOptions;
    } catch (error) {
      log.error("Error loading preset options from database:", error);
      return null;
    }
  }

  /**
   * Loads preset option rows filtered by locale, with an optional max description length.
   *
   * @param locale               - Locale code (e.g. "en-US")
   * @param maxDescriptionLength - Truncate descriptions to this length (default 100)
   */
  async loadPresetOptionsByLocale(
    locale: string,
    maxDescriptionLength?: number,
  ): Promise<Array<{ name: string; description: string }> | null> {
    try {
      const descriptionLength = maxDescriptionLength ?? 100;
      let presetRows = await sql`
        SELECT tomori_preset_name, tomori_preset_desc
        FROM tomori_presets
        WHERE preset_language = ${locale}
        ORDER BY tomori_preset_name ASC
      `;

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

      if (!presetRows || presetRows.length === 0) {
        log.warn(`No personality presets found for locale '${locale}' or any fallback language.`);
        return null;
      }

      const presetOptions = presetRows.map((row: Record<string, unknown>) => {
        const description = row.tomori_preset_desc as string;
        const truncatedDescription =
          description.length > descriptionLength
            ? `${description.substring(0, descriptionLength - 3)}...`
            : description;

        return {
          name: row.tomori_preset_name as string,
          description: truncatedDescription,
        };
      });

      log.info(`Found ${presetOptions.length} personality presets for locale '${locale}' (selection menu).`);
      return presetOptions;
    } catch (error) {
      log.error(`Error loading preset options for locale '${locale}' from database:`, error);
      return null;
    }
  }

  /**
   * Loads full preset rows for a given locale.
   *
   * @param locale - Locale code
   */
  async loadPresetRowsByLocale(locale: string): Promise<TomoriPresetRow[] | null> {
    try {
      let presets = await sql`
        SELECT * FROM tomori_presets
        WHERE preset_language = ${locale}
        ORDER BY tomori_preset_name ASC
      `;

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

      if (!presets || presets.length === 0) {
        log.warn(`No personality presets found for locale '${locale}' or any fallback language.`);
        return null;
      }

      log.info(`Found ${presets.length} personality preset rows for locale '${locale}'.`);
      return presets as TomoriPresetRow[];
    } catch (error) {
      log.error(`Error loading preset rows for locale '${locale}' from database:`, error);
      return null;
    }
  }

  /** Loads all preset rows regardless of locale. */
  async loadAllPresets(): Promise<TomoriPresetRow[] | null> {
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

  /** Loads all system-prompt preset rows. */
  async loadSystemPromptPresets(): Promise<SystemPromptPresetRow[] | null> {
    try {
      const presets = await sql`
        SELECT * FROM system_prompt_presets
        ORDER BY system_prompt_preset_id ASC
      `;

      if (!presets || presets.length === 0) {
        log.warn("No system prompt presets found in database.");
        return null;
      }

      log.info(`Loaded ${presets.length} system prompt presets from database.`);
      return presets as SystemPromptPresetRow[];
    } catch (error) {
      log.error("Error loading system prompt presets from database:", error);
      return null;
    }
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  /**
   * Updates arbitrary tomori_config fields for a server.
   * Invalidates the tomori state cache after write.
   *
   * @param serverId     - Internal server DB ID
   * @param configData   - Partial TomoriConfigRow with fields to update
   * @param serverDiscId - Discord server snowflake (required for cache invalidation)
   * @returns Updated TomoriConfigRow or null on failure
   */
  async update(
    serverId: number,
    configData: Partial<TomoriConfigRow>,
    serverDiscId?: string,
  ): Promise<TomoriConfigRow | null> {
    const row = await this.updateTomoriConfigRow(serverId, configData);
    if (row && serverDiscId) invalidateTomoriStateCache(serverDiscId);
    return row;
  }

  /**
   * Applies a NovelAI preset's sampling parameters to a server's config.
   * Invalidates the tomori state cache after write.
   *
   * @param serverId     - Internal server DB ID
   * @param preset       - NaiPresetRow to apply
   * @param model        - LLM codename for temperature conversion
   * @param serverDiscId - Discord server snowflake (required for cache invalidation)
   * @returns Updated TomoriConfigRow or null on failure
   */
  async applyNaiPreset(
    serverId: number,
    preset: NaiPresetRow,
    model: string,
    serverDiscId?: string,
  ): Promise<TomoriConfigRow | null> {
    const params = preset.parameters;
    const naiTemp = typeof params.temperature === "number" ? params.temperature : 1.35;
    const llm_temperature = this.invertNaiTemperature(naiTemp, model);
    const llm_top_k = typeof params.top_k === "number" ? Math.round(params.top_k) : 0;
    const llm_top_p = typeof params.top_p === "number" ? params.top_p : 1.0;
    const llm_min_p = typeof params.min_p === "number" ? params.min_p : 0.05;

    const row = await this.updateTomoriConfigRow(serverId, {
      llm_temperature,
      llm_top_k,
      llm_top_p,
      llm_min_p,
      nai_preset_name: preset.preset_name,
    });
    if (row && serverDiscId) invalidateTomoriStateCache(serverDiscId);
    return row;
  }

  /**
   * Increments the auto-chat counter for a Tomori and rolls a new target if needed.
   * Does NOT invalidate the tomori state cache (counter is a hot-path write).
   *
   * @param tomoriId     - Internal tomori DB ID
   * @param minThreshold - Minimum auto-chat threshold from config
   * @param maxThreshold - Maximum auto-chat threshold from config
   */
  async incrementTomoriCounter(tomoriId: number, minThreshold: number, maxThreshold: number) {
    try {
      const normalizedMin = Math.max(minThreshold, 0);
      const normalizedMax = Math.max(maxThreshold, normalizedMin);

      if (normalizedMin <= 0 || normalizedMax <= 0) {
        const [incrementedTomori] = await sql`
          UPDATE tomoris
          SET autoch_counter = 0,
            autoch_next_target = 0
          WHERE tomori_id = ${tomoriId}
          RETURNING *
        `;

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
          shouldStartNewCycle || currentTarget <= 0
            ? this.rollAutochatTarget(normalizedMin, normalizedMax)
            : currentTarget;
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
   * Replaces the fallback LLM list for a server (legacy integer-ID form).
   * Invalidates the tomori state cache after write.
   *
   * @param serverId     - Internal server DB ID
   * @param llmIds       - Ordered list of fallback LLM IDs
   * @param serverDiscId - Discord server snowflake (required for cache invalidation)
   */
  async setFallbackLlms(serverId: number, llmIds: number[], serverDiscId: string): Promise<boolean> {
    const ok = await this.setFallbackLlmRows(serverId, llmIds);
    if (ok) invalidateTomoriStateCache(serverDiscId);
    return ok;
  }

  /**
   * Replaces the fallback model reference list for a server (provider+codename form).
   * Invalidates the tomori state cache after write.
   *
   * @param serverId     - Internal server DB ID
   * @param refs         - Ordered list of FallbackModelRef objects
   * @param serverDiscId - Discord server snowflake (required for cache invalidation)
   */
  async setFallbackModelRefs(serverId: number, refs: FallbackModelRef[], serverDiscId: string): Promise<boolean> {
    const ok = await this.setFallbackModelRefRows(serverId, refs);
    if (ok) invalidateTomoriStateCache(serverDiscId);
    return ok;
  }

  // ── IRepository contract ───────────────────────────────────────────────────

  /**
   * Config export is handled by ImportExportRepository (full server export).
   * This stub satisfies the IRepository contract; expansion is deferred to Phase 6 #16.7.
   *
   * @param _ownerId - Discord server snowflake (unused until Phase 6)
   */
  async toExportShape(_ownerId: string | number): Promise<ConfigExportShape | null> {
    return null;
  }

  /**
   * Config import is handled by ImportExportRepository.
   * Stub satisfies IRepository contract pending Phase 6 #16.7.
   */
  async fromExportShape(_ownerId: string | number, _data: ConfigExportShape): Promise<boolean> {
    return false;
  }

  private async updateTomoriConfigRow(
    serverId: number,
    configData: Partial<TomoriConfigRow>,
  ): Promise<TomoriConfigRow | null> {
    try {
      const validConfigData = tomoriConfigSchema.partial().parse(configData);
      const fields = Object.keys(validConfigData).filter(
        (key) => key !== "tomori_id" && key !== "tomori_config_id" && key in configData,
      );

      if (fields.length === 0) {
        log.warn(`No fields provided to update for server_id: ${serverId}`);
        return null;
      }

      validateTomoriConfigFields(fields);

      const setParts: string[] = [];
      const values: SqlParameterArray = [];

      fields.forEach((field, index) => {
        setParts.push(`${field} = $${index + 1}`);
        values.push(validConfigData[field as keyof typeof validConfigData]);
      });

      const setClause = setParts.join(", ");
      const finalPlaceholderIndex = values.length + 1;
      values.push(serverId);

      const result = await sql.unsafe(
        `
          UPDATE tomori_configs
          SET ${setClause}
          WHERE server_id = $${finalPlaceholderIndex}
          RETURNING *
        `,
        values,
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

  private invertNaiTemperature(naiTemp: number, _model: string): number {
    return Math.min(2.0, Math.max(0.0, naiTemp));
  }

  private rollAutochatTarget(minThreshold: number, maxThreshold: number): number {
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

  private async setFallbackLlmRows(serverId: number, llmIds: number[]): Promise<boolean> {
    try {
      const fallbackJson = JSON.stringify(llmIds);
      const updatedRows = await sql<
        Array<{
          tomori_config_id: number;
          server_id: number | null;
          tomori_id: number | null;
          fallback_llm_ids: unknown;
        }>
      >`
        UPDATE tomori_configs
        SET fallback_llm_ids = ${fallbackJson}::JSONB,
            updated_at = CURRENT_TIMESTAMP
        WHERE server_id = ${serverId}
           OR (
             server_id IS NULL
             AND tomori_id IN (
               SELECT tomori_id FROM tomoris
               WHERE server_id = ${serverId}
                 AND is_alter = false
             )
           )
        RETURNING tomori_config_id, server_id, tomori_id, fallback_llm_ids
      `;

      if (updatedRows.length === 0) {
        log.warn(
          `[FallbackConfig] setFallbackLlms matched 0 rows for server_id ${serverId} (requested ids: [${llmIds.join(", ")}])`,
        );
        return false;
      }

      if (this.fallbackDebugEnabled()) {
        const updatedRowSummary = updatedRows.map((row) => ({
          tomori_config_id: row.tomori_config_id,
          server_id: row.server_id,
          tomori_id: row.tomori_id,
          fallback_llm_ids: row.fallback_llm_ids,
        }));
        log.info(
          `[FallbackDebug][setFallbackLlms] server_id=${serverId} requested_ids=[${llmIds.join(", ")}] updated_rows=${JSON.stringify(updatedRowSummary)}`,
        );
      }

      return true;
    } catch (error) {
      log.error(`Error setting fallback LLMs for server ${serverId} (ids: [${llmIds.join(", ")}]):`, error);
      return false;
    }
  }

  private async setFallbackModelRefRows(serverId: number, refs: FallbackModelRef[]): Promise<boolean> {
    try {
      const refsJson = JSON.stringify(refs);
      const legacyIds = refs.filter((ref) => ref.type === "llm").map((ref) => ref.id);
      const legacyJson = JSON.stringify(legacyIds);

      const updatedRows = await sql`
        UPDATE tomori_configs
        SET
          fallback_model_refs = ${refsJson}::JSONB,
          fallback_llm_ids    = ${legacyJson}::JSONB,
          updated_at          = CURRENT_TIMESTAMP
        WHERE server_id = ${serverId}
           OR (
             server_id IS NULL
             AND tomori_id IN (
               SELECT tomori_id FROM tomoris
               WHERE server_id = ${serverId}
                 AND is_alter = false
             )
           )
        RETURNING tomori_config_id
      `;

      if (updatedRows.length === 0) {
        log.warn(`[FallbackConfig] setFallbackModelRefs matched 0 rows for server_id ${serverId}`);
        return false;
      }

      return true;
    } catch (error) {
      log.error(`Error setting fallback model refs for server ${serverId}:`, error);
      return false;
    }
  }

  private fallbackDebugEnabled(): boolean {
    return new Set(["1", "true", "yes", "on"]).has((process.env.FALLBACK_DEBUG_ENABLED ?? "").trim().toLowerCase());
  }
}

/** Singleton instance — import this in callers. */
export const configRepository = new ConfigRepository();
