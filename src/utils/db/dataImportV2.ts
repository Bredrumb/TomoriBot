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
  type PersonalExportData,
  type ServerExportData,
  type PersonalMemoriesExportData,
  type ServerMemoriesExportData,
  type PersonalSettingsExportData,
  type ServerConfigExport,
  type ImportResult,
  type MemoryItem,
} from "../../types/db/dataExport";
import { validateMemoryContent } from "./memoryLimits";
import { validateTomoriConfigFields } from "./sqlSecurity";
import { invalidateUserCache } from "../cache/userCache";

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

async function ensureUserId(userDiscId: string): Promise<number | null> {
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

async function resolveServerId(serverDiscId: string): Promise<number | null> {
  const serverRows = await sql<Array<{ server_id: number }>>`
		SELECT s.server_id
		FROM servers s
		WHERE s.server_disc_id = ${serverDiscId}
		LIMIT 1
	`;
  return serverRows[0]?.server_id ?? null;
}

async function resolveMainTomoriId(serverId: number): Promise<number | undefined> {
  const mainPersonaRows = await sql<Array<{ tomori_id: number }>>`
		SELECT tomori_id
		FROM tomoris
		WHERE server_id = ${serverId}
		  AND is_alter = false
		ORDER BY updated_at DESC NULLS LAST, tomori_id DESC
		LIMIT 1
	`;
  return mainPersonaRows[0]?.tomori_id;
}

function coerceLineageId(value: number | string | bigint | null | undefined): number | null {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    return Number(value);
  }
  if (typeof value === "number") {
    return value;
  }
  return null;
}

async function resolveMainTomoriScope(
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
  if (!mainTomori) {
    return null;
  }

  const personaLineageId = coerceLineageId(mainTomori.persona_lineage_id);
  if (typeof personaLineageId !== "number" || !Number.isFinite(personaLineageId)) {
    return null;
  }

  return {
    tomoriId: mainTomori.tomori_id,
    personaLineageId,
  };
}

export async function importPersonalMemories(
  userDiscId: string,
  memories: MemoryItem[],
  personaLineageId = 0,
): Promise<ImportResult> {
  try {
    for (const memory of memories) {
      const validation = validateMemoryContent(memory.content);
      if (!validation.isValid) {
        return {
          success: false,
          error: `commands.data.import.error_invalid_memory|${validation.error}`,
        };
      }
    }

    const targetUserId = await ensureUserId(userDiscId);
    if (!targetUserId) {
      return {
        success: false,
        error: "commands.data.import.error_update_failed",
      };
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

    return {
      success: true,
      itemsImported: {
        memoriesCount: memories.length,
      },
    };
  } catch (error) {
    log.error(`Error importing personal memories for user ${userDiscId}:`, error);
    return {
      success: false,
      error: "commands.data.import.error_import_failed",
    };
  }
}

export async function importPersonalSettings(
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
				nai_char_ref_url,
				personal_deliberate_tool_mode
			) VALUES (
				${userDiscId},
				${importData.user_nickname},
				${importData.language_pref},
				${impersonationPrompt},
				${naiCharTagsArrayLiteral}::text[],
				${naiCharRefUrl},
				${importData.personal_deliberate_tool_mode ?? "follow"}
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
				personal_deliberate_tool_mode = COALESCE(${importData.personal_deliberate_tool_mode ?? null}, users.personal_deliberate_tool_mode),
				shortterm_cache_crossserver_opt_in = COALESCE(${importData.shortterm_cache_crossserver_opt_in ?? null}, users.shortterm_cache_crossserver_opt_in)
			RETURNING user_id
		`;

    if (!updateResult.length) {
      return {
        success: false,
        error: "commands.data.import.error_update_failed",
      };
    }

    invalidateUserCache(userDiscId);

    // 3. Count imported fields (base 2 + optional impersonation/NAI/behavioral fields)
    let fieldsCount = 2;
    if (impersonationPrompt) fieldsCount++;
    if (naiCharTags.length > 0) fieldsCount++;
    if (naiCharRefUrl) fieldsCount++;
    if (importData.privacy_level !== undefined) fieldsCount++;
    if (importData.personal_dtm !== undefined) fieldsCount++;
    if (importData.personal_deliberate_tool_mode !== undefined) fieldsCount++;
    if (importData.shortterm_cache_crossserver_opt_in !== undefined) fieldsCount++;

    return {
      success: true,
      itemsImported: {
        configFieldsCount: fieldsCount,
      },
    };
  } catch (error) {
    log.error(`Error importing personal settings for user ${userDiscId}:`, error);
    return {
      success: false,
      error: "commands.data.import.error_import_failed",
    };
  }
}

export async function importServerConfig(serverDiscId: string, config: ServerConfigExport): Promise<ImportResult> {
  try {
    const serverId = await resolveServerId(serverDiscId);
    if (!serverId) {
      return {
        success: false,
        error: "commands.data.import.error_no_server_data",
      };
    }

    const configFields = Object.keys(config);
    try {
      validateTomoriConfigFields(configFields);
    } catch (error) {
      log.error("Config field validation failed during import:", error);
      return {
        success: false,
        error: "commands.data.import.error_invalid_config",
      };
    }

    // Build NAI tag array literals for safe insertion
    const naiStyleTagsLiteral = config.nai_style_tags
      ? `{${config.nai_style_tags.map((tag: string) => `"${tag.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`
      : null;
    const naiNegativeTagsLiteral = config.nai_negative_tags
      ? `{${config.nai_negative_tags.map((tag: string) => `"${tag.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`
      : null;
    const toolNoticeHiddenKeysLiteral = config.tool_notice_hidden_keys
      ? `{${config.tool_notice_hidden_keys.map((key: string) => `"${key.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`
      : null;
    const disabledParamsLiteral = config.llm_disabled_params
      ? `{${config.llm_disabled_params.map((param: string) => `"${param.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`
      : null;
    const stopStringsLiteral = config.llm_stop_strings
      ? `{${config.llm_stop_strings.map((stop: string) => `"${stop.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`
      : null;
    const logitBiasesJson = JSON.stringify(config.llm_logit_biases ?? []);
    const deliberateToolTriggersJson =
      config.deliberate_tool_triggers === undefined ? null : JSON.stringify(config.deliberate_tool_triggers ?? {});
    const hasMaxOutputTokens = Object.hasOwn(config, "llm_max_output_tokens");

    let updateRows = await sql<Array<{ tomori_config_id: number }>>`
			UPDATE tomori_configs
			SET
				llm_temperature = ${config.llm_temperature},
				llm_top_p = ${config.llm_top_p},
				llm_top_k = ${config.llm_top_k},
				llm_frequency_penalty = ${config.llm_frequency_penalty},
				llm_presence_penalty = ${config.llm_presence_penalty},
				llm_min_p = ${config.llm_min_p},
				llm_max_output_tokens = CASE
					WHEN ${hasMaxOutputTokens} THEN ${config.llm_max_output_tokens ?? null}
					ELSE llm_max_output_tokens
				END,
				llm_disabled_params = COALESCE(${disabledParamsLiteral}::text[], llm_disabled_params, ARRAY[]::text[]),
				llm_logit_biases = ${logitBiasesJson}::jsonb,
				llm_stop_strings = COALESCE(${stopStringsLiteral}::text[], llm_stop_strings, ARRAY[]::text[]),
				llm_stop_speaker_pattern_enabled = COALESCE(${config.llm_stop_speaker_pattern_enabled ?? null}, llm_stop_speaker_pattern_enabled, false),
				humanizer_degree = ${config.humanizer_degree},
				thinking_level = ${config.thinking_level},
				timezone_offset = ${config.timezone_offset},
				message_fetch_limit = ${config.message_fetch_limit},
				system_prompt = ${config.system_prompt ?? null},
				server_memteaching_enabled = ${config.server_memteaching_enabled},
				attribute_memteaching_enabled = ${config.attribute_memteaching_enabled},
				sampledialogue_memteaching_enabled = ${config.sampledialogue_memteaching_enabled},
				self_teaching_enabled = ${config.self_teaching_enabled},
				web_search_enabled = ${config.web_search_enabled},
				personal_memories_enabled = ${config.personal_memories_enabled},
				emoji_usage_enabled = ${config.emoji_usage_enabled},
				sticker_usage_enabled = ${config.sticker_usage_enabled},
				imagegen_enabled = ${config.imagegen_enabled},
				tool_notice_hidden_keys = COALESCE(${toolNoticeHiddenKeysLiteral}::text[], tool_notice_hidden_keys, ARRAY[]::text[]),
				self_debug_enabled = ${config.self_debug_enabled},
				nai_style_tags = COALESCE(${naiStyleTagsLiteral}::text[], nai_style_tags),
				nai_negative_tags = COALESCE(${naiNegativeTagsLiteral}::text[], nai_negative_tags),
				nai_sampler = COALESCE(${config.nai_sampler ?? null}, nai_sampler),
				nai_steps = COALESCE(${config.nai_steps ?? null}, nai_steps),
				nai_scale = COALESCE(${config.nai_scale ?? null}, nai_scale),
				nai_noise_schedule = COALESCE(${config.nai_noise_schedule ?? null}, nai_noise_schedule),
				nai_cfg_rescale = COALESCE(${config.nai_cfg_rescale ?? null}, nai_cfg_rescale),
				nai_exclusive_imggen = ${config.nai_exclusive_imggen ?? false},
				nai_preset_name = COALESCE(${config.nai_preset_name ?? null}, nai_preset_name),
				cascade_limit = COALESCE(${config.cascade_limit ?? null}, cascade_limit),
				match_limit = COALESCE(${config.match_limit ?? null}, match_limit),
				send_message_limit = COALESCE(${config.send_message_limit ?? null}, send_message_limit),
				always_reply_enabled = COALESCE(${config.always_reply_enabled ?? null}, always_reply_enabled),
				deliberate_trigger_mode = COALESCE(${config.deliberate_trigger_mode ?? null}, deliberate_trigger_mode),
				deliberate_tool_mode = COALESCE(${config.deliberate_tool_mode ?? null}, deliberate_tool_mode),
				deliberate_tool_context_turns = COALESCE(${config.deliberate_tool_context_turns ?? null}, deliberate_tool_context_turns),
				deliberate_tool_triggers = COALESCE(${deliberateToolTriggersJson}::jsonb, deliberate_tool_triggers, '{}'::jsonb),
				cooldown_type = COALESCE(${config.cooldown_type ?? null}, cooldown_type),
				cooldown_length = COALESCE(${config.cooldown_length ?? null}, cooldown_length),
				stm_privacy_bypass = COALESCE(${config.stm_privacy_bypass ?? null}, stm_privacy_bypass),
				user_byok_mode = COALESCE(${config.user_byok_mode ?? null}, user_byok_mode),
				context_note = COALESCE(${config.context_note ?? null}, context_note),
				context_note_depth = COALESCE(${config.context_note_depth ?? null}, context_note_depth),
				manage_message_enabled = COALESCE(${config.manage_message_enabled ?? null}, manage_message_enabled),
				videogen_enabled = COALESCE(${config.videogen_enabled ?? null}, videogen_enabled),
				voice_message_enabled = COALESCE(${config.voice_message_enabled ?? null}, voice_message_enabled),
				thread_creation_enabled = COALESCE(${config.thread_creation_enabled ?? null}, thread_creation_enabled),
				voice_transcript_chat_mode = COALESCE(${config.voice_transcript_chat_mode ?? null}, voice_transcript_chat_mode),
				chatterbox_turbo_enabled = COALESCE(${config.chatterbox_turbo_enabled ?? null}, chatterbox_turbo_enabled),
				chatterbox_cfg_weight = COALESCE(${config.chatterbox_cfg_weight ?? null}, chatterbox_cfg_weight),
				chatterbox_exaggeration = COALESCE(${config.chatterbox_exaggeration ?? null}, chatterbox_exaggeration),
				uncensor_injection_enabled = COALESCE(${config.uncensor_injection_enabled ?? null}, uncensor_injection_enabled),
				uncensor_unicode_space_enabled = COALESCE(${config.uncensor_unicode_space_enabled ?? null}, uncensor_unicode_space_enabled),
				uncensor_sanitize_enabled = COALESCE(${config.uncensor_sanitize_enabled ?? null}, uncensor_sanitize_enabled),
				tool_use_enabled = COALESCE(${config.tool_use_enabled ?? null}, tool_use_enabled),
				prompt_snapshot_enabled = COALESCE(${config.prompt_snapshot_enabled ?? null}, prompt_snapshot_enabled),
				memory_tagging_enabled = COALESCE(${config.memory_tagging_enabled ?? null}, memory_tagging_enabled),
				channel_memory_enabled = COALESCE(${config.channel_memory_enabled ?? null}, channel_memory_enabled)
			WHERE server_id = ${serverId}
			RETURNING tomori_config_id
		`;

    if (!updateRows.length) {
      const mainTomoriId = await resolveMainTomoriId(serverId);
      if (mainTomoriId) {
        updateRows = await sql<Array<{ tomori_config_id: number }>>`
					UPDATE tomori_configs
					SET
						llm_temperature = ${config.llm_temperature},
						llm_top_p = ${config.llm_top_p},
						llm_top_k = ${config.llm_top_k},
						llm_frequency_penalty = ${config.llm_frequency_penalty},
						llm_presence_penalty = ${config.llm_presence_penalty},
						llm_min_p = ${config.llm_min_p},
						llm_max_output_tokens = CASE
							WHEN ${hasMaxOutputTokens} THEN ${config.llm_max_output_tokens ?? null}
							ELSE llm_max_output_tokens
						END,
						llm_disabled_params = COALESCE(${disabledParamsLiteral}::text[], llm_disabled_params, ARRAY[]::text[]),
						llm_logit_biases = ${logitBiasesJson}::jsonb,
						llm_stop_strings = COALESCE(${stopStringsLiteral}::text[], llm_stop_strings, ARRAY[]::text[]),
						llm_stop_speaker_pattern_enabled = COALESCE(${config.llm_stop_speaker_pattern_enabled ?? null}, llm_stop_speaker_pattern_enabled, false),
						humanizer_degree = ${config.humanizer_degree},
						thinking_level = ${config.thinking_level},
						timezone_offset = ${config.timezone_offset},
						message_fetch_limit = ${config.message_fetch_limit},
						system_prompt = ${config.system_prompt ?? null},
						server_memteaching_enabled = ${config.server_memteaching_enabled},
						attribute_memteaching_enabled = ${config.attribute_memteaching_enabled},
						sampledialogue_memteaching_enabled = ${config.sampledialogue_memteaching_enabled},
						self_teaching_enabled = ${config.self_teaching_enabled},
						web_search_enabled = ${config.web_search_enabled},
						personal_memories_enabled = ${config.personal_memories_enabled},
						emoji_usage_enabled = ${config.emoji_usage_enabled},
						sticker_usage_enabled = ${config.sticker_usage_enabled},
						imagegen_enabled = ${config.imagegen_enabled},
						tool_notice_hidden_keys = COALESCE(${toolNoticeHiddenKeysLiteral}::text[], tool_notice_hidden_keys, ARRAY[]::text[]),
						self_debug_enabled = ${config.self_debug_enabled},
						nai_style_tags = COALESCE(${naiStyleTagsLiteral}::text[], nai_style_tags),
						nai_negative_tags = COALESCE(${naiNegativeTagsLiteral}::text[], nai_negative_tags),
						nai_sampler = COALESCE(${config.nai_sampler ?? null}, nai_sampler),
						nai_steps = COALESCE(${config.nai_steps ?? null}, nai_steps),
						nai_scale = COALESCE(${config.nai_scale ?? null}, nai_scale),
						nai_noise_schedule = COALESCE(${config.nai_noise_schedule ?? null}, nai_noise_schedule),
						nai_cfg_rescale = COALESCE(${config.nai_cfg_rescale ?? null}, nai_cfg_rescale),
						nai_exclusive_imggen = ${config.nai_exclusive_imggen ?? false},
						nai_preset_name = COALESCE(${config.nai_preset_name ?? null}, nai_preset_name),
						cascade_limit = COALESCE(${config.cascade_limit ?? null}, cascade_limit),
						match_limit = COALESCE(${config.match_limit ?? null}, match_limit),
						send_message_limit = COALESCE(${config.send_message_limit ?? null}, send_message_limit),
						always_reply_enabled = COALESCE(${config.always_reply_enabled ?? null}, always_reply_enabled),
						deliberate_trigger_mode = COALESCE(${config.deliberate_trigger_mode ?? null}, deliberate_trigger_mode),
						deliberate_tool_mode = COALESCE(${config.deliberate_tool_mode ?? null}, deliberate_tool_mode),
						deliberate_tool_context_turns = COALESCE(${config.deliberate_tool_context_turns ?? null}, deliberate_tool_context_turns),
						deliberate_tool_triggers = COALESCE(${deliberateToolTriggersJson}::jsonb, deliberate_tool_triggers, '{}'::jsonb),
						cooldown_type = COALESCE(${config.cooldown_type ?? null}, cooldown_type),
						cooldown_length = COALESCE(${config.cooldown_length ?? null}, cooldown_length),
						stm_privacy_bypass = COALESCE(${config.stm_privacy_bypass ?? null}, stm_privacy_bypass),
						user_byok_mode = COALESCE(${config.user_byok_mode ?? null}, user_byok_mode),
						context_note = COALESCE(${config.context_note ?? null}, context_note),
						context_note_depth = COALESCE(${config.context_note_depth ?? null}, context_note_depth),
						manage_message_enabled = COALESCE(${config.manage_message_enabled ?? null}, manage_message_enabled),
						videogen_enabled = COALESCE(${config.videogen_enabled ?? null}, videogen_enabled),
						voice_message_enabled = COALESCE(${config.voice_message_enabled ?? null}, voice_message_enabled),
						thread_creation_enabled = COALESCE(${config.thread_creation_enabled ?? null}, thread_creation_enabled),
						voice_transcript_chat_mode = COALESCE(${config.voice_transcript_chat_mode ?? null}, voice_transcript_chat_mode),
						chatterbox_turbo_enabled = COALESCE(${config.chatterbox_turbo_enabled ?? null}, chatterbox_turbo_enabled),
						chatterbox_cfg_weight = COALESCE(${config.chatterbox_cfg_weight ?? null}, chatterbox_cfg_weight),
						chatterbox_exaggeration = COALESCE(${config.chatterbox_exaggeration ?? null}, chatterbox_exaggeration),
						uncensor_injection_enabled = COALESCE(${config.uncensor_injection_enabled ?? null}, uncensor_injection_enabled),
						uncensor_unicode_space_enabled = COALESCE(${config.uncensor_unicode_space_enabled ?? null}, uncensor_unicode_space_enabled),
						uncensor_sanitize_enabled = COALESCE(${config.uncensor_sanitize_enabled ?? null}, uncensor_sanitize_enabled),
						tool_use_enabled = COALESCE(${config.tool_use_enabled ?? null}, tool_use_enabled),
						prompt_snapshot_enabled = COALESCE(${config.prompt_snapshot_enabled ?? null}, prompt_snapshot_enabled),
						memory_tagging_enabled = COALESCE(${config.memory_tagging_enabled ?? null}, memory_tagging_enabled),
						channel_memory_enabled = COALESCE(${config.channel_memory_enabled ?? null}, channel_memory_enabled)
					WHERE tomori_id = ${mainTomoriId}
					RETURNING tomori_config_id
				`;
      }
    }

    if (!updateRows.length) {
      return {
        success: false,
        error: "commands.data.import.error_update_failed",
      };
    }

    return {
      success: true,
      itemsImported: {
        configFieldsCount: configFields.length,
      },
    };
  } catch (error) {
    log.error(`Error importing server config for server ${serverDiscId}:`, error);
    return {
      success: false,
      error: "commands.data.import.error_import_failed",
    };
  }
}

export async function importServerMemories(
  serverDiscId: string,
  memories: MemoryItem[],
  target: { mode: "persona"; tomoriId?: number } | { mode: "global" },
): Promise<ImportResult> {
  try {
    const serverId = await resolveServerId(serverDiscId);
    if (!serverId) {
      return {
        success: false,
        error: "commands.data.import.error_no_server_data",
      };
    }

    for (const memory of memories) {
      const validation = validateMemoryContent(memory.content);
      if (!validation.isValid) {
        return {
          success: false,
          error: `commands.data.import.error_invalid_server_memory|${validation.error}`,
        };
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
          return {
            success: false,
            error: "commands.data.import.error_no_server_data",
          };
        }
        insertTomoriId = targetPersona.tomori_id;
        targetPersonaLineageId = coerceLineageId(targetPersona.persona_lineage_id);
      } else {
        const mainScope = await resolveMainTomoriScope(serverId);
        insertTomoriId = mainScope?.tomoriId ?? null;
        targetPersonaLineageId = mainScope?.personaLineageId ?? null;
      }
    } else {
      // Global target maps to the current main persona lineage.
      const mainScope = await resolveMainTomoriScope(serverId);
      targetPersonaLineageId = mainScope?.personaLineageId ?? null;
      insertTomoriId = null;
    }

    if (typeof targetPersonaLineageId !== "number" || !Number.isFinite(targetPersonaLineageId)) {
      return {
        success: false,
        error: "commands.data.import.error_no_server_data",
      };
    }

    await sql`
			DELETE FROM server_memories
			WHERE server_id = ${serverId}
			  AND persona_lineage_id = ${targetPersonaLineageId}
		`;

    if (memories.length === 0) {
      return {
        success: true,
        itemsImported: {
          memoriesCount: 0,
        },
      };
    }

    const userRows = await sql<Array<{ user_id: number }>>`
			SELECT u.user_id
			FROM users u
			LIMIT 1
		`;

    if (!userRows.length) {
      return {
        success: false,
        error: "commands.data.import.error_no_users",
      };
    }

    const userId = userRows[0].user_id;

    for (const memory of memories) {
      await sql`
				INSERT INTO server_memories (server_id, tomori_id, persona_lineage_id, user_id, content, tags)
				VALUES (${serverId}, ${insertTomoriId}, ${targetPersonaLineageId}, ${userId}, ${memory.content}, ${sql.array(memory.tags)})
			`;
    }

    return {
      success: true,
      itemsImported: {
        memoriesCount: memories.length,
      },
    };
  } catch (error) {
    log.error(`Error importing server memories for server ${serverDiscId}:`, error);
    return {
      success: false,
      error: "commands.data.import.error_import_failed",
    };
  }
}

export async function importPersonalData(
  userDiscId: string,
  importData: PersonalExportData,
  personaLineageId = 0,
): Promise<ImportResult> {
  const settingsResult = await importPersonalSettings(userDiscId, {
    user_nickname: importData.user_nickname,
    language_pref: importData.language_pref,
    impersonation_prompt: importData.impersonation_prompt ?? null,
    nai_char_tags: [],
    nai_char_ref_url: null,
  });
  if (!settingsResult.success) {
    return settingsResult;
  }

  const memoriesResult = await importPersonalMemories(userDiscId, importData.personal_memories, personaLineageId);
  if (!memoriesResult.success) {
    return memoriesResult;
  }

  return {
    success: true,
    itemsImported: {
      memoriesCount: memoriesResult.itemsImported?.memoriesCount ?? 0,
      configFieldsCount: settingsResult.itemsImported?.configFieldsCount ?? 0,
    },
  };
}

export async function importServerData(
  serverDiscId: string,
  importData: ServerExportData,
  tomoriId?: number,
): Promise<ImportResult> {
  const configResult = await importServerConfig(serverDiscId, importData.config);
  if (!configResult.success) {
    return configResult;
  }

  const memoriesResult = await importServerMemories(serverDiscId, importData.server_memories, {
    mode: "persona",
    tomoriId,
  });
  if (!memoriesResult.success) {
    return memoriesResult;
  }

  return {
    success: true,
    itemsImported: {
      memoriesCount: memoriesResult.itemsImported?.memoriesCount ?? 0,
      configFieldsCount: configResult.itemsImported?.configFieldsCount ?? 0,
    },
  };
}

export function validateImportFile(jsonData: unknown): ImportValidationResult {
  if (typeof jsonData !== "object" || jsonData === null) {
    return {
      valid: false,
      error: "commands.data.import.error_not_json",
    };
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
      return {
        valid: false,
        error: "commands.data.import.error_invalid_personal_memories_format",
      };
    }
    return { valid: true, type, data: validated.data.data };
  }

  if (type === "global_personal_memories") {
    const validated = globalPersonalMemoriesExportSchema.safeParse(jsonData);
    if (!validated.success) {
      log.error("Global personal memories import validation failed:", validated.error);
      return {
        valid: false,
        error: "commands.data.import.error_invalid_personal_memories_format",
      };
    }
    return { valid: true, type, data: validated.data.data };
  }

  if (type === "server_memories") {
    const validated = serverMemoriesExportSchema.safeParse(jsonData);
    if (!validated.success) {
      log.error("Server memories import validation failed:", validated.error);
      return {
        valid: false,
        error: "commands.data.import.error_invalid_server_memories_format",
      };
    }
    return { valid: true, type, data: validated.data.data };
  }

  if (type === "personal_settings") {
    const validated = personalSettingsExportSchema.safeParse(jsonData);
    if (!validated.success) {
      log.error("Personal settings import validation failed:", validated.error);
      return {
        valid: false,
        error: "commands.data.import.error_invalid_personal_settings_format",
      };
    }
    return { valid: true, type, data: validated.data.data };
  }

  if (type === "server_config") {
    const validated = serverConfigOnlyExportSchema.safeParse(jsonData);
    if (!validated.success) {
      log.error("Server config import validation failed:", validated.error);
      return {
        valid: false,
        error: "commands.data.import.error_invalid_server_config_format",
      };
    }
    return { valid: true, type, data: validated.data.data };
  }

  if (type === "personal") {
    const validated = getPersonalExportSchema().safeParse(jsonData);
    if (!validated.success) {
      log.error("Personal import validation failed:", validated.error);
      return {
        valid: false,
        error: "commands.data.import.error_invalid_personal_format",
      };
    }
    return {
      valid: true,
      type: "personal",
      data: validated.data.data,
    };
  }

  if (type === "server") {
    const validated = getServerExportSchema().safeParse(jsonData);
    if (!validated.success) {
      log.error("Server import validation failed:", validated.error);
      return {
        valid: false,
        error: "commands.data.import.error_invalid_server_format",
      };
    }
    return {
      valid: true,
      type: "server",
      data: validated.data.data,
    };
  }

  return {
    valid: false,
    error: `commands.data.import.error_unknown_type|${type}`,
  };
}
