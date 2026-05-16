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
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import type { SqlParameterArray } from "@/types/db/sqlOperations";
import { sql } from "@/utils/db/client";
import { validateTomoriConfigFields } from "@/utils/db/sqlSecurity";
import { log } from "@/utils/misc/logger";
import type { IRepository } from "./IRepository";

// ── Stage A config table row shapes ───────────────────────────────────────────

/** Row shape for server_capabilities_configs (Phase 6 Stage A). */
export type ServerCapabilitiesConfigsRow = {
  emoji_usage_enabled: boolean;
  sticker_usage_enabled: boolean;
  web_search_enabled: boolean;
  manage_message_enabled: boolean;
  thread_creation_enabled: boolean;
  imagegen_enabled: boolean;
  videogen_enabled: boolean;
  voice_message_enabled: boolean;
  tool_use_enabled: boolean;
};

/** Row shape for server_novelai_imagegen_configs (Phase 6 Stage A). */
export type ServerNovelaiImagegenConfigsRow = {
  nai_preset_name: string | null;
  nai_style_tags: string[];
  nai_negative_tags: string[];
  nai_sampler: string | null;
  nai_steps: number | null;
  nai_scale: number | null;
  nai_noise_schedule: string | null;
  nai_cfg_rescale: number | null;
  nai_diffusion_model_id: number | null;
};

/** Row shape for server_nsfw_configs (Phase 6 Stage A). */
export type ServerNsfwConfigsRow = {
  uncensor_injection_enabled: boolean;
  uncensor_unicode_space_enabled: boolean;
  uncensor_sanitize_enabled: boolean;
};

/** Row shape for server_speech_configs (Phase 6 Stage A). */
export type ServerSpeechConfigsRow = {
  voice_transcript_chat_mode: boolean;
  chatterbox_turbo_enabled: boolean;
  chatterbox_cfg_weight: number;
  chatterbox_exaggeration: number;
};

/** Row shape for server_byok_configs (Phase 6 Stage A). */
export type ServerByokConfigsRow = {
  user_byok_mode: boolean;
};

/**
 * Composite export shape for ConfigRepository's Phase 6 Stage A tables.
 * Replaces the old Partial<TomoriConfigRow> stub.
 */
export type ConfigExportShape = {
  capabilities: ServerCapabilitiesConfigsRow | null;
  novelai_imagegen: ServerNovelaiImagegenConfigsRow | null;
  nsfw: ServerNsfwConfigsRow | null;
  speech: ServerSpeechConfigsRow | null;
  byok: ServerByokConfigsRow | null;
};

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
   * Reads capabilities, NAI imagegen, NSFW, speech, and BYOK configs for the given server.
   * Returns null if the server has no config row (i.e., not yet set up).
   *
   * @param ownerId - Discord server snowflake
   */
  async toExportShape(ownerId: string | number): Promise<ConfigExportShape | null> {
    const serverDiscId = String(ownerId);
    const serverId = await this.resolveServerId(serverDiscId);
    if (!serverId) return null;

    const [caps, nai, nsfw, speech, byok] = await Promise.all([
      this.sqlLoadCapabilitiesConfigs(serverId),
      this.sqlLoadNovelaiImagegenConfigs(serverId),
      this.sqlLoadNsfwConfigs(serverId),
      this.sqlLoadSpeechConfigs(serverId),
      this.sqlLoadByokConfigs(serverId),
    ]);

    if (!caps && !nai && !nsfw && !speech && !byok) return null;

    return { capabilities: caps, novelai_imagegen: nai, nsfw, speech, byok };
  }

  /**
   * Restores ConfigRepository-owned table rows for a server.
   * @param ownerId - Discord server snowflake
   * @param data    - Previously exported ConfigExportShape
   */
  async fromExportShape(ownerId: string | number, data: ConfigExportShape): Promise<boolean> {
    const serverDiscId = String(ownerId);
    const serverId = await this.resolveServerId(serverDiscId);
    if (!serverId) {
      log.error(`ConfigRepository.fromExportShape: server ${serverDiscId} not found`);
      return false;
    }

    try {
      const ops: Promise<void>[] = [];

      if (data.capabilities) ops.push(this.sqlUpsertCapabilitiesConfigs(serverId, data.capabilities));
      if (data.novelai_imagegen) ops.push(this.sqlUpsertNovelaiImagegenConfigs(serverId, data.novelai_imagegen));
      if (data.nsfw) ops.push(this.sqlUpsertNsfwConfigs(serverId, data.nsfw));
      if (data.speech) ops.push(this.sqlUpsertSpeechConfigs(serverId, data.speech));
      if (data.byok) ops.push(this.sqlUpsertByokConfigs(serverId, data.byok));

      await Promise.all(ops);
      invalidateTomoriStateCache(serverDiscId);
      return true;
    } catch (error) {
      log.error(`ConfigRepository.fromExportShape: write failed for ${serverDiscId}:`, error);
      return false;
    }
  }

  // ── Stage A: config table reads ───────────────────────────────────────────

  private async resolveServerId(serverDiscId: string): Promise<number | null> {
    const [row] = await sql`
      SELECT server_id FROM servers WHERE server_disc_id = ${serverDiscId} LIMIT 1
    `;
    return (row?.server_id as number | undefined) ?? null;
  }

  private async sqlLoadCapabilitiesConfigs(serverId: number): Promise<ServerCapabilitiesConfigsRow | null> {
    try {
      const [row] = await sql`
        SELECT emoji_usage_enabled, sticker_usage_enabled, web_search_enabled,
               manage_message_enabled, thread_creation_enabled, imagegen_enabled,
               videogen_enabled, voice_message_enabled, tool_use_enabled
        FROM server_capabilities_configs
        WHERE server_id = ${serverId}
      `;
      return row ? (row as unknown as ServerCapabilitiesConfigsRow) : null;
    } catch (error) {
      log.error(`Error loading server_capabilities_configs for server ${serverId}:`, error);
      return null;
    }
  }

  private async sqlLoadNovelaiImagegenConfigs(serverId: number): Promise<ServerNovelaiImagegenConfigsRow | null> {
    try {
      const [row] = await sql`
        SELECT nai_preset_name, nai_style_tags, nai_negative_tags, nai_sampler,
               nai_steps, nai_scale, nai_noise_schedule, nai_cfg_rescale, nai_diffusion_model_id
        FROM server_novelai_imagegen_configs
        WHERE server_id = ${serverId}
      `;
      return row ? (row as unknown as ServerNovelaiImagegenConfigsRow) : null;
    } catch (error) {
      log.error(`Error loading server_novelai_imagegen_configs for server ${serverId}:`, error);
      return null;
    }
  }

  private async sqlLoadNsfwConfigs(serverId: number): Promise<ServerNsfwConfigsRow | null> {
    try {
      const [row] = await sql`
        SELECT uncensor_injection_enabled, uncensor_unicode_space_enabled, uncensor_sanitize_enabled
        FROM server_nsfw_configs
        WHERE server_id = ${serverId}
      `;
      return row ? (row as unknown as ServerNsfwConfigsRow) : null;
    } catch (error) {
      log.error(`Error loading server_nsfw_configs for server ${serverId}:`, error);
      return null;
    }
  }

  private async sqlLoadSpeechConfigs(serverId: number): Promise<ServerSpeechConfigsRow | null> {
    try {
      const [row] = await sql`
        SELECT voice_transcript_chat_mode, chatterbox_turbo_enabled,
               chatterbox_cfg_weight, chatterbox_exaggeration
        FROM server_speech_configs
        WHERE server_id = ${serverId}
      `;
      return row ? (row as unknown as ServerSpeechConfigsRow) : null;
    } catch (error) {
      log.error(`Error loading server_speech_configs for server ${serverId}:`, error);
      return null;
    }
  }

  private async sqlLoadByokConfigs(serverId: number): Promise<ServerByokConfigsRow | null> {
    try {
      const [row] = await sql`
        SELECT user_byok_mode
        FROM server_byok_configs
        WHERE server_id = ${serverId}
      `;
      return row ? (row as unknown as ServerByokConfigsRow) : null;
    } catch (error) {
      log.error(`Error loading server_byok_configs for server ${serverId}:`, error);
      return null;
    }
  }

  // ── Stage A: config table upserts (new tables) ────────────────────────────

  private async sqlUpsertCapabilitiesConfigs(serverId: number, row: ServerCapabilitiesConfigsRow): Promise<void> {
    await sql`
      INSERT INTO server_capabilities_configs (
        server_id, emoji_usage_enabled, sticker_usage_enabled, web_search_enabled,
        manage_message_enabled, thread_creation_enabled, imagegen_enabled,
        videogen_enabled, voice_message_enabled, tool_use_enabled
      ) VALUES (
        ${serverId}, ${row.emoji_usage_enabled}, ${row.sticker_usage_enabled},
        ${row.web_search_enabled}, ${row.manage_message_enabled}, ${row.thread_creation_enabled},
        ${row.imagegen_enabled}, ${row.videogen_enabled}, ${row.voice_message_enabled},
        ${row.tool_use_enabled}
      )
      ON CONFLICT (server_id) DO UPDATE SET
        emoji_usage_enabled    = EXCLUDED.emoji_usage_enabled,
        sticker_usage_enabled  = EXCLUDED.sticker_usage_enabled,
        web_search_enabled     = EXCLUDED.web_search_enabled,
        manage_message_enabled = EXCLUDED.manage_message_enabled,
        thread_creation_enabled = EXCLUDED.thread_creation_enabled,
        imagegen_enabled       = EXCLUDED.imagegen_enabled,
        videogen_enabled       = EXCLUDED.videogen_enabled,
        voice_message_enabled  = EXCLUDED.voice_message_enabled,
        tool_use_enabled       = EXCLUDED.tool_use_enabled,
        updated_at             = NOW()
    `;
  }

  private async sqlUpsertNovelaiImagegenConfigs(serverId: number, row: ServerNovelaiImagegenConfigsRow): Promise<void> {
    await sql`
      INSERT INTO server_novelai_imagegen_configs (
        server_id, nai_preset_name, nai_style_tags, nai_negative_tags,
        nai_sampler, nai_steps, nai_scale, nai_noise_schedule, nai_cfg_rescale,
        nai_diffusion_model_id
      ) VALUES (
        ${serverId}, ${row.nai_preset_name}, ${sql.array(row.nai_style_tags)},
        ${sql.array(row.nai_negative_tags)}, ${row.nai_sampler}, ${row.nai_steps},
        ${row.nai_scale}, ${row.nai_noise_schedule}, ${row.nai_cfg_rescale},
        ${row.nai_diffusion_model_id}
      )
      ON CONFLICT (server_id) DO UPDATE SET
        nai_preset_name        = EXCLUDED.nai_preset_name,
        nai_style_tags         = EXCLUDED.nai_style_tags,
        nai_negative_tags      = EXCLUDED.nai_negative_tags,
        nai_sampler            = EXCLUDED.nai_sampler,
        nai_steps              = EXCLUDED.nai_steps,
        nai_scale              = EXCLUDED.nai_scale,
        nai_noise_schedule     = EXCLUDED.nai_noise_schedule,
        nai_cfg_rescale        = EXCLUDED.nai_cfg_rescale,
        nai_diffusion_model_id = EXCLUDED.nai_diffusion_model_id,
        updated_at             = NOW()
    `;
  }

  private async sqlUpsertNsfwConfigs(serverId: number, row: ServerNsfwConfigsRow): Promise<void> {
    await sql`
      INSERT INTO server_nsfw_configs (
        server_id, uncensor_injection_enabled, uncensor_unicode_space_enabled, uncensor_sanitize_enabled
      ) VALUES (
        ${serverId}, ${row.uncensor_injection_enabled}, ${row.uncensor_unicode_space_enabled},
        ${row.uncensor_sanitize_enabled}
      )
      ON CONFLICT (server_id) DO UPDATE SET
        uncensor_injection_enabled     = EXCLUDED.uncensor_injection_enabled,
        uncensor_unicode_space_enabled = EXCLUDED.uncensor_unicode_space_enabled,
        uncensor_sanitize_enabled      = EXCLUDED.uncensor_sanitize_enabled,
        updated_at                     = NOW()
    `;
  }

  private async sqlUpsertSpeechConfigs(serverId: number, row: ServerSpeechConfigsRow): Promise<void> {
    await sql`
      INSERT INTO server_speech_configs (
        server_id, voice_transcript_chat_mode, chatterbox_turbo_enabled,
        chatterbox_cfg_weight, chatterbox_exaggeration
      ) VALUES (
        ${serverId}, ${row.voice_transcript_chat_mode}, ${row.chatterbox_turbo_enabled},
        ${row.chatterbox_cfg_weight}, ${row.chatterbox_exaggeration}
      )
      ON CONFLICT (server_id) DO UPDATE SET
        voice_transcript_chat_mode = EXCLUDED.voice_transcript_chat_mode,
        chatterbox_turbo_enabled   = EXCLUDED.chatterbox_turbo_enabled,
        chatterbox_cfg_weight      = EXCLUDED.chatterbox_cfg_weight,
        chatterbox_exaggeration    = EXCLUDED.chatterbox_exaggeration,
        updated_at                 = NOW()
    `;
  }

  private async sqlUpsertByokConfigs(serverId: number, row: ServerByokConfigsRow): Promise<void> {
    await sql`
      INSERT INTO server_byok_configs (server_id, user_byok_mode)
      VALUES (${serverId}, ${row.user_byok_mode})
      ON CONFLICT (server_id) DO UPDATE SET
        user_byok_mode = EXCLUDED.user_byok_mode,
        updated_at     = NOW()
    `;
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
