import type { IdleNudgeFrequencyLevel } from "@/modules/natural-nudges/db/types";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const NUDGE_DORMANCY_MS = 14 * DAY_MS;

export const REWARD_HEAT_MULTIPLIER = 3;

// Half-life is 3 days so roughly two idle weeks leave negligible heat.
export const HEAT_HALF_LIFE_DAYS = 3;
export const HEAT_WINDOW_DAYS = 30;
// Capped at 50 because Gentle hits its daily idle cap at heat 50 and active checks already hit their shortest
// interval by 30.
export const MAX_EFFECTIVE_HEAT = 50;

// Threshold is 1 because heat 1 represents roughly one message to Tomori per day.
export const MIN_IDLE_NUDGE_HEAT = 1;

export const IDLE_NUDGE_HEAT_DIVISORS: Record<IdleNudgeFrequencyLevel, number> = {
  0: (MAX_EFFECTIVE_HEAT * 7) / 2,
  1: 25,
  2: 15,
  3: 8,
};

// Server-wide daily limits: caps are shared across every persona and channel in a server rather than applied per
// persona.
export const IDLE_NUDGE_DAILY_CAPS: Record<IdleNudgeFrequencyLevel, number> = { 0: 1, 1: 2, 2: 3, 3: 6 };

// Caps are 3x the daily nudge limits so each allowed nudge covers one plan, one format retry, and one decline.
export const IDLE_NUDGE_DAILY_PLANNER_CAPS: Record<IdleNudgeFrequencyLevel, number> = { 0: 3, 1: 6, 2: 9, 3: 18 };

// 14 quiet days decay heat to ~4%, so this matches heat's horizon for channel eligibility and Ping User target
// recency.
export const AUTOMATIC_CHANNEL_DAYS = 14;

export const AWAKE_HOURS_PER_DAY = 16;

export const IDLE_NUDGE_JITTER_MIN = 0.5;
export const IDLE_NUDGE_JITTER_MAX = 1.5;

export const LULL_MIN_HOURS = 1;
export const LULL_MAX_HOURS = 3;

// Below this turn count in the waking-hours window the activity histogram is noise, so fixed night hours apply
// instead.
export const WAKING_HOURS_MIN_TURNS = 50;
export const WAKING_HOURS_WINDOW_DAYS = 30;
export const WAKING_HOUR_SHARE = 0.25;
export const FALLBACK_SLEEP_START_HOUR = 1;
export const FALLBACK_SLEEP_END_HOUR = 8;
export const WAKE_DELAY_MAX_MINUTES = 90;

export const PENDING_WINDOW_MS = 12 * HOUR_MS;

export const UNANSWERED_STOP_STREAK = 3;
export const UNANSWERED_INTERVAL_FACTOR = 3;

export const NATURAL_NUDGE_FAILURE_STOP_THRESHOLD = 3;
export const NATURAL_NUDGE_FAILURE_COOLDOWN_MS = 3 * HOUR_MS;

export const RESTED_FLOOR = 0.1;
export const PERSONA_REST_MS = 24 * HOUR_MS;
export const CATEGORY_REST_MS = 12 * HOUR_MS;
export const IDLE_NUDGE_REST_MS = 3 * DAY_MS;
// Repeat rest must stay at or below FIRE_RETENTION_MS because pruned fires can no longer rest a repeated ping.
export const PING_USER_REPEAT_REST_MS = 14 * DAY_MS;

export const TALKATIVENESS_TICKETS = [0, 5, 10, 15, 20] as const;

export const PLANNER_HISTORY_MESSAGES = 15;
export const PLANNER_RECENT_TOPICS = 5;
export const MAX_SCANNED_CHANNELS = 6;
export const MAX_PLANNER_CHANNELS = 3;
// Six options bound planner input without crowding out alternatives within the drawn category.
export const MAX_PLANNER_NUDGES = 6;
export const HANGING_MAX_AGE_MS = 48 * HOUR_MS;
export const HANGING_MIN_HUMAN_MESSAGES = 2;

export const FIRE_RETENTION_MS = 30 * DAY_MS;
export const AGENDA_RETENTION_MS = 90 * DAY_MS;

// Long-term memories never expire, so a recency cutoff is required to keep stale targets from qualifying
// indefinitely.
export const PING_USER_MEMORY_DAYS = 30;

// Point caps qualify by sufficiency (~2 turns/day over the window) rather than volume, so one heavy user cannot win
// every draw.
export const PING_USER_POINTS_PER_TURN = 1;
export const PING_USER_TURN_CAP = 30;
export const PING_USER_POINTS_PER_STM_CHANNEL = 5;
export const PING_USER_STM_CHANNEL_CAP = 5;
export const PING_USER_ACTIVITY_POINTS = 10;
export const PING_USER_SAME_PERSONA_PENALTY = 10;
export const PING_USER_ANY_PERSONA_PENALTY = 5;
// Floor is 1 rather than 0 so an eligible target whose penalties cancel its points remains rare but still possible.
export const PING_USER_MIN_TICKETS = 1;

export const PING_USER_PLANNER_MEMORIES = 5;

// Active Nudge checks share idle nudges' heat floor because an uninvited reply intrudes most in servers that never
// talk to Tomori.
export const MIN_ACTIVE_NUDGE_HEAT = 1;
export const ACTIVE_NUDGE_TRIP_MIN = 15;
export const ACTIVE_NUDGE_TRIP_MAX = 40;
export const ACTIVE_NUDGE_REFERENCE_HEAT = 15;
export const ACTIVE_NUDGE_HEAT_SCALE_MIN = 0.5;
export const ACTIVE_NUDGE_HEAT_SCALE_MAX = 4;
export const ACTIVE_NUDGE_LEVEL_MULTIPLIERS: Record<IdleNudgeFrequencyLevel, number> = { 0: 2, 1: 1, 2: 0.6, 3: 0.35 };
export const ACTIVE_NUDGE_DAILY_CAPS: Record<IdleNudgeFrequencyLevel, number> = { 0: 1, 1: 3, 2: 6, 3: 10 };
// Separate check cap prevents empty checks on busy servers from burning a free key's daily requests needed by chat
// replies.
export const ACTIVE_NUDGE_DAILY_CHECK_CAPS: Record<IdleNudgeFrequencyLevel, number> = { 0: 10, 1: 20, 2: 40, 3: 60 };
export const ACTIVE_NUDGE_EMPTY_REST_MS = 10 * 60 * 1000;
export const ACTIVE_NUDGE_EMPTY_REST_MAX_MS = 3 * HOUR_MS;
// HTTP 429 pauses the whole server rather than one channel because the rate-limit quota belongs to the server's API
// key.
export const ACTIVE_NUDGE_QUOTA_PAUSE_MS = 3 * HOUR_MS;
// Matcher window stays small because longer windows let an earlier topic win after conversation has moved on.
export const ACTIVE_NUDGE_WINDOW_MESSAGES = 5;
// Option budget stays at 25 because some Decision models reject more than 26 choices once "none" is included.
export const ACTIVE_NUDGE_OPTION_BUDGET = 25;
// Delay stays brief because live chat goes stale quickly, waiting only long enough not to read as instant.
export const ACTIVE_NUDGE_DELAY_MIN_MS = 15_000;
export const ACTIVE_NUDGE_DELAY_MAX_MS = 45_000;
export const ACTIVE_NUDGE_STALE_HUMAN_MESSAGES = 5;
export const ACTIVE_NUDGE_DETOUR_CHANCE = 0.1;
// Detour personas require a recent turn within this window so a forgotten persona does not abruptly reappear.
export const ACTIVE_NUDGE_DETOUR_WARM_DAYS = 60;
export const ACTIVE_NUDGE_UNDERDOG_DAYS = 30;
export const ACTIVE_NUDGE_UNDERDOG_MAX_BOOST = 4;

export const PLAY_SCENE_SECOND_PARTNER_CHANCE = 0.3;
export interface SceneTurnRange {
  min: number;
  max: number;
}
export const PLAY_SCENE_SHORT_TURNS: SceneTurnRange = { min: 2, max: 4 };
// Long scenes cap at 5 to 8 one-line turns because each turn costs a separate persona generation.
export const PLAY_SCENE_LONG_TURNS: SceneTurnRange = { min: 5, max: 8 };
export const PLAY_SCENE_LONG_CHANCE = 0.2;
// Mention cascade limit stays independent of scene turn limits because scenes are scripted up front whereas mention
// chains are open-ended.
export const NUDGE_MENTION_CASCADE_LIMIT = 3;
