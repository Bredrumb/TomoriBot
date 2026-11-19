// Metrics extend this list instead of ALTER TABLE because stat_counters is key-value; keys omit content for
// cardinality.
const STAT_METRICS = [
  "message_sent",
  "presence_seen",
  "command_used",
  "model_used",
  "tokens_in",
  "tokens_out",
  "cache_read_tokens",
  "cache_write_tokens",
  "reviewer_tokens_in",
  "reviewer_tokens_out",
  "decision_tokens_in",
  "decision_tokens_out",
  "tool_used",
  "web_search",
  "memory_taught",
  "reminder_set",
  "sprite_shown",
  "sprite_emotion",
  "emoji_used",
  "sticker_used",
  "custom_expression_used",
  "active_hour",
  "channel_turn",
  "text_generated",
  "user_impersonation_triggered",
  "image_generated",
  "video_generated",
  "audio_generated",
  "provider_error",
  "panel_action",
] as const;

export type StatMetric = (typeof STAT_METRICS)[number];

// Metrics in this set write the lineage-0 sentinel instead of an active persona lineage id because they are not
// scoped to a persona.
export const PERSONA_AGNOSTIC_METRICS = new Set<StatMetric>([
  "command_used",
  "provider_error",
  "panel_action",
  "channel_turn",
]);
