import {
  CUSTOM_IDLE_NUDGE_KEY_PREFIX,
  PERSONA_AUTHORED_IDLE_NUDGE_KEY_PREFIX,
} from "@/modules/natural-nudges/db/types";
import { metricSampleRepository } from "@/utils/db/repositories/MetricSampleRepository";

const NATURAL_NUDGE_IDLE_METRIC = "natural_nudge_idle";
const NATURAL_NUDGE_ACTIVE_METRIC = "natural_nudge_active";

type IdleNudgeOutcome = "fired" | "aborted" | "failed";
type IdleNudgePhase = "a" | "b" | "c";

export interface IdleNudgeSample {
  serverId: number;
  outcome: IdleNudgeOutcome;
  phase: IdleNudgePhase;
  reason: string;
  heat?: number;
  category?: string;
  // Authored definitions pass their source rather than title or local ID, so free-text titles and local IDs stay out
  // of telemetry.
  idleNudgeKey?: string;
  plannerModel?: string;
  plannerInputTokens?: number;
  plannerOutputTokens?: number;
}

// Telemetry fields accept only fixed-set strings and numbers (never text, prose, or names), and `recordSample` never
// throws so nudges are never delayed.
export function recordIdleNudgeSample(sample: IdleNudgeSample): void {
  const fields: Record<string, number | string> = {
    server_id: sample.serverId,
    outcome: sample.outcome,
    phase: sample.phase,
    reason: sample.reason,
  };
  if (sample.heat !== undefined) fields.heat = Math.round(sample.heat * 10) / 10;
  if (sample.category) fields.category = sample.category;
  if (sample.idleNudgeKey)
    fields.idle_nudge_key = sample.idleNudgeKey.startsWith(CUSTOM_IDLE_NUDGE_KEY_PREFIX)
      ? "custom"
      : sample.idleNudgeKey.startsWith(PERSONA_AUTHORED_IDLE_NUDGE_KEY_PREFIX)
        ? "persona"
        : sample.idleNudgeKey;
  if (sample.plannerModel) fields.planner_model = sample.plannerModel;
  if (sample.plannerInputTokens !== undefined) fields.planner_tokens_in = sample.plannerInputTokens;
  if (sample.plannerOutputTokens !== undefined) fields.planner_tokens_out = sample.plannerOutputTokens;
  void metricSampleRepository.recordSample(NATURAL_NUDGE_IDLE_METRIC, fields);
}

export interface ActiveNudgeSample {
  serverId: number;
  outcome: IdleNudgeOutcome;
  // Phase codes: `a` records outcomes before the matcher answers, while `c` records outcomes after the post-match
  // delay.
  phase: "a" | "c";
  reason: string;
  heat: number;
  matcherKind?: "decision" | "llm";
  matcherModel?: string;
  optionCount?: number;
  margin?: number;
  detour?: boolean;
  rematched: boolean;
  matcherInputTokens?: number;
  matcherOutputTokens?: number;
  rematchInputTokens?: number;
  rematchOutputTokens?: number;
}

export function recordActiveNudgeSample(sample: ActiveNudgeSample): void {
  const fields: Record<string, number | string> = {
    server_id: sample.serverId,
    outcome: sample.outcome,
    phase: sample.phase,
    reason: sample.reason,
    heat: Math.round(sample.heat * 10) / 10,
  };
  if (sample.matcherKind) fields.matcher_kind = sample.matcherKind;
  if (sample.matcherModel) fields.matcher_model = sample.matcherModel;
  if (sample.optionCount !== undefined) fields.option_count = sample.optionCount;
  if (sample.margin !== undefined) fields.margin = Math.round(sample.margin * 1000) / 1000;
  if (sample.detour !== undefined) fields.detour = sample.detour ? 1 : 0;
  fields.rematched = sample.rematched ? 1 : 0;
  if (sample.matcherInputTokens !== undefined) fields.matcher_tokens_in = sample.matcherInputTokens;
  if (sample.matcherOutputTokens !== undefined) fields.matcher_tokens_out = sample.matcherOutputTokens;
  if (sample.rematchInputTokens !== undefined) fields.rematch_tokens_in = sample.rematchInputTokens;
  if (sample.rematchOutputTokens !== undefined) fields.rematch_tokens_out = sample.rematchOutputTokens;
  void metricSampleRepository.recordSample(NATURAL_NUDGE_ACTIVE_METRIC, fields);
}
