import { sql } from "@/utils/db/client";
import { log } from "../misc/logger";
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
} from "../../types/db/dataExport";

/**
 * Sanitizes a string for safe JSON serialization
 * Removes control characters (except newlines and tabs) that could break JSON
 * @param content - The content to sanitize
 * @returns Object with sanitized content and flag indicating if sanitization occurred
 */
function sanitizeForJson(content: string): {
  sanitized: string;
  wasSanitized: boolean;
} {
  // 1. Remove null bytes and control characters except \n (0x0A) and \t (0x09)
  // Regex matches control chars (0x00-0x1F) except newline and tab
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentionally matching control characters for sanitization
  const cleaned = content.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, "");

  // 2. Check if sanitization occurred
  const wasSanitized = cleaned !== content;

  return { sanitized: cleaned, wasSanitized };
}

function sanitizeMemoryItems(items: MemoryItem[], contextLabel: string): MemoryItem[] {
  return items.map((item, index) => {
    const { sanitized, wasSanitized } = sanitizeForJson(item.content);
    if (wasSanitized) log.warn(`Sanitized ${contextLabel} at index ${index}: removed control characters`);
    return { content: sanitized, tags: item.tags };
  });
}

/**
 * Exports personal user data (nickname, language preference, impersonation prompt, memories)
 * @param userDiscId - Discord user ID to export data for
 * @param personaLineageId - Persona lineage namespace to export memories from
 * @param includeLegacyFallback - Include legacy lineage `0` memories during soak
 * @returns ExportResult containing the exported data or error
 */
export async function exportPersonalData(
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
      return {
        success: false,
        error: "commands.data.export.error_no_user_data",
      };
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
    const sanitizedMemories = sanitizeMemoryItems(rawPersonalMemories, "personal memories");

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
      return {
        success: false,
        error: "commands.data.export.error_validation_failed",
      };
    }

    return {
      success: true,
      data: validated.data,
    };
  } catch (error) {
    log.error(`Error exporting personal data for user ${userDiscId}:`, error);
    return {
      success: false,
      error: "commands.data.export.error_export_failed",
    };
  }
}

/**
 * Exports server data (configuration and server memories)
 * @param serverDiscId - Discord server ID to export data for
 * @param tomoriId - Optional persona ID to export persona-scoped server memories from
 * @returns ExportResult containing the exported data or error
 */
export async function exportServerData(serverDiscId: string, tomoriId?: number): Promise<ExportResult> {
  try {
    // 1. Get internal server ID
    const serverRows = await sql`
			SELECT server_id
			FROM servers
			WHERE server_disc_id = ${serverDiscId}
			LIMIT 1
		`;

    if (!serverRows.length) {
      return {
        success: false,
        error: "commands.data.export.error_no_server_data",
      };
    }

    const serverId = serverRows[0].server_id;

    // 2. Get tomori configuration
    const configRows = await sql`
			SELECT
				COALESCE(tc_server.llm_temperature, tc_legacy.llm_temperature) as llm_temperature,
				COALESCE(tc_server.llm_top_p, tc_legacy.llm_top_p, 0.95) as llm_top_p,
				COALESCE(tc_server.llm_top_k, tc_legacy.llm_top_k, 0) as llm_top_k,
				COALESCE(tc_server.llm_frequency_penalty, tc_legacy.llm_frequency_penalty, 0.0) as llm_frequency_penalty,
				COALESCE(tc_server.llm_presence_penalty, tc_legacy.llm_presence_penalty, 0.0) as llm_presence_penalty,
				COALESCE(tc_server.llm_min_p, tc_legacy.llm_min_p, 0.05) as llm_min_p,
				COALESCE(tc_server.llm_max_output_tokens, tc_legacy.llm_max_output_tokens) as llm_max_output_tokens,
				COALESCE(tc_server.llm_disabled_params, tc_legacy.llm_disabled_params, ARRAY[]::TEXT[]) as llm_disabled_params,
				COALESCE(tc_server.llm_logit_biases, tc_legacy.llm_logit_biases, '[]'::jsonb) as llm_logit_biases,
				COALESCE(tc_server.llm_stop_strings, tc_legacy.llm_stop_strings, ARRAY[]::TEXT[]) as llm_stop_strings,
				COALESCE(tc_server.llm_stop_speaker_pattern_enabled, tc_legacy.llm_stop_speaker_pattern_enabled, false) as llm_stop_speaker_pattern_enabled,
				COALESCE(tc_server.humanizer_degree, tc_legacy.humanizer_degree) as humanizer_degree,
				COALESCE(tc_server.thinking_level, tc_legacy.thinking_level, 'auto') as thinking_level,
				COALESCE(tc_server.timezone_offset, tc_legacy.timezone_offset) as timezone_offset,
				COALESCE(tc_server.message_fetch_limit, tc_legacy.message_fetch_limit, 80) as message_fetch_limit,
				COALESCE(tc_server.system_prompt, tc_legacy.system_prompt) as system_prompt,
				COALESCE(tc_server.server_memteaching_enabled, tc_legacy.server_memteaching_enabled) as server_memteaching_enabled,
				COALESCE(tc_server.attribute_memteaching_enabled, tc_legacy.attribute_memteaching_enabled) as attribute_memteaching_enabled,
				COALESCE(tc_server.sampledialogue_memteaching_enabled, tc_legacy.sampledialogue_memteaching_enabled) as sampledialogue_memteaching_enabled,
				COALESCE(tc_server.self_teaching_enabled, tc_legacy.self_teaching_enabled) as self_teaching_enabled,
				COALESCE(tc_server.web_search_enabled, tc_legacy.web_search_enabled) as web_search_enabled,
				COALESCE(tc_server.personal_memories_enabled, tc_legacy.personal_memories_enabled) as personal_memories_enabled,
				COALESCE(tc_server.emoji_usage_enabled, tc_legacy.emoji_usage_enabled) as emoji_usage_enabled,
				COALESCE(tc_server.sticker_usage_enabled, tc_legacy.sticker_usage_enabled) as sticker_usage_enabled,
				COALESCE(tc_server.imagegen_enabled, tc_legacy.imagegen_enabled) as imagegen_enabled,
				COALESCE(tc_server.tool_notice_hidden_keys, tc_legacy.tool_notice_hidden_keys, ARRAY[]::TEXT[]) as tool_notice_hidden_keys,
				COALESCE(tc_server.self_debug_enabled, tc_legacy.self_debug_enabled, false) as self_debug_enabled,
				COALESCE(tc_server.nai_style_tags, tc_legacy.nai_style_tags) as nai_style_tags,
				COALESCE(tc_server.nai_negative_tags, tc_legacy.nai_negative_tags) as nai_negative_tags,
				COALESCE(tc_server.nai_sampler, tc_legacy.nai_sampler) as nai_sampler,
				COALESCE(tc_server.nai_steps, tc_legacy.nai_steps) as nai_steps,
				COALESCE(tc_server.nai_scale, tc_legacy.nai_scale) as nai_scale,
				COALESCE(tc_server.nai_noise_schedule, tc_legacy.nai_noise_schedule) as nai_noise_schedule,
				COALESCE(tc_server.nai_cfg_rescale, tc_legacy.nai_cfg_rescale) as nai_cfg_rescale,
				COALESCE(tc_server.nai_exclusive_imggen, tc_legacy.nai_exclusive_imggen, false) as nai_exclusive_imggen,
				COALESCE(tc_server.nai_preset_name, tc_legacy.nai_preset_name) as nai_preset_name,
				COALESCE(tc_server.cascade_limit, tc_legacy.cascade_limit, 3) as cascade_limit,
				COALESCE(tc_server.match_limit, tc_legacy.match_limit, 3) as match_limit,
				COALESCE(tc_server.send_message_limit, tc_legacy.send_message_limit, 0) as send_message_limit,
				COALESCE(tc_server.always_reply_enabled, tc_legacy.always_reply_enabled, false) as always_reply_enabled,
				COALESCE(tc_server.deliberate_trigger_mode, tc_legacy.deliberate_trigger_mode, false) as deliberate_trigger_mode,
				COALESCE(tc_server.deliberate_tool_mode, tc_legacy.deliberate_tool_mode, false) as deliberate_tool_mode,
				COALESCE(tc_server.deliberate_tool_context_turns, tc_legacy.deliberate_tool_context_turns) as deliberate_tool_context_turns,
				COALESCE(tc_server.deliberate_tool_triggers, tc_legacy.deliberate_tool_triggers, '{}'::jsonb) as deliberate_tool_triggers,
				COALESCE(tc_server.cooldown_type, tc_legacy.cooldown_type, 0) as cooldown_type,
				COALESCE(tc_server.cooldown_length, tc_legacy.cooldown_length, 5) as cooldown_length,
				COALESCE(tc_server.stm_privacy_bypass, tc_legacy.stm_privacy_bypass, false) as stm_privacy_bypass,
				COALESCE(tc_server.user_byok_mode, tc_legacy.user_byok_mode, false) as user_byok_mode,
				COALESCE(tc_server.context_note, tc_legacy.context_note) as context_note,
				COALESCE(tc_server.context_note_depth, tc_legacy.context_note_depth, 0) as context_note_depth,
				COALESCE(tc_server.manage_message_enabled, tc_legacy.manage_message_enabled, true) as manage_message_enabled,
				COALESCE(tc_server.videogen_enabled, tc_legacy.videogen_enabled, false) as videogen_enabled,
				COALESCE(tc_server.voice_message_enabled, tc_legacy.voice_message_enabled, true) as voice_message_enabled,
				COALESCE(tc_server.thread_creation_enabled, tc_legacy.thread_creation_enabled, true) as thread_creation_enabled,
				COALESCE(tc_server.voice_transcript_chat_mode, tc_legacy.voice_transcript_chat_mode, true) as voice_transcript_chat_mode,
				COALESCE(tc_server.chatterbox_turbo_enabled, tc_legacy.chatterbox_turbo_enabled, true) as chatterbox_turbo_enabled,
				COALESCE(tc_server.chatterbox_cfg_weight, tc_legacy.chatterbox_cfg_weight, 0.5) as chatterbox_cfg_weight,
				COALESCE(tc_server.chatterbox_exaggeration, tc_legacy.chatterbox_exaggeration, 0.5) as chatterbox_exaggeration,
				COALESCE(tc_server.uncensor_injection_enabled, tc_legacy.uncensor_injection_enabled, false) as uncensor_injection_enabled,
				COALESCE(tc_server.uncensor_unicode_space_enabled, tc_legacy.uncensor_unicode_space_enabled, false) as uncensor_unicode_space_enabled,
				COALESCE(tc_server.uncensor_sanitize_enabled, tc_legacy.uncensor_sanitize_enabled, false) as uncensor_sanitize_enabled,
				COALESCE(tc_server.tool_use_enabled, tc_legacy.tool_use_enabled, true) as tool_use_enabled,
				COALESCE(tc_server.prompt_snapshot_enabled, tc_legacy.prompt_snapshot_enabled, false) as prompt_snapshot_enabled,
				COALESCE(tc_server.memory_tagging_enabled, tc_legacy.memory_tagging_enabled, false) as memory_tagging_enabled,
				COALESCE(tc_server.channel_memory_enabled, tc_legacy.channel_memory_enabled, false) as channel_memory_enabled
			FROM tomoris t
			LEFT JOIN tomori_configs tc_server ON tc_server.server_id = t.server_id
			LEFT JOIN tomori_configs tc_legacy ON tc_legacy.tomori_id = t.tomori_id
			WHERE t.server_id = ${serverId}
			AND t.is_alter = false
			LIMIT 1
		`;

    if (!configRows.length) {
      return {
        success: false,
        error: "commands.data.export.error_no_server_config",
      };
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
        return {
          success: false,
          error: "commands.data.export.error_no_server_data",
        };
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

    // 4. Get lineage-scoped server memories for the selected persona target.
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
    const sanitizedServerMemories = sanitizeMemoryItems(rawServerMemories, "server memories");

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
          nai_exclusive_imggen: configData.nai_exclusive_imggen ?? false,
          nai_preset_name: configData.nai_preset_name ?? null,
          cascade_limit: configData.cascade_limit,
          match_limit: configData.match_limit,
          send_message_limit: configData.send_message_limit,
          always_reply_enabled: configData.always_reply_enabled,
          deliberate_trigger_mode: configData.deliberate_trigger_mode,
          deliberate_tool_mode: configData.deliberate_tool_mode,
          deliberate_tool_context_turns: configData.deliberate_tool_context_turns ?? null,
          deliberate_tool_triggers: configData.deliberate_tool_triggers ?? {},
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
          channel_memory_enabled: configData.channel_memory_enabled,
        },
        server_memories: sanitizedServerMemories,
      },
    };

    // 7. Validate export data structure
    const validated = getServerExportSchema().safeParse(exportData);
    if (!validated.success) {
      log.error(`Server export validation failed for server ${serverDiscId}:`, validated.error);
      return {
        success: false,
        error: "commands.data.export.error_validation_failed",
      };
    }

    return {
      success: true,
      data: validated.data,
    };
  } catch (error) {
    log.error(`Error exporting server data for server ${serverDiscId}:`, error);
    return {
      success: false,
      error: "commands.data.export.error_export_failed",
    };
  }
}

/**
 * Exports persona-scoped personal memories only.
 * @param userDiscId - Discord user ID to export data for
 * @param personaLineageId - Persona lineage namespace to export memories from
 */
export async function exportPersonaPersonalMemories(
  userDiscId: string,
  personaLineageId: number,
): Promise<ExportResult> {
  const baseExport = await exportPersonalData(userDiscId, personaLineageId, false);
  if (!baseExport.success || !baseExport.data || baseExport.data.type !== "personal") {
    return {
      success: false,
      error: baseExport.error || "commands.data.export.error_export_failed",
    };
  }

  const exportData: PersonalMemoriesExport = {
    version: EXPORT_VERSION,
    type: "personal_memories",
    exported_at: baseExport.data.exported_at,
    data: {
      personal_memories: baseExport.data.data.personal_memories,
    },
  };

  const validated = personalMemoriesExportSchema.safeParse(exportData);
  if (!validated.success) {
    log.error(`Persona personal memories export validation failed for user ${userDiscId}:`, validated.error);
    return {
      success: false,
      error: "commands.data.export.error_validation_failed",
    };
  }

  return {
    success: true,
    data: validated.data,
  };
}

/**
 * Exports global personal memories only (lineage 0).
 * @param userDiscId - Discord user ID to export data for
 */
export async function exportGlobalPersonalMemories(userDiscId: string): Promise<ExportResult> {
  const baseExport = await exportPersonalData(userDiscId, 0, false);
  if (!baseExport.success || !baseExport.data || baseExport.data.type !== "personal") {
    return {
      success: false,
      error: baseExport.error || "commands.data.export.error_export_failed",
    };
  }

  const exportData: GlobalPersonalMemoriesExport = {
    version: EXPORT_VERSION,
    type: "global_personal_memories",
    exported_at: baseExport.data.exported_at,
    data: {
      personal_memories: baseExport.data.data.personal_memories,
    },
  };

  const validated = globalPersonalMemoriesExportSchema.safeParse(exportData);
  if (!validated.success) {
    log.error(`Global personal memories export validation failed for user ${userDiscId}:`, validated.error);
    return {
      success: false,
      error: "commands.data.export.error_validation_failed",
    };
  }

  return {
    success: true,
    data: validated.data,
  };
}

/**
 * Exports personal settings only (nickname, language, impersonation prompt, NovelAI character data).
 * @param userDiscId - Discord user ID to export data for
 */
export async function exportPersonalSettings(userDiscId: string): Promise<ExportResult> {
  try {
    // 1. Query user settings including NovelAI character fields and behavioral preferences
    const rows = await sql`
			SELECT user_nickname, language_pref, impersonation_prompt, nai_char_tags, nai_char_ref_url,
			       privacy_level, personal_dtm, personal_deliberate_tool_mode, shortterm_cache_crossserver_opt_in
			FROM users
			WHERE user_disc_id = ${userDiscId}
			LIMIT 1
		`;

    if (!rows.length) {
      return {
        success: false,
        error: "commands.data.export.error_no_user_data",
      };
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
        personal_deliberate_tool_mode: userData.personal_deliberate_tool_mode ?? undefined,
        shortterm_cache_crossserver_opt_in: userData.shortterm_cache_crossserver_opt_in ?? undefined,
      },
    };

    // 3. Validate export data structure
    const validated = personalSettingsExportSchema.safeParse(exportData);
    if (!validated.success) {
      log.error(`Personal settings export validation failed for user ${userDiscId}:`, validated.error);
      return {
        success: false,
        error: "commands.data.export.error_validation_failed",
      };
    }

    return {
      success: true,
      data: validated.data,
    };
  } catch (error) {
    log.error(`Error exporting personal settings for user ${userDiscId}:`, error);
    return {
      success: false,
      error: "commands.data.export.error_export_failed",
    };
  }
}

/**
 * Exports persona-scoped server memories only.
 * @param serverDiscId - Discord server ID to export data for
 * @param tomoriId - Persona ID to export memories from
 */
export async function exportPersonaServerMemories(serverDiscId: string, tomoriId: number): Promise<ExportResult> {
  const baseExport = await exportServerData(serverDiscId, tomoriId);
  if (!baseExport.success || !baseExport.data || baseExport.data.type !== "server") {
    return {
      success: false,
      error: baseExport.error || "commands.data.export.error_export_failed",
    };
  }

  const exportData: ServerMemoriesExport = {
    version: EXPORT_VERSION,
    type: "server_memories",
    exported_at: baseExport.data.exported_at,
    data: {
      server_memories: baseExport.data.data.server_memories,
    },
  };

  const validated = serverMemoriesExportSchema.safeParse(exportData);
  if (!validated.success) {
    log.error(`Persona server memories export validation failed for server ${serverDiscId}:`, validated.error);
    return {
      success: false,
      error: "commands.data.export.error_validation_failed",
    };
  }

  return {
    success: true,
    data: validated.data,
  };
}

/**
 * Exports server config only.
 * @param serverDiscId - Discord server ID to export data for
 */
export async function exportServerConfig(serverDiscId: string): Promise<ExportResult> {
  const baseExport = await exportServerData(serverDiscId);
  if (!baseExport.success || !baseExport.data || baseExport.data.type !== "server") {
    return {
      success: false,
      error: baseExport.error || "commands.data.export.error_export_failed",
    };
  }

  const exportData: ServerConfigOnlyExport = {
    version: EXPORT_VERSION,
    type: "server_config",
    exported_at: baseExport.data.exported_at,
    data: {
      config: baseExport.data.data.config,
    },
  };

  const validated = serverConfigOnlyExportSchema.safeParse(exportData);
  if (!validated.success) {
    log.error(`Server config export validation failed for server ${serverDiscId}:`, validated.error);
    return {
      success: false,
      error: "commands.data.export.error_validation_failed",
    };
  }

  return {
    success: true,
    data: validated.data,
  };
}

/**
 * Exports personality data as a human-readable text file
 * @param serverDiscId - Discord server ID to export personality for
 * @param tomoriId - Optional persona ID to export personality for
 * @returns PersonalityExportResult containing formatted text or error
 */
export async function exportPersonalityData(serverDiscId: string, tomoriId?: number): Promise<PersonalityExportResult> {
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
      return {
        success: false,
        error: "commands.data.export.error_no_personality_data",
      };
    }

    const personalityData = rows[0];

    // 2. Format personality data as human-readable text
    let textOutput = "";

    // Add header with personality name
    textOutput += `========================================\n`;
    textOutput += `TOMORI PERSONALITY EXPORT\n`;
    textOutput += `========================================\n\n`;
    textOutput += `Personality Name: ${personalityData.tomori_nickname}\n`;
    textOutput += `Exported: ${new Date().toISOString()}\n\n`;

    // Add attributes section
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

    // Add sample dialogues section
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

    // Add footer note
    textOutput += `========================================\n`;
    textOutput += `NOTE\n`;
    textOutput += `========================================\n\n`;
    textOutput += `This export is for informational purposes only.\n`;
    textOutput += `To import personalities, use the /persona commands.\n`;

    return {
      success: true,
      text: textOutput,
    };
  } catch (error) {
    log.error(`Error exporting personality data for server ${serverDiscId}:`, error);
    return {
      success: false,
      error: "commands.data.export.error_export_failed",
    };
  }
}
