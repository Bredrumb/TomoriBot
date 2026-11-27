// Reset statements assign SQL DEFAULT rather than literal values so live schema defaults stay authoritative across
// migrations.

import type { SQL } from "bun";
import { sql } from "@/utils/db/client";

// Identity columns stay untouched and updated_at is excluded from DEFAULT because reset sets it to the current time
// as an audit record.
export const SERVER_IDENTITY_AUDIT_COLUMNS = ["server_id", "created_at", "updated_at"] as const;

export const PERSONAL_IDENTITY_AUDIT_COLUMNS = ["user_id", "user_disc_id", "created_at", "updated_at"] as const;

export interface SingletonResetClassification {
  readonly table: string;
  readonly reset: readonly string[];
  readonly preserved: readonly string[];
}

// Tables are enumerated explicitly rather than derived dynamically because a missed table during reset would fail
// silently and report success.
export const SERVER_SINGLETON_RESET_TABLES: readonly SingletonResetClassification[] = [
  {
    table: "server_chat_configs",
    reset: [
      "humanizer_streaming_enabled",
      "humanizer_pacing_enabled",
      "humanizer_sentence_split_enabled",
      "humanizer_lowercase_enabled",
      "humanizer_punctuation_split_enabled",
      "message_fetch_limit",
      "send_message_limit",
      "match_limit",
      "cascade_limit",
      "timezone_offset",
      "self_debug_enabled",
      "model_randomizer_enabled",
      "system_prompt",
      "context_note",
      "context_note_depth",
      "response_prefill",
      "response_reviewer_llm_id",
      "response_reviewer_prompt",
      "response_rule_checker_ref",
      "response_review_items",
      "llm_stop_strings",
      "llm_stop_speaker_pattern_enabled",
      "llm_max_output_tokens",
      "llm_top_p",
      "llm_top_k",
      "llm_frequency_penalty",
      "llm_presence_penalty",
      "llm_min_p",
      "llm_logit_biases",
      "fallback_model_refs",
    ],
    preserved: [],
  },
  {
    table: "server_model_configs",
    reset: ["llm_temperature", "thinking_level", "llm_disabled_params", "fallback_llm_ids", "hide_respond_embed"],
    // Active model/endpoint ids, plaintext-irrecoverable api_key, and the capability cache bound to other_model_codename
    // must survive reset so the bot stays configured.
    preserved: [
      "llm_id",
      "embedding_model_id",
      "diffusion_model_id",
      "video_model_id",
      "vision_llm_id",
      "decision_model_id",
      "api_key",
      "key_version",
      "custom_endpoint_url",
      "custom_model_name",
      "custom_num_ctx",
      "other_model_codename",
      "other_model_capabilities",
      "other_model_capabilities_fetched_at",
      "credential_created_at",
      "credential_activity_epoch",
      "credential_last_attempt_at",
    ],
  },
  {
    table: "server_member_permissions_configs",
    reset: [
      "server_memteaching_enabled",
      "self_teaching_enabled",
      "personal_memories_enabled",
      "hide_impersonation_embeds",
      "prompt_snapshot_enabled",
      "persona_export_enabled",
    ],
    preserved: [],
  },
  {
    table: "server_capabilities_configs",
    reset: [
      "emoji_usage_enabled",
      "sticker_usage_enabled",
      "web_search_enabled",
      "manage_message_enabled",
      "thread_creation_enabled",
      "dice_rolling_enabled",
      "conditioning_interactions_enabled",
      "imagegen_enabled",
      "danbooru_enabled",
      "videogen_enabled",
      "voice_message_enabled",
      "user_blocking_enabled",
      "time_awareness_enabled",
      "tool_use_enabled",
      "response_drafting_enabled",
      "short_term_memory_enabled",
      "user_info_updates_enabled",
    ],
    preserved: [],
  },
  {
    table: "server_notice_embeds_configs",
    reset: ["tool_notice_hidden_keys", "tool_notice_verbosity"],
    preserved: [],
  },
  {
    table: "server_nsfw_configs",
    reset: ["uncensor_injection_enabled", "uncensor_unicode_space_enabled", "uncensor_sanitize_enabled"],
    preserved: [],
  },
  {
    table: "server_speech_configs",
    reset: [
      "voice_transcript_chat_mode",
      "chatterbox_turbo_enabled",
      "chatterbox_cfg_weight",
      "chatterbox_exaggeration",
    ],
    preserved: [
      "speech_design_endpoint_id",
      "speech_clone_endpoint_id",
      "speech_design_model_id",
      "speech_clone_model_id",
      "transcription_model_id",
    ],
  },
  {
    table: "server_auto_trigger_configs",
    reset: ["autoch_disc_ids", "autoch_threshold", "autoch_threshold_max"],
    preserved: [],
  },
  {
    table: "server_channel_scope_configs",
    reset: [
      "rp_channel_ids",
      "private_channel_ids",
      "crosschannel_blocklist_ids",
      "stm_privacy_bypass",
      "thought_log_channel_disc_id",
    ],
    preserved: [],
  },
  {
    table: "server_trigger_behavior_configs",
    reset: [
      "always_reply_enabled",
      "deliberate_trigger_mode",
      "deliberate_tool_mode",
      "deliberate_tool_context_turns",
      "deliberate_tool_triggers",
      "fast_regeneration_retry_enabled",
      "fast_regeneration_continue_enabled",
      "cooldown_type",
      "cooldown_length",
    ],
    preserved: [],
  },
  {
    table: "server_novelai_imagegen_configs",
    reset: [
      "nai_preset_name",
      "image_default_positive_tags",
      "image_default_negative_tags",
      "nai_sampler",
      "nai_steps",
      "nai_scale",
      "nai_noise_schedule",
      "nai_cfg_rescale",
    ],
    // The selected diffusion model is active identity, classified with the model ids above.
    preserved: ["nai_diffusion_model_id"],
  },
  {
    table: "server_byok_configs",
    reset: ["user_byok_mode"],
    preserved: [],
  },
  {
    table: "server_memory_configs",
    reset: ["memory_tagging_enabled", "channel_memory_enabled"],
    preserved: [],
  },
  {
    table: "server_stm_configs",
    reset: [
      "refresh_cadence",
      "render_mode",
      "crude_message_count",
      "summarizer_instructions_override",
      "content_injection_depth",
    ],
    preserved: [],
  },
  {
    table: "server_welcome_configs",
    reset: ["welcome_channel_disc_id", "welcome_prompt", "welcome_persona_id"],
    preserved: [],
  },
  {
    table: "image_quota_configs",
    reset: ["daily_user_quota", "serverwide_quota", "serverwide_quota_resets_in", "enabled"],
    preserved: [],
  },
  {
    table: "text_quota_configs",
    reset: ["daily_user_quota", "serverwide_quota", "serverwide_quota_resets_in", "enabled"],
    preserved: [],
  },
  {
    table: "video_quota_configs",
    reset: ["daily_user_quota", "serverwide_quota", "serverwide_quota_resets_in", "enabled"],
    preserved: [],
  },
  {
    table: "server_natural_nudge_configs",
    reset: [
      "idle_nudges_enabled",
      "active_nudges_enabled",
      "channel_disc_ids",
      "llm_id",
      "checker_llm_id",
      "checker_decision_model_id",
      "idle_nudge_frequency",
      "active_nudge_frequency",
      "disabled_builtin_idle_nudges",
      "category_weights",
      "heat_offset",
    ],
    preserved: [],
  },
];

// server_auto_trigger_persona_overrides belongs in the delete list rather than singletons because it is a channel
// junction table cleared by deletion.
export const SERVER_COLLECTION_RESET_TABLES = [
  "server_auto_trigger_persona_overrides",
  "stm_categories",
  "random_triggers",
  "channel_llm_overrides",
  "channel_prompt_overrides",
  "channel_context_notes",
  "personalization_blacklist",
  "persona_user_blocks",
  "channel_whitelist",
  "role_whitelist",
  "channel_persona_whitelist",
  "server_natural_nudge_custom_idle_nudges",
  "server_natural_nudge_persona_scopes",
] as const;

// registration_locale stays preserved as account history, and natural_nudge_opt_out stays preserved so a personal
// reset never makes someone pingable again.
export const PERSONAL_SINGLETON_RESET_TABLES: readonly SingletonResetClassification[] = [
  {
    table: "users",
    reset: ["language_pref", "privacy_level", "message_proxy_service", "message_proxy_instance_id"],
    preserved: ["registration_locale"],
  },
  {
    table: "user_personalization_configs",
    reset: [
      "user_nickname",
      "shortterm_cache_crossserver_opt_in",
      "physical_appearance_tags",
      "char_ref_url",
      "impersonation_prompt",
      "personal_dtm",
      "personal_deliberate_tool_mode",
      "personal_server_fallback_enabled",
      "timezone_offset",
      "prefix_override",
      "suffix_override",
      "gender_identity",
      "pronouns",
      "addressing_style",
    ],
    // The fallback chain and randomizer survive with the saved personal providers they reference.
    preserved: ["natural_nudge_opt_out", "fallback_model_refs", "model_randomizer_enabled"],
  },
];

// Hand-written SQL avoids identifier concatenation for DEFAULT (schema-parity tests catch drift); singletons upsert
// because setup omits some split rows.
class ResetRepository {
  // Must throw on any failure so the reset rolls back atomically; callers handle cache invalidation and scheduler
  // nudges after this resolves.
  async resetServerConfiguration(serverId: number): Promise<void> {
    await sql.begin(async (tx: SQL) => {
      await tx`
        INSERT INTO server_chat_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          humanizer_streaming_enabled = DEFAULT,
          humanizer_pacing_enabled = DEFAULT,
          humanizer_sentence_split_enabled = DEFAULT,
          humanizer_lowercase_enabled = DEFAULT,
          humanizer_punctuation_split_enabled = DEFAULT,
          message_fetch_limit = DEFAULT,
          send_message_limit = DEFAULT,
          match_limit = DEFAULT,
          cascade_limit = DEFAULT,
          timezone_offset = DEFAULT,
          self_debug_enabled = DEFAULT,
          model_randomizer_enabled = DEFAULT,
          response_reviewer_llm_id = DEFAULT,
          response_reviewer_prompt = DEFAULT,
          response_rule_checker_ref = DEFAULT,
          response_review_items = DEFAULT,
          system_prompt = DEFAULT,
          context_note = DEFAULT,
          context_note_depth = DEFAULT,
          response_prefill = DEFAULT,
          llm_stop_strings = DEFAULT,
          llm_stop_speaker_pattern_enabled = DEFAULT,
          llm_max_output_tokens = DEFAULT,
          llm_top_p = DEFAULT,
          llm_top_k = DEFAULT,
          llm_frequency_penalty = DEFAULT,
          llm_presence_penalty = DEFAULT,
          llm_min_p = DEFAULT,
          llm_logit_biases = DEFAULT,
          fallback_model_refs = DEFAULT,
          updated_at = NOW()
      `;

      // Active model identities and credentials stay omitted here (see SERVER_SINGLETON_RESET_TABLES.preserved).
      await tx`
        INSERT INTO server_model_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          llm_temperature = DEFAULT,
          thinking_level = DEFAULT,
          llm_disabled_params = DEFAULT,
          fallback_llm_ids = DEFAULT,
          hide_respond_embed = DEFAULT,
          updated_at = NOW()
      `;

      await tx`
        INSERT INTO server_member_permissions_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          server_memteaching_enabled = DEFAULT,
          self_teaching_enabled = DEFAULT,
          personal_memories_enabled = DEFAULT,
          hide_impersonation_embeds = DEFAULT,
          prompt_snapshot_enabled = DEFAULT,
          persona_export_enabled = DEFAULT,
          updated_at = NOW()
      `;

      await tx`
        INSERT INTO server_capabilities_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          emoji_usage_enabled = DEFAULT,
          sticker_usage_enabled = DEFAULT,
          web_search_enabled = DEFAULT,
          manage_message_enabled = DEFAULT,
          thread_creation_enabled = DEFAULT,
          dice_rolling_enabled = DEFAULT,
          conditioning_interactions_enabled = DEFAULT,
          imagegen_enabled = DEFAULT,
          danbooru_enabled = DEFAULT,
          videogen_enabled = DEFAULT,
          voice_message_enabled = DEFAULT,
          user_blocking_enabled = DEFAULT,
          time_awareness_enabled = DEFAULT,
          tool_use_enabled = DEFAULT,
          response_drafting_enabled = DEFAULT,
          short_term_memory_enabled = DEFAULT,
          user_info_updates_enabled = DEFAULT,
          updated_at = NOW()
      `;

      await tx`
        INSERT INTO server_notice_embeds_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          tool_notice_hidden_keys = DEFAULT,
          tool_notice_verbosity = DEFAULT,
          updated_at = NOW()
      `;

      await tx`
        INSERT INTO server_nsfw_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          uncensor_injection_enabled = DEFAULT,
          uncensor_unicode_space_enabled = DEFAULT,
          uncensor_sanitize_enabled = DEFAULT,
          updated_at = NOW()
      `;

      await tx`
        INSERT INTO server_speech_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          voice_transcript_chat_mode = DEFAULT,
          chatterbox_turbo_enabled = DEFAULT,
          chatterbox_cfg_weight = DEFAULT,
          chatterbox_exaggeration = DEFAULT,
          updated_at = NOW()
      `;

      await tx`
        INSERT INTO server_auto_trigger_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          autoch_disc_ids = DEFAULT,
          autoch_threshold = DEFAULT,
          autoch_threshold_max = DEFAULT,
          updated_at = NOW()
      `;

      await tx`
        INSERT INTO server_channel_scope_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          rp_channel_ids = DEFAULT,
          private_channel_ids = DEFAULT,
          crosschannel_blocklist_ids = DEFAULT,
          stm_privacy_bypass = DEFAULT,
          thought_log_channel_disc_id = DEFAULT,
          updated_at = NOW()
      `;

      await tx`
        INSERT INTO server_trigger_behavior_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          always_reply_enabled = DEFAULT,
          deliberate_trigger_mode = DEFAULT,
          deliberate_tool_mode = DEFAULT,
          deliberate_tool_context_turns = DEFAULT,
          deliberate_tool_triggers = DEFAULT,
          fast_regeneration_retry_enabled = DEFAULT,
          fast_regeneration_continue_enabled = DEFAULT,
          cooldown_type = DEFAULT,
          cooldown_length = DEFAULT,
          updated_at = NOW()
      `;

      await tx`
        INSERT INTO server_novelai_imagegen_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          nai_preset_name = DEFAULT,
          image_default_positive_tags = DEFAULT,
          image_default_negative_tags = DEFAULT,
          nai_sampler = DEFAULT,
          nai_steps = DEFAULT,
          nai_scale = DEFAULT,
          nai_noise_schedule = DEFAULT,
          nai_cfg_rescale = DEFAULT,
          updated_at = NOW()
      `;

      await tx`
        INSERT INTO server_byok_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          user_byok_mode = DEFAULT,
          updated_at = NOW()
      `;

      await tx`
        INSERT INTO server_memory_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          memory_tagging_enabled = DEFAULT,
          channel_memory_enabled = DEFAULT,
          updated_at = NOW()
      `;

      await tx`
        INSERT INTO server_stm_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          refresh_cadence = DEFAULT,
          render_mode = DEFAULT,
          crude_message_count = DEFAULT,
          summarizer_instructions_override = DEFAULT,
          content_injection_depth = DEFAULT,
          updated_at = NOW()
      `;

      await tx`
        INSERT INTO server_welcome_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          welcome_channel_disc_id = DEFAULT,
          welcome_prompt = DEFAULT,
          welcome_persona_id = DEFAULT,
          updated_at = NOW()
      `;

      // Reset quota settings only because usage tables record historical consumption.
      await tx`
        INSERT INTO image_quota_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          daily_user_quota = DEFAULT,
          serverwide_quota = DEFAULT,
          serverwide_quota_resets_in = DEFAULT,
          enabled = DEFAULT,
          updated_at = NOW()
      `;

      await tx`
        INSERT INTO text_quota_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          daily_user_quota = DEFAULT,
          serverwide_quota = DEFAULT,
          serverwide_quota_resets_in = DEFAULT,
          enabled = DEFAULT,
          updated_at = NOW()
      `;

      await tx`
        INSERT INTO video_quota_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          daily_user_quota = DEFAULT,
          serverwide_quota = DEFAULT,
          serverwide_quota_resets_in = DEFAULT,
          enabled = DEFAULT,
          updated_at = NOW()
      `;

      await tx`
        INSERT INTO server_natural_nudge_configs (server_id) VALUES (${serverId})
        ON CONFLICT (server_id) DO UPDATE SET
          idle_nudges_enabled = DEFAULT,
          active_nudges_enabled = DEFAULT,
          channel_disc_ids = DEFAULT,
          llm_id = DEFAULT,
          checker_llm_id = DEFAULT,
          checker_decision_model_id = DEFAULT,
          idle_nudge_frequency = DEFAULT,
          active_nudge_frequency = DEFAULT,
          disabled_builtin_idle_nudges = DEFAULT,
          category_weights = DEFAULT,
          heat_offset = DEFAULT,
          updated_at = NOW()
      `;

      await tx`DELETE FROM server_auto_trigger_persona_overrides WHERE server_id = ${serverId}`;
      // Delete category definitions only because persisted short_term_memories carry their own categories payload.
      await tx`DELETE FROM stm_categories WHERE server_id = ${serverId}`;
      await tx`DELETE FROM random_triggers WHERE server_id = ${serverId}`;
      await tx`DELETE FROM channel_llm_overrides WHERE server_id = ${serverId}`;
      await tx`DELETE FROM channel_prompt_overrides WHERE server_id = ${serverId}`;
      await tx`DELETE FROM channel_context_notes WHERE server_id = ${serverId}`;
      await tx`DELETE FROM personalization_blacklist WHERE server_id = ${serverId}`;
      await tx`DELETE FROM persona_user_blocks WHERE server_id = ${serverId}`;
      await tx`DELETE FROM channel_whitelist WHERE server_id = ${serverId}`;
      await tx`DELETE FROM role_whitelist WHERE server_id = ${serverId}`;
      await tx`DELETE FROM channel_persona_whitelist WHERE server_id = ${serverId}`;
      await tx`DELETE FROM server_natural_nudge_custom_idle_nudges WHERE server_id = ${serverId}`;
      await tx`DELETE FROM server_natural_nudge_persona_scopes WHERE server_id = ${serverId}`;
    });
  }

  // Deliberately omits cache invalidation: callers use the returned user Discord ID and spotlight server IDs to
  // invalidate caches after commit.
  async resetPersonalConfiguration(userId: number): Promise<PersonalResetResult | null> {
    return await sql.begin(async (tx: SQL) => {
      const [user] = await tx<Array<{ user_disc_id: string }>>`
        UPDATE users
        SET
          language_pref = DEFAULT,
          privacy_level = DEFAULT,
          message_proxy_service = DEFAULT,
          message_proxy_instance_id = DEFAULT,
          updated_at = NOW()
        WHERE user_id = ${userId}
        RETURNING user_disc_id
      `;
      if (!user) return null;

      await tx`
        INSERT INTO user_personalization_configs (user_id) VALUES (${userId})
        ON CONFLICT (user_id) DO UPDATE SET
          user_nickname = DEFAULT,
          shortterm_cache_crossserver_opt_in = DEFAULT,
          physical_appearance_tags = DEFAULT,
          char_ref_url = DEFAULT,
          impersonation_prompt = DEFAULT,
          personal_dtm = DEFAULT,
          personal_deliberate_tool_mode = DEFAULT,
          personal_server_fallback_enabled = DEFAULT,
          timezone_offset = DEFAULT,
          prefix_override = DEFAULT,
          suffix_override = DEFAULT,
          gender_identity = DEFAULT,
          pronouns = DEFAULT,
          addressing_style = DEFAULT,
          updated_at = NOW()
      `;

      await tx`DELETE FROM user_persona_naming_preferences WHERE user_id = ${userId}`;

      const deletedSpotlights = await tx<Array<{ server_id: number }>>`
        DELETE FROM personal_spotlights
        WHERE user_id = ${userId}
        RETURNING server_id
      `;

      const affectedServerIds = [...new Set(deletedSpotlights.map((row) => row.server_id))];

      return {
        userDiscId: user.user_disc_id,
        affectedServerIds,
      };
    });
  }
}

export interface PersonalResetResult {
  userDiscId: string;
  affectedServerIds: number[];
}

export const resetRepository = new ResetRepository();
