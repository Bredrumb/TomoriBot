-- 007_backfill_missing_split_config_rows.sql
--
-- Backfills any missing rows in the 13 server split config tables (+ server_model_configs)
-- for servers that still exist in tomori_configs.
-- This protects servers created after migration 002 but before ServerRepository.setup() starts inserting split rows.

-- ── server_chat_configs ──────────────────────────────────────────────────────
INSERT INTO server_chat_configs (
  server_id, humanizer_degree, message_fetch_limit, send_message_limit,
  match_limit, cascade_limit, timezone_offset, self_debug_enabled,
  system_prompt, context_note, context_note_depth,
  llm_stop_strings, llm_stop_speaker_pattern_enabled, llm_max_output_tokens,
  llm_top_p, llm_top_k, llm_frequency_penalty, llm_presence_penalty, llm_min_p,
  llm_logit_biases, fallback_model_refs
)
SELECT
  tc.server_id,
  COALESCE(tc.humanizer_degree, 1),
  COALESCE(tc.message_fetch_limit, 80),
  COALESCE(tc.send_message_limit, 0),
  COALESCE(tc.match_limit, 3),
  COALESCE(tc.cascade_limit, 3),
  COALESCE(tc.timezone_offset, 0),
  COALESCE(tc.self_debug_enabled, false),
  tc.system_prompt,
  tc.context_note,
  COALESCE(tc.context_note_depth, 0),
  COALESCE(tc.llm_stop_strings, '{}'),
  COALESCE(tc.llm_stop_speaker_pattern_enabled, false),
  tc.llm_max_output_tokens,
  COALESCE(tc.llm_top_p, 0.95),
  COALESCE(tc.llm_top_k, 0),
  COALESCE(tc.llm_frequency_penalty, 0.0),
  COALESCE(tc.llm_presence_penalty, 0.0),
  COALESCE(tc.llm_min_p, 0.05),
  COALESCE(tc.llm_logit_biases, '[]'::JSONB),
  COALESCE(tc.fallback_model_refs, '[]'::JSONB)
FROM tomori_configs tc
WHERE tc.server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_notice_embeds_configs ─────────────────────────────────────────────
INSERT INTO server_notice_embeds_configs (server_id, tool_notice_hidden_keys)
SELECT tc.server_id, COALESCE(tc.tool_notice_hidden_keys, '{}')
FROM tomori_configs tc
WHERE tc.server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_member_permissions_configs ────────────────────────────────────────
INSERT INTO server_member_permissions_configs (
  server_id, server_memteaching_enabled, attribute_memteaching_enabled,
  sampledialogue_memteaching_enabled, self_teaching_enabled, personal_memories_enabled,
  hide_impersonation_embeds, prompt_snapshot_enabled
)
SELECT
  tc.server_id,
  COALESCE(tc.server_memteaching_enabled, true),
  COALESCE(tc.attribute_memteaching_enabled, false),
  COALESCE(tc.sampledialogue_memteaching_enabled, false),
  COALESCE(tc.self_teaching_enabled, true),
  COALESCE(tc.personal_memories_enabled, true),
  COALESCE(tc.hide_impersonation_embeds, false),
  COALESCE(tc.prompt_snapshot_enabled, false)
FROM tomori_configs tc
WHERE tc.server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_channel_scope_configs ─────────────────────────────────────────────
INSERT INTO server_channel_scope_configs (
  server_id, rp_channel_ids, private_channel_ids, crosschannel_blocklist_ids,
  stm_privacy_bypass, thought_log_channel_disc_id
)
SELECT
  tc.server_id,
  COALESCE(tc.rp_channel_ids, '{}'),
  COALESCE(tc.private_channel_ids, '{}'),
  COALESCE(tc.crosschannel_blocklist_ids, '{}'),
  COALESCE(tc.stm_privacy_bypass, false),
  tc.thought_log_channel_disc_id
FROM tomori_configs tc
WHERE tc.server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_welcome_configs ───────────────────────────────────────────────────
INSERT INTO server_welcome_configs (server_id, welcome_channel_disc_id, welcome_prompt, welcome_persona_id)
SELECT tc.server_id, tc.welcome_channel_disc_id, tc.welcome_prompt, tc.welcome_persona_id
FROM tomori_configs tc
WHERE tc.server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_trigger_behavior_configs ─────────────────────────────────────────
INSERT INTO server_trigger_behavior_configs (
  server_id, always_reply_enabled, deliberate_trigger_mode, cooldown_type, cooldown_length
)
SELECT
  tc.server_id,
  COALESCE(tc.always_reply_enabled, false),
  COALESCE(tc.deliberate_trigger_mode, false),
  COALESCE(tc.cooldown_type, 0),
  COALESCE(tc.cooldown_length, 5)
FROM tomori_configs tc
WHERE tc.server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_auto_trigger_configs ──────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'server_auto_trigger_configs'
      AND column_name = 'autoch_persona_overrides'
  ) THEN
    INSERT INTO server_auto_trigger_configs (
      server_id, autoch_disc_ids, autoch_persona_overrides, autoch_threshold, autoch_threshold_max
    )
    SELECT
      tc.server_id,
      COALESCE(tc.autoch_disc_ids, '{}'),
      COALESCE(tc.autoch_persona_overrides, '[]'::JSONB),
      COALESCE(tc.autoch_threshold, 0),
      COALESCE(tc.autoch_threshold_max, 0)
    FROM tomori_configs tc
    WHERE tc.server_id IS NOT NULL
    ON CONFLICT (server_id) DO NOTHING;
  ELSE
    INSERT INTO server_auto_trigger_configs (
      server_id, autoch_disc_ids, autoch_threshold, autoch_threshold_max
    )
    SELECT
      tc.server_id,
      COALESCE(tc.autoch_disc_ids, '{}'),
      COALESCE(tc.autoch_threshold, 0),
      COALESCE(tc.autoch_threshold_max, 0)
    FROM tomori_configs tc
    WHERE tc.server_id IS NOT NULL
    ON CONFLICT (server_id) DO NOTHING;

    IF to_regclass('public.server_auto_trigger_persona_overrides') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tomori_configs'
          AND column_name = 'autoch_persona_overrides'
      )
    THEN
      INSERT INTO server_auto_trigger_persona_overrides (server_id, channel_disc_id, persona_id)
      SELECT
        tc.server_id,
        (entry->>'channel_disc_id')::TEXT,
        COALESCE(entry->>'persona_id', entry->>'tomori_id')::INT
      FROM tomori_configs tc
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
        CASE
          WHEN JSONB_TYPEOF(tc.autoch_persona_overrides) = 'array'
            THEN tc.autoch_persona_overrides
          ELSE '[]'::JSONB
        END
      ) AS entry
      WHERE
        tc.server_id IS NOT NULL
        AND (entry->>'channel_disc_id') IS NOT NULL
        AND (entry->>'channel_disc_id') <> ''
        AND COALESCE(entry->>'persona_id', entry->>'tomori_id') ~ '^\d+$'
        AND EXISTS (
          SELECT 1 FROM personas p WHERE p.persona_id = COALESCE(entry->>'persona_id', entry->>'tomori_id')::INT
        )
      ON CONFLICT (server_id, channel_disc_id) DO NOTHING;
    END IF;
  END IF;
END $$;

-- ── server_capabilities_configs ──────────────────────────────────────────────
INSERT INTO server_capabilities_configs (
  server_id, emoji_usage_enabled, sticker_usage_enabled, web_search_enabled,
  manage_message_enabled, thread_creation_enabled, imagegen_enabled, videogen_enabled,
  voice_message_enabled, tool_use_enabled
)
SELECT
  tc.server_id,
  COALESCE(tc.emoji_usage_enabled, true),
  COALESCE(tc.sticker_usage_enabled, true),
  COALESCE(tc.web_search_enabled, true),
  COALESCE(tc.manage_message_enabled, true),
  COALESCE(tc.thread_creation_enabled, true),
  COALESCE(tc.imagegen_enabled, true),
  COALESCE(tc.videogen_enabled, false),
  COALESCE(tc.voice_message_enabled, true),
  COALESCE(tc.tool_use_enabled, true)
FROM tomori_configs tc
WHERE tc.server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_novelai_imagegen_configs ──────────────────────────────────────────
INSERT INTO server_novelai_imagegen_configs (
  server_id, nai_preset_name, nai_style_tags, nai_negative_tags,
  nai_sampler, nai_steps, nai_scale, nai_noise_schedule, nai_cfg_rescale,
  nai_diffusion_model_id
)
SELECT
  tc.server_id,
  tc.nai_preset_name,
  COALESCE(tc.nai_style_tags, '{"8k","absurdres","masterpiece","best quality","good quality","newest"}'),
  COALESCE(tc.nai_negative_tags, '{"lowres","worst quality","low quality","bad quality","old","oldest","unfinished","scan artifacts","jpeg artifacts","jaggy lines","unclear","sketch","blurry","bad anatomy","very displeasing","displeasing","bad hands","bad fingers","missing fingers","bad proportions","bad perspective","bad eyes","bad pupils","multiple heads","extra faces","many arms","poorly drawn face","poorly drawn hands","fused hands","bad feet","too many legs","malformed limbs","extra arms","multiple ears","extra digits","fewer digits","twitter username","username","watermark","signature","2koma","4koma","comic"}'),
  tc.nai_sampler,
  tc.nai_steps,
  tc.nai_scale,
  tc.nai_noise_schedule,
  tc.nai_cfg_rescale,
  tc.nai_diffusion_model_id
FROM tomori_configs tc
WHERE tc.server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_nsfw_configs ──────────────────────────────────────────────────────
INSERT INTO server_nsfw_configs (
  server_id, uncensor_injection_enabled, uncensor_unicode_space_enabled, uncensor_sanitize_enabled
)
SELECT
  tc.server_id,
  COALESCE(tc.uncensor_injection_enabled, false),
  COALESCE(tc.uncensor_unicode_space_enabled, false),
  COALESCE(tc.uncensor_sanitize_enabled, false)
FROM tomori_configs tc
WHERE tc.server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_speech_configs ────────────────────────────────────────────────────
INSERT INTO server_speech_configs (
  server_id, voice_transcript_chat_mode, chatterbox_turbo_enabled,
  chatterbox_cfg_weight, chatterbox_exaggeration
)
SELECT
  tc.server_id,
  COALESCE(tc.voice_transcript_chat_mode, true),
  COALESCE(tc.chatterbox_turbo_enabled, true),
  COALESCE(tc.chatterbox_cfg_weight, 0.5),
  COALESCE(tc.chatterbox_exaggeration, 0.5)
FROM tomori_configs tc
WHERE tc.server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_byok_configs ──────────────────────────────────────────────────────
INSERT INTO server_byok_configs (server_id, user_byok_mode)
SELECT tc.server_id, COALESCE(tc.user_byok_mode, false)
FROM tomori_configs tc
WHERE tc.server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_memory_configs ────────────────────────────────────────────────────
INSERT INTO server_memory_configs (server_id, memory_tagging_enabled)
SELECT tc.server_id, COALESCE(tc.memory_tagging_enabled, false)
FROM tomori_configs tc
WHERE tc.server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;

-- ── server_model_configs ─────────────────────────────────────────────────────
INSERT INTO server_model_configs (
  server_id,
  llm_id,
  embedding_model_id,
  diffusion_model_id,
  video_model_id,
  vision_llm_id,
  api_key,
  key_version,
  llm_temperature,
  thinking_level,
  llm_disabled_params,
  custom_endpoint_url,
  custom_model_name,
  custom_num_ctx,
  fallback_llm_ids,
  other_model_codename,
  other_model_capabilities,
  other_model_capabilities_fetched_at,
  hide_respond_embed
)
SELECT
  tc.server_id,
  tc.llm_id,
  tc.embedding_model_id,
  tc.diffusion_model_id,
  tc.video_model_id,
  tc.vision_llm_id,
  tc.api_key,
  COALESCE(tc.key_version, 1),
  COALESCE(tc.llm_temperature, 1.0),
  COALESCE(tc.thinking_level, 'auto'),
  COALESCE(tc.llm_disabled_params, '{}'),
  tc.custom_endpoint_url,
  tc.custom_model_name,
  tc.custom_num_ctx,
  COALESCE(tc.fallback_llm_ids, '[]'::JSONB),
  tc.other_model_codename,
  tc.other_model_capabilities,
  tc.other_model_capabilities_fetched_at,
  COALESCE(tc.hide_respond_embed, false)
FROM tomori_configs tc
WHERE tc.server_id IS NOT NULL
ON CONFLICT (server_id) DO NOTHING;
