/**
 * Stat-tracking metric catalog.
 *
 * Each value is one `metric` in the `stat_counters` table. Adding a new metric
 * is a new entry here — never an `ALTER TABLE` (the long/narrow counter table
 * carries the metric and its sub-key as data, not columns). See
 * plans/stat-tracking.md §5 for the full catalog and grain notes.
 *
 * `metric_key` semantics per metric:
 *   - command_used  → full command path, space-joined (e.g. "config humanizer",
 *                     "server welcome-channel set"); not just the top-level category
 *   - model_used    → model id / codename
 *   - tokens_in     → model id / codename (count accumulates input token deltas, not 1)
 *   - tokens_out    → model id / codename (count accumulates output token deltas, not 1)
 *   - tool_used     → tool name
 *   - sprite_shown      → sprite name
 *   - emoji_used        → emoji name
 *   - sticker_used      → sticker name/id
 *   - active_hour       → hour-of-day "0".."23"
 *   - text_generated    → "" (one per completed chat turn)
 *   - image_generated   → "" (one per successfully sent image)
 *   - video_generated   → "" (one per successfully sent video)
 *   - (all others)      → "" (scalar event counter)
 */
export const STAT_METRICS = [
  "message_sent",
  "command_used",
  "model_used",
  "tokens_in",
  "tokens_out",
  "tool_used",
  "web_search",
  "memory_taught",
  "reminder_set",
  "sprite_shown",
  "emoji_used",
  "sticker_used",
  "active_hour",
  "text_generated",
  "image_generated",
  "video_generated",
] as const;

/** Union of all valid `stat_counters.metric` values. */
export type StatMetric = (typeof STAT_METRICS)[number];

/**
 * Persona-agnostic metrics: these are not scoped to a persona lineage, so they
 * are always written with the lineage-0 sentinel (see plan §5). All other
 * metrics carry the active persona's lineage id.
 */
export const PERSONA_AGNOSTIC_METRICS = new Set<StatMetric>(["command_used"]);

/** Type guard for a raw string against the metric catalog. */
export function isStatMetric(value: string): value is StatMetric {
  return STAT_METRICS.includes(value as StatMetric);
}
