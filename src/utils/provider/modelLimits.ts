import type { TomoriState } from "@/types/db/schema";
import {
  getLiveModelLimits,
  isLiveModelLimitsRefreshDue,
  type LiveLimitsProvider,
  refreshLiveModelLimits,
} from "@/utils/cache/liveModelLimitsCache";
import { getOpenRouterTokenLimits } from "@/utils/cache/openrouterCapabilityCache";
import { log } from "@/utils/misc/logger";
import { resolveCustomTextEndpointTarget } from "@/utils/provider/customEndpointService";
import { resolveChatMaxOutputTokens } from "@/utils/provider/maxOutputTokens";
import { normalizeProviderName } from "@/utils/provider/providerInfoRegistry";
import { decryptApiKey } from "@/utils/security/crypto";
import { withStoredCredentialUsage } from "@/utils/security/apiKeyRetention";

// Null means unknown: an unknown contextWindow skips history truncation and an unknown maxOutputTokens skips output
// clamping.
export interface ModelLimits {
  contextWindow: number | null;
  maxOutputTokens: number | null;
}

function positiveOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

function isLiveLimitsProvider(provider: string): provider is LiveLimitsProvider {
  return provider === "anthropic" || provider === "google";
}

// Background refresh is unawaited so the current chat turn keeps catalog limits instead of blocking on the provider
// models API.
function scheduleLiveModelLimitsLookup(tomoriState: TomoriState, provider: LiveLimitsProvider): void {
  const codename = tomoriState.llm.llm_codename;
  const encryptedKey = tomoriState.config.api_key;
  if (!encryptedKey || !isLiveModelLimitsRefreshDue(provider, codename)) return;
  void decryptApiKey(encryptedKey, tomoriState.config.key_version || 1)
    .then((apiKey) =>
      withStoredCredentialUsage(encryptedKey, apiKey, () => refreshLiveModelLimits(provider, codename, apiKey)),
    )
    .catch(() => log.metric("live_model_limits_key_unavailable", { provider, codename }));
}

// Live provider limits outrank the static catalog because they reflect unreviewed model changes and cover scoped
// registrations.
function resolveLiveModelLimits(
  tomoriState: TomoriState,
  provider: string,
  refreshLiveLimits: boolean,
): Partial<ModelLimits> {
  const codename = tomoriState.llm.llm_codename;
  if (provider === "openrouter") {
    const tokenLimits = getOpenRouterTokenLimits(codename);
    return {
      contextWindow: positiveOrNull(tokenLimits?.contextLength),
      maxOutputTokens: positiveOrNull(tokenLimits?.maxCompletionTokens),
    };
  }
  if (isLiveLimitsProvider(provider)) {
    if (refreshLiveLimits) scheduleLiveModelLimitsLookup(tomoriState, provider);
    return getLiveModelLimits(provider, codename) ?? {};
  }
  return {};
}

// NovelAI is excluded here because its context windows depend on subscription tier and come from its own capability
// cache.
export async function resolveModelLimits(tomoriState: TomoriState, refreshLiveLimits = true): Promise<ModelLimits> {
  const provider = normalizeProviderName(tomoriState.llm.llm_provider);
  if (provider === "custom") {
    const { numCtx } = await resolveCustomTextEndpointTarget(tomoriState);
    return { contextWindow: positiveOrNull(numCtx), maxOutputTokens: null };
  }

  const live = resolveLiveModelLimits(tomoriState, provider, refreshLiveLimits);
  return {
    contextWindow: live.contextWindow ?? positiveOrNull(tomoriState.llm.context_window),
    maxOutputTokens: live.maxOutputTokens ?? positiveOrNull(tomoriState.llm.max_output_tokens),
  };
}

// Shared with the prompt snapshot; OpenRouter omits max_tokens when no ceiling is known unless overridden, since
// 402/400 tips rely on overrides.
export async function resolveRequestMaxOutputTokens(
  tomoriState: TomoriState,
  refreshLiveLimits = true,
): Promise<number | undefined> {
  const provider = normalizeProviderName(tomoriState.llm.llm_provider);
  const configured = tomoriState.config.llm_max_output_tokens;
  const { contextWindow, maxOutputTokens } = await resolveModelLimits(tomoriState, refreshLiveLimits);
  if (provider === "openrouter" && !maxOutputTokens) {
    return typeof configured === "number" && configured > 0 ? configured : undefined;
  }
  return resolveChatMaxOutputTokens({ provider, configured, modelMaxOutputTokens: maxOutputTokens, contextWindow });
}
