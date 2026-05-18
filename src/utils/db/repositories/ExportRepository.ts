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
  type PersonalMemoriesExport,
  type GlobalPersonalMemoriesExport,
  type PersonalSettingsExport,
  type ServerMemoriesExport,
  type ServerConfigOnlyExport,
  type PersonalExport,
  type ServerExport,
  type ExportResult,
  type PersonalityExportResult,
  type MemoryItem,
} from "@/types/db/dataExport";

/**
 * ExportRepository — owns all data export operations.
 *
 * Handles personal and server data export, per-domain slice exports
 * (memories, settings, config, personality), JSON sanitization, and
 * schema validation. Export operations are read-only; no cache
 * invalidation is performed here.
 */
export class ExportRepository {
  // ── private helpers ─────────────────────────────────────────────────────────

  /**
   * Sanitizes a string for safe JSON serialization.
   * Removes control characters (except newlines and tabs) that could break JSON.
   * @param content - The content to sanitize
   * @returns Object with sanitized content and flag indicating if sanitization occurred
   */
  private sanitizeForJson(content: string): { sanitized: string; wasSanitized: boolean } {
    // 1. Remove null bytes and control characters except \n (0x0A) and \t (0x09)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentionally matching control characters for sanitization
    const cleaned = content.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, "");
    return { sanitized: cleaned, wasSanitized: cleaned !== content };
  }

  private sanitizeMemoryItems(items: MemoryItem[], contextLabel: string): MemoryItem[] {
    return items.map((item, index) => {
      const { sanitized, wasSanitized } = this.sanitizeForJson(item.content);
      if (wasSanitized) log.warn(`Sanitized ${contextLabel} at index ${index}: removed control characters`);
      return { content: sanitized, tags: item.tags };
    });
  }

  // ── export operations ───────────────────────────────────────────────────────

  /**
   * Exports personal user data (nickname, language preference, impersonation prompt, memories).
   * @param userDiscId - Discord user ID to export data for
   * @param personaLineageId - Persona lineage namespace to export memories from
   * @param includeGlobalMemories - Include lineage-0 memories when exporting a non-zero lineage
   * @returns ExportResult containing the exported data or error
   */
  async exportPersonalData(
    userDiscId: string,
    personaLineageId = 0,
    includeGlobalMemories = true,
  ): Promise<ExportResult> {
    try {
      // 1. Query user data from database (includes NovelAI character fields)
      const rows = await sql`
        SELECT user_id, user_nickname, language_pref, impersonation_prompt, nai_char_tags, nai_char_ref_url
        FROM users
        WHERE user_disc_id = ${userDiscId}
        LIMIT 1
      `;

      if (!rows.length) {
        return { success: false, error: "commands.data.export.error_no_user_data" };
      }

      const userData = rows[0];

      // 2. Load personal memories from lineage-scoped table
      const memoryRows =
        includeGlobalMemories && personaLineageId !== 0
          ? await sql`
              SELECT content, tags
              FROM personal_memories
              WHERE user_id = ${userData.user_id}
                AND (
                  persona_lineage_id = ${personaLineageId}
                  OR persona_lineage_id = 0
                )
              ORDER BY created_at DESC, personal_memory_id DESC
            `
          : await sql`
              SELECT content, tags
              FROM personal_memories
              WHERE user_id = ${userData.user_id}
                AND persona_lineage_id = ${personaLineageId}
              ORDER BY created_at DESC, personal_memory_id DESC
            `;

      const rawPersonalMemories: MemoryItem[] = memoryRows.map((row: { content: string; tags: string[] | null }) => ({
        content: row.content,
        tags: row.tags ?? [],
      }));

      // 3. Sanitize memories for safe JSON export
      const sanitizedMemories = this.sanitizeMemoryItems(rawPersonalMemories, "personal memories");

      // 4. Build export object
      const exportData: PersonalExport = {
        version: EXPORT_VERSION,
        type: "personal",
        exported_at: new Date().toISOString(),
        data: {
          user_nickname: userData.user_nickname,
          language_pref: userData.language_pref,
          impersonation_prompt: userData.impersonation_prompt ?? null,
          personal_memories: sanitizedMemories,
        },
      };

      // 5. Validate export data structure
      const validated = getPersonalExportSchema().safeParse(exportData);
      if (!validated.success) {
        log.error(`Personal export validation failed for user ${userDiscId}:`, validated.error);
        return { success: false, error: "commands.data.export.error_validation_failed" };
      }

      return { success: true, data: validated.data };
    } catch (error) {
      log.error(`Error exporting personal data for user ${userDiscId}:`, error);
      return { success: false, error: "commands.data.export.error_export_failed" };
    }
  }

  /**
   * Exports server data (configuration and server memories).
   * @param serverDiscId - Discord server ID to export data for
   * @param tomoriId - Optional persona ID to export persona-scoped server memories from
   * @returns ExportResult containing the exported data or error
   */
  async exportServerData(serverDiscId: string, tomoriId?: number): Promise<ExportResult> {
    try {
      // 1. Get internal server ID
      const serverRows = await sql`
        SELECT server_id
        FROM servers
        WHERE server_disc_id = ${serverDiscId}
        LIMIT 1
      `;

      if (!serverRows.length) {
        return { success: false, error: "commands.data.export.error_no_server_data" };
      }

      const serverId = serverRows[0].server_id;

      // 2. Get tomori configuration — 13 split-table LEFT JOINs + welcome (E6: replaces dual tomori_configs join).
      //    COALESCE defaults are belt-and-suspenders for the migration window (servers without a split row).
      const configRows = await sql`
        SELECT
          COALESCE(smc.llm_temperature, 1.0)                        AS llm_temperature,
          COALESCE(scc.llm_top_p, 0.95)                             AS llm_top_p,
          COALESCE(scc.llm_top_k, 0)                                AS llm_top_k,
          COALESCE(scc.llm_frequency_penalty, 0.0)                  AS llm_frequency_penalty,
          COALESCE(scc.llm_presence_penalty, 0.0)                   AS llm_presence_penalty,
          COALESCE(scc.llm_min_p, 0.05)                             AS llm_min_p,
          scc.llm_max_output_tokens                                  AS llm_max_output_tokens,
          COALESCE(smc.llm_disabled_params, ARRAY[]::TEXT[])        AS llm_disabled_params,
          COALESCE(scc.llm_logit_biases, '[]'::jsonb)               AS llm_logit_biases,
          COALESCE(scc.llm_stop_strings, ARRAY[]::TEXT[])           AS llm_stop_strings,
          COALESCE(scc.llm_stop_speaker_pattern_enabled, false)     AS llm_stop_speaker_pattern_enabled,
          COALESCE(scc.humanizer_degree, 1)                         AS humanizer_degree,
          COALESCE(smc.thinking_level, 'auto')                      AS thinking_level,
          COALESCE(scc.timezone_offset, 0)                          AS timezone_offset,
          COALESCE(scc.message_fetch_limit, 80)                     AS message_fetch_limit,
          scc.system_prompt                                          AS system_prompt,
          COALESCE(smpc.server_memteaching_enabled, true)           AS server_memteaching_enabled,
          COALESCE(smpc.attribute_memteaching_enabled, false)       AS attribute_memteaching_enabled,
          COALESCE(smpc.sampledialogue_memteaching_enabled, false)  AS sampledialogue_memteaching_enabled,
          COALESCE(smpc.self_teaching_enabled, true)                AS self_teaching_enabled,
          COALESCE(scac.web_search_enabled, true)                   AS web_search_enabled,
          COALESCE(smpc.personal_memories_enabled, true)            AS personal_memories_enabled,
          COALESCE(scac.emoji_usage_enabled, true)                  AS emoji_usage_enabled,
          COALESCE(scac.sticker_usage_enabled, true)                AS sticker_usage_enabled,
          COALESCE(scac.imagegen_enabled, true)                     AS imagegen_enabled,
          COALESCE(snec.tool_notice_hidden_keys, ARRAY[]::TEXT[])   AS tool_notice_hidden_keys,
          COALESCE(scc.self_debug_enabled, false)                   AS self_debug_enabled,
          snaic.nai_style_tags                                       AS nai_style_tags,
          snaic.nai_negative_tags                                    AS nai_negative_tags,
          snaic.nai_sampler                                          AS nai_sampler,
          snaic.nai_steps                                            AS nai_steps,
          snaic.nai_scale                                            AS nai_scale,
          snaic.nai_noise_schedule                                   AS nai_noise_schedule,
          snaic.nai_cfg_rescale                                      AS nai_cfg_rescale,
          snaic.nai_preset_name                                      AS nai_preset_name,
          COALESCE(scc.cascade_limit, 3)                            AS cascade_limit,
          COALESCE(scc.match_limit, 3)                              AS match_limit,
          COALESCE(scc.send_message_limit, 0)                       AS send_message_limit,
          COALESCE(stbc.always_reply_enabled, false)                AS always_reply_enabled,
          COALESCE(stbc.deliberate_trigger_mode, false)             AS deliberate_trigger_mode,
          COALESCE(stbc.cooldown_type, 0)                           AS cooldown_type,
          COALESCE(stbc.cooldown_length, 5)                         AS cooldown_length,
          COALESCE(scsc.stm_privacy_bypass, false)                  AS stm_privacy_bypass,
          COALESCE(sbc.user_byok_mode, false)                       AS user_byok_mode,
          scc.context_note                                           AS context_note,
          COALESCE(scc.context_note_depth, 0)                       AS context_note_depth,
          COALESCE(scac.manage_message_enabled, true)               AS manage_message_enabled,
          COALESCE(scac.videogen_enabled, false)                    AS videogen_enabled,
          COALESCE(scac.voice_message_enabled, true)                AS voice_message_enabled,
          COALESCE(scac.thread_creation_enabled, true)              AS thread_creation_enabled,
          COALESCE(ssc.voice_transcript_chat_mode, true)            AS voice_transcript_chat_mode,
          COALESCE(ssc.chatterbox_turbo_enabled, true)              AS chatterbox_turbo_enabled,
          COALESCE(ssc.chatterbox_cfg_weight, 0.5)                  AS chatterbox_cfg_weight,
          COALESCE(ssc.chatterbox_exaggeration, 0.5)                AS chatterbox_exaggeration,
          COALESCE(snc.uncensor_injection_enabled, false)           AS uncensor_injection_enabled,
          COALESCE(snc.uncensor_unicode_space_enabled, false)       AS uncensor_unicode_space_enabled,
          COALESCE(snc.uncensor_sanitize_enabled, false)            AS uncensor_sanitize_enabled,
          COALESCE(scac.tool_use_enabled, true)                     AS tool_use_enabled,
          COALESCE(smpc.prompt_snapshot_enabled, false)             AS prompt_snapshot_enabled,
          COALESCE(smemoc.memory_tagging_enabled, false)            AS memory_tagging_enabled,
          swc.welcome_prompt                                         AS welcome_prompt
        FROM tomoris t
        LEFT JOIN server_model_configs smc               ON smc.server_id   = t.server_id
        LEFT JOIN server_chat_configs scc                ON scc.server_id   = t.server_id
        LEFT JOIN server_member_permissions_configs smpc ON smpc.server_id  = t.server_id
        LEFT JOIN server_capabilities_configs scac       ON scac.server_id  = t.server_id
        LEFT JOIN server_notice_embeds_configs snec      ON snec.server_id  = t.server_id
        LEFT JOIN server_nsfw_configs snc                ON snc.server_id   = t.server_id
        LEFT JOIN server_speech_configs ssc              ON ssc.server_id   = t.server_id
        LEFT JOIN server_channel_scope_configs scsc      ON scsc.server_id  = t.server_id
        LEFT JOIN server_trigger_behavior_configs stbc   ON stbc.server_id  = t.server_id
        LEFT JOIN server_novelai_imagegen_configs snaic  ON snaic.server_id = t.server_id
        LEFT JOIN server_byok_configs sbc                ON sbc.server_id   = t.server_id
        LEFT JOIN server_memory_configs smemoc           ON smemoc.server_id = t.server_id
        LEFT JOIN server_welcome_configs swc             ON swc.server_id   = t.server_id
        WHERE t.server_id = ${serverId}
          AND t.is_alter = false
        LIMIT 1
      `;

      if (!configRows.length) {
        return { success: false, error: "commands.data.export.error_no_server_config" };
      }

      const configData = configRows[0];

      // 3. Resolve target persona/lineage for server memory export
      let targetTomoriId = tomoriId;
      let targetPersonaLineageId: number | null = null;
      if (!targetTomoriId) {
        const mainPersonaRows = await sql<
          Array<{
            tomori_id: number;
            persona_lineage_id: number | bigint | string;
          }>
        >`
          SELECT tomori_id, persona_lineage_id
          FROM tomoris
          WHERE server_id = ${serverId}
            AND is_alter = false
          ORDER BY updated_at DESC NULLS LAST, tomori_id DESC
          LIMIT 1
        `;
        targetTomoriId = mainPersonaRows[0]?.tomori_id;
        const rawMainLineageId = mainPersonaRows[0]?.persona_lineage_id;
        targetPersonaLineageId =
          typeof rawMainLineageId === "bigint"
            ? Number(rawMainLineageId)
            : typeof rawMainLineageId === "string"
              ? Number(rawMainLineageId)
              : (rawMainLineageId ?? null);
      } else {
        const [targetPersonaMeta] = await sql<Array<{ persona_lineage_id: number | bigint | string }>>`
          SELECT persona_lineage_id
          FROM tomoris
          WHERE tomori_id = ${targetTomoriId}
            AND server_id = ${serverId}
          LIMIT 1
        `;
        if (!targetPersonaMeta) {
          return { success: false, error: "commands.data.export.error_no_server_data" };
        }
        const rawLineageId = targetPersonaMeta?.persona_lineage_id;
        targetPersonaLineageId =
          typeof rawLineageId === "bigint"
            ? Number(rawLineageId)
            : typeof rawLineageId === "string"
              ? Number(rawLineageId)
              : (rawLineageId ?? null);
      }

      if (targetPersonaLineageId !== null && !Number.isFinite(targetPersonaLineageId)) {
        targetPersonaLineageId = null;
      }

      // 4. Get lineage-scoped server memories for the selected persona target
      const memoryRows =
        targetPersonaLineageId !== null
          ? await sql`
              SELECT content, tags
              FROM server_memories
              WHERE server_id = ${serverId}
                AND persona_lineage_id = ${targetPersonaLineageId}
              ORDER BY created_at DESC
            `
          : await sql`
              SELECT content, tags
              FROM server_memories
              WHERE server_id = ${serverId}
              ORDER BY created_at DESC
            `;

      const rawServerMemories: MemoryItem[] = memoryRows.map((row: { content: string; tags: string[] | null }) => ({
        content: row.content,
        tags: row.tags ?? [],
      }));

      // 5. Sanitize memories for safe JSON export
      const sanitizedServerMemories = this.sanitizeMemoryItems(rawServerMemories, "server memories");

      // 6. Build export object
      const exportData: ServerExport = {
        version: EXPORT_VERSION,
        type: "server",
        exported_at: new Date().toISOString(),
        data: {
          config: {
            llm_temperature: configData.llm_temperature,
            llm_top_p: configData.llm_top_p,
            llm_top_k: configData.llm_top_k,
            llm_frequency_penalty: configData.llm_frequency_penalty,
            llm_presence_penalty: configData.llm_presence_penalty,
            llm_min_p: configData.llm_min_p,
            llm_max_output_tokens: configData.llm_max_output_tokens ?? null,
            llm_disabled_params: configData.llm_disabled_params ?? [],
            llm_logit_biases: configData.llm_logit_biases ?? [],
            llm_stop_strings: configData.llm_stop_strings ?? [],
            llm_stop_speaker_pattern_enabled: configData.llm_stop_speaker_pattern_enabled ?? false,
            humanizer_degree: configData.humanizer_degree,
            thinking_level: configData.thinking_level,
            timezone_offset: configData.timezone_offset,
            message_fetch_limit: configData.message_fetch_limit,
            system_prompt: configData.system_prompt ?? null,
            server_memteaching_enabled: configData.server_memteaching_enabled,
            attribute_memteaching_enabled: configData.attribute_memteaching_enabled,
            sampledialogue_memteaching_enabled: configData.sampledialogue_memteaching_enabled,
            self_teaching_enabled: configData.self_teaching_enabled,
            web_search_enabled: configData.web_search_enabled,
            personal_memories_enabled: configData.personal_memories_enabled,
            emoji_usage_enabled: configData.emoji_usage_enabled,
            sticker_usage_enabled: configData.sticker_usage_enabled,
            imagegen_enabled: configData.imagegen_enabled,
            tool_notice_hidden_keys: configData.tool_notice_hidden_keys ?? [],
            self_debug_enabled: configData.self_debug_enabled,
            nai_style_tags: configData.nai_style_tags ?? undefined,
            nai_negative_tags: configData.nai_negative_tags ?? undefined,
            nai_sampler: configData.nai_sampler ?? null,
            nai_steps: configData.nai_steps ?? null,
            nai_scale: configData.nai_scale ?? null,
            nai_noise_schedule: configData.nai_noise_schedule ?? null,
            nai_cfg_rescale: configData.nai_cfg_rescale ?? null,
            nai_preset_name: configData.nai_preset_name ?? null,
            cascade_limit: configData.cascade_limit,
            match_limit: configData.match_limit,
            send_message_limit: configData.send_message_limit,
            always_reply_enabled: configData.always_reply_enabled,
            deliberate_trigger_mode: configData.deliberate_trigger_mode,
            cooldown_type: configData.cooldown_type,
            cooldown_length: configData.cooldown_length,
            stm_privacy_bypass: configData.stm_privacy_bypass,
            user_byok_mode: configData.user_byok_mode,
            context_note: configData.context_note ?? null,
            context_note_depth: configData.context_note_depth,
            manage_message_enabled: configData.manage_message_enabled,
            videogen_enabled: configData.videogen_enabled,
            voice_message_enabled: configData.voice_message_enabled,
            thread_creation_enabled: configData.thread_creation_enabled,
            voice_transcript_chat_mode: configData.voice_transcript_chat_mode,
            chatterbox_turbo_enabled: configData.chatterbox_turbo_enabled,
            chatterbox_cfg_weight: configData.chatterbox_cfg_weight,
            chatterbox_exaggeration: configData.chatterbox_exaggeration,
            uncensor_injection_enabled: configData.uncensor_injection_enabled,
            uncensor_unicode_space_enabled: configData.uncensor_unicode_space_enabled,
            uncensor_sanitize_enabled: configData.uncensor_sanitize_enabled,
            tool_use_enabled: configData.tool_use_enabled,
            prompt_snapshot_enabled: configData.prompt_snapshot_enabled,
            memory_tagging_enabled: configData.memory_tagging_enabled,
            welcome_prompt: configData.welcome_prompt ?? null,
          },
          server_memories: sanitizedServerMemories,
        },
      };

      // 7. Validate export data structure
      const validated = getServerExportSchema().safeParse(exportData);
      if (!validated.success) {
        log.error(`Server export validation failed for server ${serverDiscId}:`, validated.error);
        return { success: false, error: "commands.data.export.error_validation_failed" };
      }

      return { success: true, data: validated.data };
    } catch (error) {
      log.error(`Error exporting server data for server ${serverDiscId}:`, error);
      return { success: false, error: "commands.data.export.error_export_failed" };
    }
  }

  /**
   * Exports persona-scoped personal memories only.
   * @param userDiscId - Discord user ID to export data for
   * @param personaLineageId - Persona lineage namespace to export memories from
   */
  async exportPersonaPersonalMemories(userDiscId: string, personaLineageId: number): Promise<ExportResult> {
    const baseExport = await this.exportPersonalData(userDiscId, personaLineageId, false);
    if (!baseExport.success || !baseExport.data || baseExport.data.type !== "personal") {
      return { success: false, error: baseExport.error || "commands.data.export.error_export_failed" };
    }

    const exportData: PersonalMemoriesExport = {
      version: EXPORT_VERSION,
      type: "personal_memories",
      exported_at: baseExport.data.exported_at,
      data: { personal_memories: baseExport.data.data.personal_memories },
    };

    const validated = personalMemoriesExportSchema.safeParse(exportData);
    if (!validated.success) {
      log.error(`Persona personal memories export validation failed for user ${userDiscId}:`, validated.error);
      return { success: false, error: "commands.data.export.error_validation_failed" };
    }

    return { success: true, data: validated.data };
  }

  /**
   * Exports global personal memories only (lineage 0).
   * @param userDiscId - Discord user ID to export data for
   */
  async exportGlobalPersonalMemories(userDiscId: string): Promise<ExportResult> {
    const baseExport = await this.exportPersonalData(userDiscId, 0, false);
    if (!baseExport.success || !baseExport.data || baseExport.data.type !== "personal") {
      return { success: false, error: baseExport.error || "commands.data.export.error_export_failed" };
    }

    const exportData: GlobalPersonalMemoriesExport = {
      version: EXPORT_VERSION,
      type: "global_personal_memories",
      exported_at: baseExport.data.exported_at,
      data: { personal_memories: baseExport.data.data.personal_memories },
    };

    const validated = globalPersonalMemoriesExportSchema.safeParse(exportData);
    if (!validated.success) {
      log.error(`Global personal memories export validation failed for user ${userDiscId}:`, validated.error);
      return { success: false, error: "commands.data.export.error_validation_failed" };
    }

    return { success: true, data: validated.data };
  }

  /**
   * Exports personal settings only (nickname, language, impersonation prompt, NovelAI character data).
   * @param userDiscId - Discord user ID to export data for
   */
  async exportPersonalSettings(userDiscId: string): Promise<ExportResult> {
    try {
      // 1. Query user settings including NovelAI character fields and behavioral preferences
      const rows = await sql`
        SELECT user_nickname, language_pref, impersonation_prompt, nai_char_tags, nai_char_ref_url,
               privacy_level, personal_dtm, shortterm_cache_crossserver_opt_in
        FROM users
        WHERE user_disc_id = ${userDiscId}
        LIMIT 1
      `;

      if (!rows.length) {
        return { success: false, error: "commands.data.export.error_no_user_data" };
      }

      const userData = rows[0];

      // 2. Build export object with NAI character fields and behavioral preferences
      const exportData: PersonalSettingsExport = {
        version: EXPORT_VERSION,
        type: "personal_settings",
        exported_at: new Date().toISOString(),
        data: {
          user_nickname: userData.user_nickname,
          language_pref: userData.language_pref,
          impersonation_prompt: userData.impersonation_prompt ?? null,
          nai_char_tags: userData.nai_char_tags ?? [],
          nai_char_ref_url: userData.nai_char_ref_url ?? null,
          privacy_level: userData.privacy_level ?? undefined,
          personal_dtm: userData.personal_dtm ?? undefined,
          shortterm_cache_crossserver_opt_in: userData.shortterm_cache_crossserver_opt_in ?? undefined,
        },
      };

      // 3. Validate export data structure
      const validated = personalSettingsExportSchema.safeParse(exportData);
      if (!validated.success) {
        log.error(`Personal settings export validation failed for user ${userDiscId}:`, validated.error);
        return { success: false, error: "commands.data.export.error_validation_failed" };
      }

      return { success: true, data: validated.data };
    } catch (error) {
      log.error(`Error exporting personal settings for user ${userDiscId}:`, error);
      return { success: false, error: "commands.data.export.error_export_failed" };
    }
  }

  /**
   * Exports persona-scoped server memories only.
   * @param serverDiscId - Discord server ID to export data for
   * @param tomoriId - Persona ID to export memories from
   */
  async exportPersonaServerMemories(serverDiscId: string, tomoriId: number): Promise<ExportResult> {
    const baseExport = await this.exportServerData(serverDiscId, tomoriId);
    if (!baseExport.success || !baseExport.data || baseExport.data.type !== "server") {
      return { success: false, error: baseExport.error || "commands.data.export.error_export_failed" };
    }

    const exportData: ServerMemoriesExport = {
      version: EXPORT_VERSION,
      type: "server_memories",
      exported_at: baseExport.data.exported_at,
      data: { server_memories: baseExport.data.data.server_memories },
    };

    const validated = serverMemoriesExportSchema.safeParse(exportData);
    if (!validated.success) {
      log.error(`Persona server memories export validation failed for server ${serverDiscId}:`, validated.error);
      return { success: false, error: "commands.data.export.error_validation_failed" };
    }

    return { success: true, data: validated.data };
  }

  /**
   * Exports server config only.
   * @param serverDiscId - Discord server ID to export data for
   */
  async exportServerConfig(serverDiscId: string): Promise<ExportResult> {
    const baseExport = await this.exportServerData(serverDiscId);
    if (!baseExport.success || !baseExport.data || baseExport.data.type !== "server") {
      return { success: false, error: baseExport.error || "commands.data.export.error_export_failed" };
    }

    const exportData: ServerConfigOnlyExport = {
      version: EXPORT_VERSION,
      type: "server_config",
      exported_at: baseExport.data.exported_at,
      data: { config: baseExport.data.data.config },
    };

    const validated = serverConfigOnlyExportSchema.safeParse(exportData);
    if (!validated.success) {
      log.error(`Server config export validation failed for server ${serverDiscId}:`, validated.error);
      return { success: false, error: "commands.data.export.error_validation_failed" };
    }

    return { success: true, data: validated.data };
  }

  /**
   * Exports personality data as a human-readable text file.
   * @param serverDiscId - Discord server ID to export personality for
   * @param tomoriId - Optional persona ID to export personality for
   * @returns PersonalityExportResult containing formatted text or error
   */
  async exportPersonalityData(serverDiscId: string, tomoriId?: number): Promise<PersonalityExportResult> {
    try {
      // 1. Get persona data (selected persona or default main persona)
      const rows =
        typeof tomoriId === "number"
          ? await sql`
              SELECT
                t.tomori_nickname,
                t.attribute_list,
                t.sample_dialogues_in,
                t.sample_dialogues_out
              FROM tomoris t
              JOIN servers s ON t.server_id = s.server_id
              WHERE s.server_disc_id = ${serverDiscId}
                AND t.tomori_id = ${tomoriId}
              LIMIT 1
            `
          : await sql`
              SELECT
                t.tomori_nickname,
                t.attribute_list,
                t.sample_dialogues_in,
                t.sample_dialogues_out
              FROM tomoris t
              JOIN servers s ON t.server_id = s.server_id
              WHERE s.server_disc_id = ${serverDiscId}
                AND t.is_alter = false
              LIMIT 1
            `;

      if (!rows.length) {
        return { success: false, error: "commands.data.export.error_no_personality_data" };
      }

      const personalityData = rows[0];

      // 2. Format personality data as human-readable text
      let textOutput = "";

      textOutput += `========================================\n`;
      textOutput += `TOMORI PERSONALITY EXPORT\n`;
      textOutput += `========================================\n\n`;
      textOutput += `Personality Name: ${personalityData.tomori_nickname}\n`;
      textOutput += `Exported: ${new Date().toISOString()}\n\n`;

      textOutput += `========================================\n`;
      textOutput += `ATTRIBUTES\n`;
      textOutput += `========================================\n\n`;

      const attributes = personalityData.attribute_list || [];
      if (attributes.length > 0) {
        attributes.forEach((attr: string, index: number) => {
          textOutput += `${index + 1}. ${attr}\n`;
        });
      } else {
        textOutput += `No attributes defined.\n`;
      }

      textOutput += `\n`;

      textOutput += `========================================\n`;
      textOutput += `SAMPLE DIALOGUES\n`;
      textOutput += `========================================\n\n`;

      const dialoguesIn = personalityData.sample_dialogues_in || [];
      const dialoguesOut = personalityData.sample_dialogues_out || [];

      if (dialoguesIn.length > 0 && dialoguesOut.length > 0) {
        const maxLength = Math.max(dialoguesIn.length, dialoguesOut.length);
        for (let i = 0; i < maxLength; i++) {
          textOutput += `--- Dialogue ${i + 1} ---\n`;
          textOutput += `User: ${dialoguesIn[i] || "(none)"}\n`;
          textOutput += `Tomori: ${dialoguesOut[i] || "(none)"}\n\n`;
        }
      } else {
        textOutput += `No sample dialogues defined.\n\n`;
      }

      textOutput += `========================================\n`;
      textOutput += `NOTE\n`;
      textOutput += `========================================\n\n`;
      textOutput += `This export is for informational purposes only.\n`;
      textOutput += `To import personalities, use the /persona commands.\n`;

      return { success: true, text: textOutput };
    } catch (error) {
      log.error(`Error exporting personality data for server ${serverDiscId}:`, error);
      return { success: false, error: "commands.data.export.error_export_failed" };
    }
  }

  // ── IRepository contract ───────────────────────────────────────────────────

  /**
   * Exports a user's full personal data bundle (IRepository contract).
   * The ownerId is the Discord snowflake of the user.
   * @param ownerId - Discord user snowflake
   */
  async toExportShape(ownerId: string | number): Promise<ExportResult | null> {
    const result = await this.exportPersonalData(String(ownerId));
    return result.success ? result : null;
  }
}

/** Singleton instance — import this in callers. */
export const exportRepository = new ExportRepository();
