import { DEFAULT_HUMANIZER_SETTINGS } from "@/constants/humanizer";
import type { AssembledServerConfig, LlmRow, NaiPresetRow, TomoriState, UserRow } from "@/types/db/schema";
import { naiPresetSections } from "@/db/seed/catalog/naiPresets";
import { PrivacyLevel } from "@/types/db/schema";
import { customExpressionSchema, type CustomExpressionRow } from "@/types/db/schema";
import { EmotionKey } from "@/types/misc/emotions";
import { customIdleNudgeRowSchema, type CustomIdleNudgeRow } from "@/modules/natural-nudges/db/types";
import { EMPTY_PERSONA_NAMING_CONFIG } from "@/types/personaNaming";
import { DEFAULT_IMAGE_NEGATIVE_TAGS, DEFAULT_IMAGE_POSITIVE_TAGS } from "@/utils/image/tagDefaults";

// Mirrors the SQL table column defaults rather than arbitrary placeholders so fixtures match fresh production setup
// (enforced by fixtures.test.ts).
const BASE_CONFIG: AssembledServerConfig = {
  response_reviewer_llm_id: null,
  response_reviewer_prompt: null,
  response_rule_checker_ref: null,
  response_review_items: ["persona", "examples", "history"],
  response_drafting_enabled: false,
  llm_id: 1,
  decision_model_id: null,
  api_key: null,
  key_version: 1,
  llm_temperature: 1,
  thinking_level: "auto",
  llm_disabled_params: [],
  fallback_llm_ids: [],
  other_model_capabilities: null,
  hide_respond_embed: false,
  ...DEFAULT_HUMANIZER_SETTINGS,
  message_fetch_limit: 80,
  send_message_limit: 0,
  match_limit: 3,
  cascade_limit: 3,
  timezone_offset: 0,
  self_debug_enabled: false,
  model_randomizer_enabled: false,
  context_note_depth: 0,
  llm_stop_strings: [],
  llm_stop_speaker_pattern_enabled: false,
  llm_top_p: 0.95,
  llm_top_k: 0,
  llm_frequency_penalty: 0,
  llm_presence_penalty: 0,
  llm_min_p: 0.05,
  llm_logit_biases: [],
  fallback_model_refs: [],
  server_memteaching_enabled: false,
  self_teaching_enabled: true,
  personal_memories_enabled: true,
  hide_impersonation_embeds: false,
  prompt_snapshot_enabled: false,
  persona_export_enabled: false,
  emoji_usage_enabled: true,
  sticker_usage_enabled: true,
  web_search_enabled: true,
  manage_message_enabled: true,
  thread_creation_enabled: true,
  conditioning_interactions_enabled: true,
  dice_rolling_enabled: true,
  imagegen_enabled: true,
  danbooru_enabled: true,
  videogen_enabled: false,
  voice_message_enabled: true,
  user_blocking_enabled: true,
  time_awareness_enabled: true,
  tool_use_enabled: true,
  short_term_memory_enabled: true,
  user_info_updates_enabled: true,
  tool_notice_hidden_keys: [],
  tool_notice_verbosity: "minimal",
  uncensor_injection_enabled: false,
  uncensor_unicode_space_enabled: false,
  uncensor_sanitize_enabled: false,
  speech_design_endpoint_id: null,
  speech_clone_endpoint_id: null,
  speech_design_model_id: null,
  speech_clone_model_id: null,
  transcription_model_id: null,
  voice_transcript_chat_mode: true,
  chatterbox_turbo_enabled: true,
  chatterbox_cfg_weight: 0.5,
  chatterbox_exaggeration: 0.5,
  autoch_disc_ids: [],
  autoch_persona_overrides: [],
  autoch_threshold: 0,
  autoch_threshold_max: 0,
  rp_channel_ids: [],
  private_channel_ids: [],
  crosschannel_blocklist_ids: [],
  stm_privacy_bypass: false,
  always_reply_enabled: false,
  deliberate_trigger_mode: false,
  deliberate_tool_mode: false,
  deliberate_tool_context_turns: null,
  deliberate_tool_triggers: {},
  cooldown_type: 0,
  cooldown_length: 5,
  image_default_positive_tags: [...DEFAULT_IMAGE_POSITIVE_TAGS],
  image_default_negative_tags: [...DEFAULT_IMAGE_NEGATIVE_TAGS],
  user_byok_mode: false,
  memory_tagging_enabled: false,
  channel_memory_enabled: false,
};

export function createServerConfig(overrides: Partial<AssembledServerConfig> = {}): AssembledServerConfig {
  return { ...structuredClone(BASE_CONFIG), ...overrides };
}

export function createNaiPreset(overrides: Partial<NaiPresetRow> = {}): NaiPresetRow {
  const target = overrides.model_target ?? "kayra";
  const definition = naiPresetSections
    .flatMap((section) => section.rows)
    .find((row) => row.modelTarget === target && row.isDefault);
  if (!definition) throw new Error(`Unknown NovelAI preset target: ${target}`);
  return {
    nai_preset_id: 1,
    preset_name: definition.name,
    model_target: target,
    is_default: true,
    preset_desc: definition.desc,
    descriptions: { "en-US": definition.desc },
    parameters: structuredClone({ ...definition.parameters }),
    ...overrides,
  };
}

export function createLlmRow(overrides: Partial<LlmRow> = {}): LlmRow {
  return {
    llm_id: 1,
    llm_provider: "google",
    llm_codename: "gemini-2.5-flash",
    is_scoped_registration: false,
    is_smartest: false,
    is_default: false,
    is_reasoning: false,
    is_deprecated: false,
    is_free: false,
    has_tools: true,
    sees_images: true,
    sees_videos: false,
    sees_youtube: false,
    is_uncensored: false,
    supports_structoutput: false,
    strict_role_alternation: false,
    supports_prefix_completion: false,
    supports_assistant_prefill: false,
    verbatim_tool_calling: false,
    ...overrides,
  };
}

export type PersonaFixtureOverrides = Omit<Partial<TomoriState>, "config"> & {
  config?: Partial<AssembledServerConfig>;
};

export function createPersona(overrides: PersonaFixtureOverrides = {}): TomoriState {
  const { config, ...rest } = overrides;
  return {
    server_id: 1,
    persona_id: 1,
    persona_lineage_id: 100,
    persona_nickname: "Mirri",
    is_alter: false,
    is_pointer: false,
    is_nsfw: false,
    attribute_list: [],
    sample_dialogues_in: [],
    sample_dialogues_out: [],
    physical_appearance_tags: [],
    voice_source_priority: "design",
    context_note_depth: 0,
    trigger_words: [],
    persona_prompt: null,
    // Cloned because the shared constant's nested maps are mutable, and a suite that writes an
    // address term would otherwise leak it into every later persona in the same process.
    naming_config: structuredClone(EMPTY_PERSONA_NAMING_CONFIG),
    persona_attributes: [],
    reward_conditioning_enabled: true,
    punish_conditioning_enabled: true,
    humanizer_override: null,
    server_memories: [],
    autoch_counter: 0,
    autoch_next_target: 0,
    llm: createLlmRow(),
    config: createServerConfig(config),
    ...rest,
  };
}

export type UserFixtureOverrides = Partial<UserRow>;

export function createUserRow(overrides: UserFixtureOverrides = {}): UserRow {
  return {
    user_id: 1,
    user_disc_id: "user-1",
    user_nickname: null,
    registration_locale: "en-US",
    language_pref: "en-US",
    privacy_level: PrivacyLevel.MINIMAL,
    personal_memories: [],
    physical_appearance_tags: [],
    personal_dtm: "follow",
    personal_deliberate_tool_mode: "follow",
    personal_server_fallback_enabled: true,
    natural_nudge_opt_out: false,
    shortterm_cache_crossserver_opt_in: false,
    message_proxy_service: null,
    message_proxy_instance_id: null,
    prefix_override: null,
    suffix_override: null,
    ...overrides,
  };
}
export function createCustomExpression(overrides: Partial<CustomExpressionRow> = {}): CustomExpressionRow {
  return customExpressionSchema.strict().parse({
    custom_expression_id: "00000000-0000-4000-8000-000000000001",
    server_id: 1,
    name: "Wave custom",
    name_key: "wave custom",
    description: "Use when greeting someone.",
    emotion_key: EmotionKey.JOY,
    source_kind: "link",
    delivery_kind: "link",
    original_link: "https://example.com/wave.png",
    storage_reference: null,
    mime_type: null,
    extension: null,
    byte_size: null,
    restricted: false,
    revision: 1,
    created_at: new Date(0),
    updated_at: new Date(0),
    persona_ids: [],
    ...overrides,
  });
}

export function createCustomIdleNudge(overrides: Partial<CustomIdleNudgeRow> = {}): CustomIdleNudgeRow {
  return customIdleNudgeRowSchema.strict().parse({
    custom_idle_nudge_id: 1,
    server_id: 1,
    category: "start_topic",
    title: "Mirri's riddle",
    brief: "Have {persona} pose a riddle.",
    agenda_hint: null,
    prerequisites: [],
    recommended_tools: [],
    enabled: true,
    ...overrides,
  });
}
