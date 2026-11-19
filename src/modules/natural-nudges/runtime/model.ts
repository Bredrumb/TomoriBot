import type { ErrorContext, TomoriState } from "@/types/db/schema";
import { llmModelRepo } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import { resolveCustomTextEndpointTarget } from "@/utils/provider/customEndpointService";
import { resolveChatMaxOutputTokens } from "@/utils/provider/maxOutputTokens";
import { resolveModelLimits } from "@/utils/provider/modelLimits";
import { normalizeProviderName } from "@/utils/provider/providerInfoRegistry";
import type { ProviderOptionCapability } from "@/utils/provider/providerOptionRegistry";
import { findProviderRequestDeniedError, reportProviderUsage } from "@/utils/provider/providerUsage";
import {
  resolveServerStructuredModel,
  type ResolvedServerStructuredModel,
} from "@/utils/provider/serverStructuredOutput";
import type { TokenUsage } from "@/utils/text/tokenEstimate";

// Pinned nudge models bill to their own provider-option slot, whereas unpinned calls bill as `text` because they use
// the server chat model.
export type NudgeModelSlot = Extract<ProviderOptionCapability, "text" | "nudge-planner" | "nudge-checker">;

export interface NudgeModelRef {
  llmId: number;
  slot: NudgeModelSlot;
}

export type NudgeModelResolution =
  | { kind: "ready"; resolved: ResolvedServerStructuredModel }
  | { kind: "unavailable"; reason: "model_unavailable" | "credentials" | "denied" };

// Provider-option refusals are expected with no member to notify, so they log a warning and return `unavailable`
// instead of an error.
export async function resolveNudgeModel(
  state: TomoriState,
  ref: NudgeModelRef,
  failureContext: ErrorContext,
): Promise<NudgeModelResolution> {
  try {
    const resolved = await resolveServerStructuredModel(state, ref.llmId, failureContext, ref.slot);
    if (!resolved) return { kind: "unavailable", reason: "model_unavailable" };
    if ("errorLogged" in resolved) return { kind: "unavailable", reason: "credentials" };
    return { kind: "ready", resolved };
  } catch (error) {
    if (!findProviderRequestDeniedError(error)) throw error;
    log.warn(`Natural Nudges: provider option refused ${ref.slot} model ${ref.llmId}`, undefined, failureContext);
    return { kind: "unavailable", reason: "denied" };
  }
}

export function isNudgeCallDenied(resolved: ResolvedServerStructuredModel, cause: unknown): boolean {
  return findProviderRequestDeniedError(cause, resolved.usageContext) !== null;
}

export function recordNudgeUsage(
  resolved: ResolvedServerStructuredModel,
  model: string,
  total: TokenUsage | null | undefined,
  reported: TokenUsage,
): TokenUsage {
  reportProviderUsage(resolved.usageContext, {
    modelCodename: model,
    costUsd: reported.costUsd,
    inputTokens: reported.inputTokens,
    outputTokens: reported.outputTokens,
  });
  return {
    inputTokens: (total?.inputTokens ?? 0) + reported.inputTokens,
    outputTokens: (total?.outputTokens ?? 0) + reported.outputTokens,
  };
}

export async function resolveStructuredCallTarget(resolved: ResolvedServerStructuredModel) {
  const provider = resolved.state.llm.llm_provider;
  const target = provider.startsWith("custom:") ? await resolveCustomTextEndpointTarget(resolved.state) : null;
  const limits = await resolveModelLimits(resolved.state);
  return {
    model: resolved.state.llm.llm_codename,
    endpointUrl: target?.endpointUrl ?? undefined,
    maxOutputTokens: resolveChatMaxOutputTokens({
      provider: normalizeProviderName(provider),
      configured: resolved.state.config.llm_max_output_tokens,
      modelMaxOutputTokens: limits.maxOutputTokens,
      contextWindow: limits.contextWindow,
    }),
  };
}

export type PlannerModelSource = "pinned" | "chat";

export type PlannerModelStatus =
  | ({ kind: "ready"; source: PlannerModelSource } & NudgeModelRef)
  | { kind: "unusable"; llmId: number; source: PlannerModelSource; reason: "no_structured_output" | "unavailable" }
  | { kind: "none" };

export function plannerModelRef(state: TomoriState, pinnedLlmId: number | null): NudgeModelRef {
  return pinnedLlmId === null
    ? { llmId: state.llm.llm_id ?? 0, slot: "text" }
    : { llmId: pinnedLlmId, slot: "nudge-planner" };
}

// Unpinned calls use `state.llm` (never a persona override), and a failing pinned model never falls back because the
// admin chose it.
export async function resolvePlannerModel(state: TomoriState, pinnedLlmId: number | null): Promise<PlannerModelStatus> {
  const source: PlannerModelSource = pinnedLlmId === null ? "chat" : "pinned";
  const ref = plannerModelRef(state, pinnedLlmId);
  // llm_id 0 is the unconfigured-model sentinel (`getUnconfiguredLlm`), not a real row.
  if (ref.llmId <= 0) return { kind: "none" };
  const resolution = await resolveNudgeModel(state, ref, { serverId: state.server_id });
  if (resolution.kind === "ready") return { kind: "ready", source, ...ref };
  const model = await llmModelRepo.loadById(ref.llmId);
  const reason = model && !model.supports_structoutput ? "no_structured_output" : "unavailable";
  return { kind: "unusable", llmId: ref.llmId, source, reason };
}
