import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import {
  EXPORT_VERSION,
  personalMemoriesExportSchema,
  globalPersonalMemoriesExportSchema,
  personalSettingsExportSchema,
  serverMemoriesExportSchema,
  serverConfigOnlyExportSchema,
  getPersonalExportSchema,
  getServerExportSchema,
  type PersonalExportData,
  type ServerExportData,
  type PersonalMemoriesExportData,
  type ServerMemoriesExportData,
  type PersonalSettingsExportData,
  type ServerConfigExport,
  type ImportResult,
  type MemoryItem,
  type ExportResult,
} from "@/types/db/dataExport";
import { validateMemoryContent } from "@/utils/misc/memoryLimits";
import { validateTomoriConfigFields } from "@/utils/db/sqlSecurity";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import { invalidateUserCache } from "@/utils/cache/userCache";
import { configRepository } from "@/utils/db/repositories/ConfigRepository";
import type { ServerChatConfigRow, ServerNoticeEmbedsConfigRow } from "@/types/db/schema";

export type ImportFileType =
  | "personal_memories"
  | "server_memories"
  | "personal_settings"
  | "server_config"
  | "global_personal_memories"
  | "personal"
  | "server";

export interface ImportValidationResult {
  valid: boolean;
  type?: ImportFileType;
  data?:
    | PersonalMemoriesExportData
    | ServerMemoriesExportData
    | PersonalSettingsExportData
    | { config: ServerConfigExport }
    | PersonalExportData
    | ServerExportData;
  error?: string;
}

/**
 * ImportRepository — owns all data import operations.
 *
 * Handles personal and server data import, per-domain slice imports
 * (memories, settings, config), import file validation, and cache
 * invalidation after successful writes. Private SQL methods hold raw
 * database logic; public methods add cache invalidation on top.
 * Composite methods (importPersonalData, importServerData) call private
 * SQL sub-methods directly to avoid double cache invalidation.
 */
export class ImportRepository {
  // ── private SQL helpers ────────────────────────────────────────────────────

  /** Upserts a user row by Discord ID and returns the internal user_id. */
  private async ensureUserId(userDiscId: string): Promise<number | null> {
    const upserted = await sql<Array<{ user_id: number }>>`
      INSERT INTO users (
        user_disc_id,
        user_nickname,
        language_pref
      ) VALUES (
        ${userDiscId},
        ${userDiscId},
        'en'
      )
      ON CONFLICT (user_disc_id) DO UPDATE
      SET user_disc_id = EXCLUDED.user_disc_id
      RETURNING user_id
    `;

    return upserted[0]?.user_id ?? null;
  }

  /** Resolves a Discord server ID to the internal server_id. */
  private async resolveServerId(serverDiscId: string): Promise<number | null> {
    const serverRows = await sql<Array<{ server_id: number }>>`
      SELECT s.server_id
      FROM servers s
      WHERE s.server_disc_id = ${serverDiscId}
      LIMIT 1
    `;
    return serverRows[0]?.server_id ?? null;
  }

  /** Normalizes bigint/string/number persona_lineage_id values to a plain number. */
  private coerceLineageId(value: number | string | bigint | null | undefined): number | null {
    if (typeof value === "bigint") return Number(value);
    if (typeof value === "string" && value.trim() !== "") return Number(value);
    if (typeof value === "number") return value;
    return null;
  }

  /** Returns the main persona tomori_id and persona_lineage_id for a server. */
  private async resolveMainTomoriScope(
    serverId: number,
  ): Promise<{ tomoriId: number; personaLineageId: number } | null> {
    const mainPersonaRows = await sql<Array<{ tomori_id: number; persona_lineage_id: number | string | bigint }>>`
      SELECT tomori_id, persona_lineage_id
      FROM tomoris
      WHERE server_id = ${serverId}
        AND is_alter = false
      ORDER BY updated_at DESC NULLS LAST, tomori_id DESC
      LIMIT 1
    `;

    const mainTomori = mainPersonaRows[0];
    if (!mainTomori) return null;

    const personaLineageId = this.coerceLineageId(mainTomori.persona_lineage_id);
    if (typeof personaLineageId !== "number" || !Number.isFinite(personaLineageId)) return null;

    return { tomoriId: mainTomori.tomori_id, personaLineageId };
  }

  // ── private SQL operations (no cache) ─────────────────────────────────────

  private async sqlImportPersonalMemories(
    userDiscId: string,
    memories: MemoryItem[],
    personaLineageId = 0,
  ): Promise<ImportResult> {
    try {
      for (const memory of memories) {
        const validation = validateMemoryContent(memory.content);
        if (!validation.isValid) {
          return { success: false, error: `commands.data.import.error_invalid_memory|${validation.error}` };
        }
      }

      const targetUserId = await this.ensureUserId(userDiscId);
      if (!targetUserId) {
        return { success: false, error: "commands.data.import.error_update_failed" };
      }

      await sql`
        DELETE FROM personal_memories
        WHERE user_id = ${targetUserId}
          AND persona_lineage_id = ${personaLineageId}
      `;

      for (const memory of memories) {
        await sql`
          INSERT INTO personal_memories (user_id, persona_lineage_id, content, tags)
            VALUES (${targetUserId}, ${personaLineageId}, ${memory.content}, ${sql.array(memory.tags)})
        `;
      }

      return { success: true, itemsImported: { memoriesCount: memories.length } };
    } catch (error) {
      log.error(`Error importing personal memories for user ${userDiscId}:`, error);
      return { success: false, error: "commands.data.import.error_import_failed" };
    }
  }

  private async sqlImportPersonalSettings(
    userDiscId: string,
    importData: PersonalSettingsExportData,
  ): Promise<ImportResult> {
    try {
      // 1. Build the NAI char tags PostgreSQL array literal for safe insertion
      const naiCharTags = importData.nai_char_tags ?? [];
      const naiCharTagsArrayLiteral = `{${naiCharTags
        .map((tag: string) => `"${tag.replace(/(["\\])/g, "\\$1")}"`)
        .join(",")}}`;
      const naiCharRefUrl = importData.nai_char_ref_url ?? null;
      const impersonationPrompt = importData.impersonation_prompt ?? null;

      // 2. Upsert user row with settings, NovelAI character fields, and behavioral preferences
      const updateResult = await sql`
        INSERT INTO users (
          user_disc_id,
          user_nickname,
          language_pref,
          impersonation_prompt,
          nai_char_tags,
          nai_char_ref_url
        ) VALUES (
          ${userDiscId},
          ${importData.user_nickname},
          ${importData.language_pref},
          ${impersonationPrompt},
          ${naiCharTagsArrayLiteral}::text[],
          ${naiCharRefUrl}
        )
        ON CONFLICT (user_disc_id) DO UPDATE
        SET
          user_nickname = EXCLUDED.user_nickname,
          language_pref = EXCLUDED.language_pref,
          impersonation_prompt = EXCLUDED.impersonation_prompt,
          nai_char_tags = EXCLUDED.nai_char_tags,
          nai_char_ref_url = EXCLUDED.nai_char_ref_url,
          privacy_level = COALESCE(${importData.privacy_level ?? null}, users.privacy_level),
          personal_dtm = COALESCE(${importData.personal_dtm ?? null}, users.personal_dtm),
          shortterm_cache_crossserver_opt_in = COALESCE(${importData.shortterm_cache_crossserver_opt_in ?? null}, users.shortterm_cache_crossserver_opt_in)
        RETURNING user_id
      `;

      if (!updateResult.length) {
        return { success: false, error: "commands.data.import.error_update_failed" };
      }

      // 3. Count imported fields (base 2 + optional impersonation/NAI/behavioral fields)
      let fieldsCount = 2;
      if (impersonationPrompt) fieldsCount++;
      if (naiCharTags.length > 0) fieldsCount++;
      if (naiCharRefUrl) fieldsCount++;
      if (importData.privacy_level !== undefined) fieldsCount++;
      if (importData.personal_dtm !== undefined) fieldsCount++;
      if (importData.shortterm_cache_crossserver_opt_in !== undefined) fieldsCount++;

      return { success: true, itemsImported: { configFieldsCount: fieldsCount } };
    } catch (error) {
      log.error(`Error importing personal settings for user ${userDiscId}:`, error);
      return { success: false, error: "commands.data.import.error_import_failed" };
    }
  }

  private async sqlImportServerConfig(serverDiscId: string, config: ServerConfigExport): Promise<ImportResult> {
    try {
      const serverId = await this.resolveServerId(serverDiscId);
      if (!serverId) {
        return { success: false, error: "commands.data.import.error_no_server_data" };
      }

      const configFields = Object.keys(config);
      try {
        validateTomoriConfigFields(configFields);
      } catch (error) {
        log.error("Config field validation failed during import:", error);
        return { success: false, error: "commands.data.import.error_invalid_config" };
      }

      // llm_max_output_tokens uses conditional inclusion: only overwrite when explicitly present in the export.
      const hasMaxOutputTokens = Object.hasOwn(config, "llm_max_output_tokens");

      // 1. Partition imported fields into typed patch objects by split-table ownership.

      // server_model_configs: temperature, thinking level, disabled params
      const modelPatch = {
        llm_temperature: config.llm_temperature,
        thinking_level: config.thinking_level,
        llm_disabled_params: config.llm_disabled_params,
      };

      // server_chat_configs: LLM sampling params, humanizer, prompt, context, limits
      const chatPatch: Partial<ServerChatConfigRow> = {
        llm_top_p: config.llm_top_p,
        llm_top_k: config.llm_top_k,
        llm_frequency_penalty: config.llm_frequency_penalty,
        llm_presence_penalty: config.llm_presence_penalty,
        llm_min_p: config.llm_min_p,
        llm_logit_biases: config.llm_logit_biases,
        llm_stop_strings: config.llm_stop_strings,
        llm_stop_speaker_pattern_enabled: config.llm_stop_speaker_pattern_enabled ?? false,
        // HumanizerDegree is a numeric enum; number is safe at runtime
        humanizer_degree: config.humanizer_degree as ServerChatConfigRow["humanizer_degree"],
        timezone_offset: config.timezone_offset,
        message_fetch_limit: config.message_fetch_limit,
        system_prompt: config.system_prompt ?? null,
        self_debug_enabled: config.self_debug_enabled,
        ...(hasMaxOutputTokens && { llm_max_output_tokens: config.llm_max_output_tokens ?? null }),
        ...(config.context_note !== undefined && { context_note: config.context_note }),
        ...(config.context_note_depth !== undefined && { context_note_depth: config.context_note_depth }),
        ...(config.cascade_limit !== undefined && { cascade_limit: config.cascade_limit }),
        ...(config.match_limit !== undefined && { match_limit: config.match_limit }),
        ...(config.send_message_limit !== undefined && { send_message_limit: config.send_message_limit }),
      };

      // server_member_permissions_configs: teaching toggles, personal memories, snapshot
      const memberPermPatch = {
        server_memteaching_enabled: config.server_memteaching_enabled,
        attribute_memteaching_enabled: config.attribute_memteaching_enabled,
        sampledialogue_memteaching_enabled: config.sampledialogue_memteaching_enabled,
        self_teaching_enabled: config.self_teaching_enabled,
        personal_memories_enabled: config.personal_memories_enabled,
        ...(config.prompt_snapshot_enabled !== undefined && {
          prompt_snapshot_enabled: config.prompt_snapshot_enabled,
        }),
      };

      // server_capabilities_configs: feature toggles
      const capsPatch = {
        emoji_usage_enabled: config.emoji_usage_enabled,
        sticker_usage_enabled: config.sticker_usage_enabled,
        imagegen_enabled: config.imagegen_enabled,
        web_search_enabled: config.web_search_enabled,
        ...(config.manage_message_enabled !== undefined && { manage_message_enabled: config.manage_message_enabled }),
        ...(config.videogen_enabled !== undefined && { videogen_enabled: config.videogen_enabled }),
        ...(config.voice_message_enabled !== undefined && { voice_message_enabled: config.voice_message_enabled }),
        ...(config.thread_creation_enabled !== undefined && {
          thread_creation_enabled: config.thread_creation_enabled,
        }),
        ...(config.tool_use_enabled !== undefined && { tool_use_enabled: config.tool_use_enabled }),
      };

      // server_notice_embeds_configs: tool notice key suppressions
      // ToolNoticeKey union type is satisfied by the validated string values from the export schema.
      const noticeEmbedsPatch: Partial<ServerNoticeEmbedsConfigRow> = {
        tool_notice_hidden_keys:
          config.tool_notice_hidden_keys as ServerNoticeEmbedsConfigRow["tool_notice_hidden_keys"],
      };

      // 2. Dispatch the five always-present table writes in parallel.
      const requiredWriteResults = await Promise.all([
        configRepository.updateModelConfig(serverId, modelPatch),
        configRepository.updateChatConfig(serverId, chatPatch),
        configRepository.updateMemberPermissionsConfig(serverId, memberPermPatch),
        configRepository.updateCapabilitiesConfig(serverId, capsPatch),
        configRepository.updateNoticeEmbedsConfig(serverId, noticeEmbedsPatch),
      ]);

      // 3. Failure on any required config write means at least one split-table row failed to restore.
      if (requiredWriteResults.some((ok) => !ok)) {
        return { success: false, error: "commands.data.import.error_update_failed" };
      }

      // 4. Dispatch optional-field table writes in parallel; these are absent in older exports.
      const optionalWriteResults = await Promise.all([
        config.uncensor_injection_enabled !== undefined ||
        config.uncensor_unicode_space_enabled !== undefined ||
        config.uncensor_sanitize_enabled !== undefined
          ? configRepository.updateNsfwConfig(serverId, {
              ...(config.uncensor_injection_enabled !== undefined && {
                uncensor_injection_enabled: config.uncensor_injection_enabled,
              }),
              ...(config.uncensor_unicode_space_enabled !== undefined && {
                uncensor_unicode_space_enabled: config.uncensor_unicode_space_enabled,
              }),
              ...(config.uncensor_sanitize_enabled !== undefined && {
                uncensor_sanitize_enabled: config.uncensor_sanitize_enabled,
              }),
            })
          : Promise.resolve(true),

        config.voice_transcript_chat_mode !== undefined ||
        config.chatterbox_turbo_enabled !== undefined ||
        config.chatterbox_cfg_weight !== undefined ||
        config.chatterbox_exaggeration !== undefined
          ? configRepository.updateSpeechConfig(serverId, {
              ...(config.voice_transcript_chat_mode !== undefined && {
                voice_transcript_chat_mode: config.voice_transcript_chat_mode,
              }),
              ...(config.chatterbox_turbo_enabled !== undefined && {
                chatterbox_turbo_enabled: config.chatterbox_turbo_enabled,
              }),
              ...(config.chatterbox_cfg_weight !== undefined && {
                chatterbox_cfg_weight: config.chatterbox_cfg_weight,
              }),
              ...(config.chatterbox_exaggeration !== undefined && {
                chatterbox_exaggeration: config.chatterbox_exaggeration,
              }),
            })
          : Promise.resolve(true),

        config.always_reply_enabled !== undefined ||
        config.deliberate_trigger_mode !== undefined ||
        config.cooldown_type !== undefined ||
        config.cooldown_length !== undefined
          ? configRepository.updateTriggerBehaviorConfig(serverId, {
              ...(config.always_reply_enabled !== undefined && { always_reply_enabled: config.always_reply_enabled }),
              ...(config.deliberate_trigger_mode !== undefined && {
                deliberate_trigger_mode: config.deliberate_trigger_mode,
              }),
              ...(config.cooldown_type !== undefined && { cooldown_type: config.cooldown_type }),
              ...(config.cooldown_length !== undefined && { cooldown_length: config.cooldown_length }),
            })
          : Promise.resolve(true),

        config.stm_privacy_bypass !== undefined
          ? configRepository.updateChannelScopeConfig(serverId, { stm_privacy_bypass: config.stm_privacy_bypass })
          : Promise.resolve(true),

        config.nai_style_tags !== undefined ||
        config.nai_negative_tags !== undefined ||
        config.nai_sampler !== undefined ||
        config.nai_steps !== undefined ||
        config.nai_scale !== undefined ||
        config.nai_noise_schedule !== undefined ||
        config.nai_cfg_rescale !== undefined ||
        config.nai_preset_name !== undefined
          ? configRepository.updateNovelaiImagegenConfig(serverId, {
              ...(config.nai_style_tags !== undefined && { nai_style_tags: config.nai_style_tags }),
              ...(config.nai_negative_tags !== undefined && { nai_negative_tags: config.nai_negative_tags }),
              ...(config.nai_sampler !== undefined && { nai_sampler: config.nai_sampler }),
              ...(config.nai_steps !== undefined && { nai_steps: config.nai_steps }),
              ...(config.nai_scale !== undefined && { nai_scale: config.nai_scale }),
              ...(config.nai_noise_schedule !== undefined && { nai_noise_schedule: config.nai_noise_schedule }),
              ...(config.nai_cfg_rescale !== undefined && { nai_cfg_rescale: config.nai_cfg_rescale }),
              ...(config.nai_preset_name !== undefined && { nai_preset_name: config.nai_preset_name }),
            })
          : Promise.resolve(true),

        config.user_byok_mode !== undefined
          ? configRepository.updateByokConfig(serverId, { user_byok_mode: config.user_byok_mode })
          : Promise.resolve(true),

        config.memory_tagging_enabled !== undefined
          ? configRepository.updateMemoryConfig(serverId, { memory_tagging_enabled: config.memory_tagging_enabled })
          : Promise.resolve(true),

        config.welcome_prompt !== undefined
          ? configRepository.updateWelcomeConfig(serverId, { welcome_prompt: config.welcome_prompt })
          : Promise.resolve(true),
      ]);

      if (optionalWriteResults.some((ok) => !ok)) {
        return { success: false, error: "commands.data.import.error_update_failed" };
      }

      return { success: true, itemsImported: { configFieldsCount: configFields.length } };
    } catch (error) {
      log.error(`Error importing server config for server ${serverDiscId}:`, error);
      return { success: false, error: "commands.data.import.error_import_failed" };
    }
  }

  private async sqlImportServerMemories(
    serverDiscId: string,
    memories: MemoryItem[],
    target: { mode: "persona"; tomoriId?: number } | { mode: "global" },
  ): Promise<ImportResult> {
    try {
      const serverId = await this.resolveServerId(serverDiscId);
      if (!serverId) {
        return { success: false, error: "commands.data.import.error_no_server_data" };
      }

      for (const memory of memories) {
        const validation = validateMemoryContent(memory.content);
        if (!validation.isValid) {
          return { success: false, error: `commands.data.import.error_invalid_server_memory|${validation.error}` };
        }
      }

      let insertTomoriId: number | null = null;
      let targetPersonaLineageId: number | null = null;

      if (target.mode === "persona") {
        if (target.tomoriId) {
          const [targetPersona] = await sql<
            Array<{
              tomori_id: number;
              persona_lineage_id: number | string | bigint;
            }>
          >`
            SELECT tomori_id, persona_lineage_id
            FROM tomoris
            WHERE server_id = ${serverId}
              AND tomori_id = ${target.tomoriId}
            LIMIT 1
          `;
          if (!targetPersona) {
            return { success: false, error: "commands.data.import.error_no_server_data" };
          }
          insertTomoriId = targetPersona.tomori_id;
          targetPersonaLineageId = this.coerceLineageId(targetPersona.persona_lineage_id);
        } else {
          const mainScope = await this.resolveMainTomoriScope(serverId);
          insertTomoriId = mainScope?.tomoriId ?? null;
          targetPersonaLineageId = mainScope?.personaLineageId ?? null;
        }
      } else {
        // Global target maps to the current main persona lineage.
        const mainScope = await this.resolveMainTomoriScope(serverId);
        targetPersonaLineageId = mainScope?.personaLineageId ?? null;
        insertTomoriId = null;
      }

      if (typeof targetPersonaLineageId !== "number" || !Number.isFinite(targetPersonaLineageId)) {
        return { success: false, error: "commands.data.import.error_no_server_data" };
      }

      await sql`
        DELETE FROM server_memories
        WHERE server_id = ${serverId}
          AND persona_lineage_id = ${targetPersonaLineageId}
      `;

      if (memories.length === 0) {
        return { success: true, itemsImported: { memoriesCount: 0 } };
      }

      const userRows = await sql<Array<{ user_id: number }>>`
        SELECT u.user_id
        FROM users u
        LIMIT 1
      `;

      if (!userRows.length) {
        return { success: false, error: "commands.data.import.error_no_users" };
      }

      const userId = userRows[0].user_id;

      for (const memory of memories) {
        await sql`
          INSERT INTO server_memories (server_id, tomori_id, persona_lineage_id, user_id, content, tags)
          VALUES (${serverId}, ${insertTomoriId}, ${targetPersonaLineageId}, ${userId}, ${memory.content}, ${sql.array(memory.tags)})
        `;
      }

      return { success: true, itemsImported: { memoriesCount: memories.length } };
    } catch (error) {
      log.error(`Error importing server memories for server ${serverDiscId}:`, error);
      return { success: false, error: "commands.data.import.error_import_failed" };
    }
  }

  /**
   * Raw composite personal import — no cache invalidation.
   * Used internally by importPersonalData (which adds cache) and
   * fromExportShape (which intentionally skips cache for pipeline use).
   */
  private async sqlImportPersonalData(
    userDiscId: string,
    importData: PersonalExportData,
    personaLineageId = 0,
  ): Promise<ImportResult> {
    const settingsResult = await this.sqlImportPersonalSettings(userDiscId, {
      user_nickname: importData.user_nickname,
      language_pref: importData.language_pref,
      impersonation_prompt: importData.impersonation_prompt ?? null,
      nai_char_tags: [],
      nai_char_ref_url: null,
    });
    if (!settingsResult.success) return settingsResult;

    const memoriesResult = await this.sqlImportPersonalMemories(
      userDiscId,
      importData.personal_memories,
      personaLineageId,
    );
    if (!memoriesResult.success) return memoriesResult;

    return {
      success: true,
      itemsImported: {
        memoriesCount: memoriesResult.itemsImported?.memoriesCount ?? 0,
        configFieldsCount: settingsResult.itemsImported?.configFieldsCount ?? 0,
      },
    };
  }

  /**
   * Raw composite server import — no cache invalidation.
   * Used internally by importServerData (which adds cache).
   */
  private async sqlImportServerData(
    serverDiscId: string,
    importData: ServerExportData,
    tomoriId?: number,
  ): Promise<ImportResult> {
    const configResult = await this.sqlImportServerConfig(serverDiscId, importData.config);
    if (!configResult.success) return configResult;

    const memoriesResult = await this.sqlImportServerMemories(serverDiscId, importData.server_memories, {
      mode: "persona",
      tomoriId,
    });
    if (!memoriesResult.success) return memoriesResult;

    return {
      success: true,
      itemsImported: {
        memoriesCount: memoriesResult.itemsImported?.memoriesCount ?? 0,
        configFieldsCount: configResult.itemsImported?.configFieldsCount ?? 0,
      },
    };
  }

  // ── public import operations ───────────────────────────────────────────────

  /**
   * Imports personal memories for a user from an export payload.
   * @param userDiscId - Discord user snowflake
   * @param memories - Array of memory items to import
   * @param personaLineageId - Persona lineage namespace to import into (default 0)
   */
  async importPersonalMemories(
    userDiscId: string,
    memories: MemoryItem[],
    personaLineageId = 0,
  ): Promise<ImportResult> {
    const result = await this.sqlImportPersonalMemories(userDiscId, memories, personaLineageId);
    if (result.success) invalidateUserCache(userDiscId);
    return result;
  }

  /**
   * Imports personal settings for a user from an export payload.
   * @param userDiscId - Discord user snowflake
   * @param importData - PersonalSettingsExportData payload
   */
  async importPersonalSettings(userDiscId: string, importData: PersonalSettingsExportData): Promise<ImportResult> {
    const result = await this.sqlImportPersonalSettings(userDiscId, importData);
    if (result.success) invalidateUserCache(userDiscId);
    return result;
  }

  /**
   * Imports server configuration from an export payload.
   * @param serverDiscId - Discord server snowflake
   * @param config - ServerConfigExport payload
   */
  async importServerConfig(serverDiscId: string, config: ServerConfigExport): Promise<ImportResult> {
    const result = await this.sqlImportServerConfig(serverDiscId, config);
    if (result.success) invalidateTomoriStateCache(serverDiscId);
    return result;
  }

  /**
   * Imports server memories from an export payload.
   * @param serverDiscId - Discord server snowflake
   * @param memories - Array of memory items to import
   * @param target - Target scope: persona (with optional tomoriId) or global
   */
  async importServerMemories(
    serverDiscId: string,
    memories: MemoryItem[],
    target: { mode: "persona"; tomoriId?: number } | { mode: "global" },
  ): Promise<ImportResult> {
    const result = await this.sqlImportServerMemories(serverDiscId, memories, target);
    if (result.success) invalidateTomoriStateCache(serverDiscId);
    return result;
  }

  /**
   * Imports the full personal data bundle (settings + memories).
   * @param userDiscId - Discord user snowflake
   * @param importData - PersonalExportData payload
   * @param personaLineageId - Persona lineage namespace to import memories into (default 0)
   */
  async importPersonalData(
    userDiscId: string,
    importData: PersonalExportData,
    personaLineageId = 0,
  ): Promise<ImportResult> {
    const result = await this.sqlImportPersonalData(userDiscId, importData, personaLineageId);
    if (result.success) invalidateUserCache(userDiscId);
    return result;
  }

  /**
   * Imports the full server data bundle (config + memories).
   * @param serverDiscId - Discord server snowflake
   * @param importData - ServerExportData payload
   * @param tomoriId - Optional specific tomori ID to scope memories
   */
  async importServerData(serverDiscId: string, importData: ServerExportData, tomoriId?: number): Promise<ImportResult> {
    const result = await this.sqlImportServerData(serverDiscId, importData, tomoriId);
    if (result.success) invalidateTomoriStateCache(serverDiscId);
    return result;
  }

  /**
   * Validates a raw JSON import payload and returns the detected type + data.
   * @param jsonData - Raw JSON object from the uploaded import file
   */
  validateImportFile(jsonData: unknown): ImportValidationResult {
    if (typeof jsonData !== "object" || jsonData === null) {
      return { valid: false, error: "commands.data.import.error_not_json" };
    }

    const version = (jsonData as { version?: string }).version;
    if (version !== EXPORT_VERSION) {
      return {
        valid: false,
        error: `commands.data.import.error_incompatible_version|${EXPORT_VERSION}|${version || "unknown"}`,
      };
    }

    const type = (jsonData as { type?: string }).type;

    if (type === "personal_memories") {
      const validated = personalMemoriesExportSchema.safeParse(jsonData);
      if (!validated.success) {
        log.error("Personal memories import validation failed:", validated.error);
        return { valid: false, error: "commands.data.import.error_invalid_personal_memories_format" };
      }
      return { valid: true, type, data: validated.data.data };
    }

    if (type === "global_personal_memories") {
      const validated = globalPersonalMemoriesExportSchema.safeParse(jsonData);
      if (!validated.success) {
        log.error("Global personal memories import validation failed:", validated.error);
        return { valid: false, error: "commands.data.import.error_invalid_personal_memories_format" };
      }
      return { valid: true, type, data: validated.data.data };
    }

    if (type === "server_memories") {
      const validated = serverMemoriesExportSchema.safeParse(jsonData);
      if (!validated.success) {
        log.error("Server memories import validation failed:", validated.error);
        return { valid: false, error: "commands.data.import.error_invalid_server_memories_format" };
      }
      return { valid: true, type, data: validated.data.data };
    }

    if (type === "personal_settings") {
      const validated = personalSettingsExportSchema.safeParse(jsonData);
      if (!validated.success) {
        log.error("Personal settings import validation failed:", validated.error);
        return { valid: false, error: "commands.data.import.error_invalid_personal_settings_format" };
      }
      return { valid: true, type, data: validated.data.data };
    }

    if (type === "server_config") {
      const validated = serverConfigOnlyExportSchema.safeParse(jsonData);
      if (!validated.success) {
        log.error("Server config import validation failed:", validated.error);
        return { valid: false, error: "commands.data.import.error_invalid_server_config_format" };
      }
      return { valid: true, type, data: validated.data.data };
    }

    if (type === "personal") {
      const validated = getPersonalExportSchema().safeParse(jsonData);
      if (!validated.success) {
        log.error("Personal import validation failed:", validated.error);
        return { valid: false, error: "commands.data.import.error_invalid_personal_format" };
      }
      return { valid: true, type: "personal", data: validated.data.data };
    }

    if (type === "server") {
      const validated = getServerExportSchema().safeParse(jsonData);
      if (!validated.success) {
        log.error("Server import validation failed:", validated.error);
        return { valid: false, error: "commands.data.import.error_invalid_server_format" };
      }
      return { valid: true, type: "server", data: validated.data.data };
    }

    return { valid: false, error: `commands.data.import.error_unknown_type|${type}` };
  }

  // ── IRepository contract ───────────────────────────────────────────────────

  /**
   * Imports a previously exported personal data bundle (IRepository contract).
   * Intentionally bypasses cache invalidation — this is a pipeline/batch entry
   * point where the caller controls cache lifecycle.
   *
   * @param ownerId - Discord user snowflake
   * @param data    - Previously exported ExportResult from ExportRepository.toExportShape
   */
  async fromExportShape(ownerId: string | number, data: ExportResult): Promise<boolean> {
    if (!data.success || !data.data) return false;
    const envelope = data.data as { type?: string; data?: PersonalExportData };
    if (envelope.type !== "personal" || !envelope.data) return false;
    const result = await this.sqlImportPersonalData(String(ownerId), envelope.data);
    return result.success;
  }
}

/** Singleton instance — import this in callers. */
export const importRepository = new ImportRepository();
