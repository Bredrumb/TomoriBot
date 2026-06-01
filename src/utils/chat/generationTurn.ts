import type { FallbackEntry, LlmRow, TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { LLMProvider, ProviderConfig, StreamResult } from "@/types/provider/interfaces";
import type { ToolContext } from "@/types/tool/interfaces";
import { getCachedChannelLlm } from "@/utils/cache/channelLlmCache";
import { getGeminiTokenLimits } from "@/utils/cache/geminiCapabilityCache";
import { getNovelAITokenLimits } from "@/utils/cache/novelaiCapabilityCache";
import { getCachedContextTokens, refreshNovelAISubscription } from "@/utils/cache/novelaiSubscriptionCache";
import { getOpenRouterTokenLimits, isOpenRouterCapabilityCacheReady } from "@/utils/cache/openrouterCapabilityCache";
import { llmProviderRepo } from "@/utils/db/repositories";
import { type FallbackNoticeAttempt, sendFallbackModelUsageNotice } from "@/utils/discord/fallbackModelNotice";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { log } from "@/utils/misc/logger";
import { getProviderForTomori, ProviderFactory } from "@/utils/provider/providerFactory";
import { applyPersonalProviderSelectionsToTomoriState } from "@/utils/provider/personalProviderRuntime";
import { decryptApiKey } from "@/utils/security/crypto";
import {
  hasAvailableRotationKey,
  MAX_KEY_ATTEMPTS,
  recordKeyError,
  recordKeySuccess,
  selectApiKey,
} from "@/utils/security/keyRotation";
import { truncateDialogueHistory } from "@/utils/text/contextTruncator";
import type { ChatResponseSink, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import { providerIsApiFamily, runToolLoop } from "@/utils/chat/toolLoop";

interface GenerationAttempt {
  label: string;
  tomoriState: TomoriState;
  provider: LLMProvider;
  providerConfig: ProviderConfig;
  successModel: LlmRow;
  /** Rotation key ID used for this attempt; null when rotation pool is inactive. */
  rotationKeyId: number | null;
}

const OPENROUTER_LENGTH_EMPTY_RETRY_DROP_PAIRS = parseIntegerEnvFlag(
  process.env.OPENROUTER_LENGTH_EMPTY_RETRY_DROP_PAIRS,
  2,
  1,
);

export async function runGenerationTurn(
  context: ChatTurnContext,
  responseSink: ChatResponseSink,
): Promise<GenerationTurnResult> {
  const responseTarget = await responseSink.prepare?.(context);
  if (responseTarget) {
    context.responseTarget = responseTarget;
  }

  try {
    const attempts = await buildGenerationAttempts(context);
    const failures: FallbackNoticeAttempt[] = [];
    const baseContextItems = context.contextItems;

    for (const [index, attempt] of attempts.entries()) {
      const hasPendingModelFallback = index < attempts.length - 1;
      context.tomoriState = attempt.tomoriState;
      context.contextItems = await prepareProviderContextItems({
        contextItems: baseContextItems,
        tomoriState: attempt.tomoriState,
        serverDiscId: context.serverDiscId,
        emptyResponseFinishReason: context.turn.lockedTurn.admission.incoming.emptyResponseFinishReason,
        retryCount: context.turn.lockedTurn.admission.incoming.retryCount,
      });

      // Key rotation inner loop: try multiple keys for this attempt before giving up.
      let rotationKeyId = attempt.rotationKeyId;
      const excludedKeyIds = new Set<number>();
      let result!: GenerationTurnResult;
      let keyAttemptCount = 0;
      context.streamingContext.rotationKeyRetriesUsed = false;

      while (true) {
        keyAttemptCount++;
        if (keyAttemptCount > MAX_KEY_ATTEMPTS) {
          log.warn(`Exceeded MAX_KEY_ATTEMPTS (${MAX_KEY_ATTEMPTS}) for ${attempt.label}.`);
          break;
        }

        const retryExcludedKeyIds = getRetryExcludedKeyIds(excludedKeyIds, rotationKeyId);
        const hasFallbackKey = await hasAvailableRotationKey(attempt.tomoriState, retryExcludedKeyIds);
        setStreamUserErrorSuppression(context, hasFallbackKey || hasPendingModelFallback);
        context.streamingContext.forceModelFallback = hasPendingModelFallback;

        result = await runToolLoop({
          context,
          provider: attempt.provider,
          providerConfig: attempt.providerConfig,
          tomoriState: attempt.tomoriState,
        });

        if (result.status !== "error") {
          if (rotationKeyId != null) await recordKeySuccess(rotationKeyId);
          break;
        }

        if (!hasFallbackKey) break;

        // Record error for the key that just failed, then rotate to the next one.
        context.streamingContext.rotationKeyRetriesUsed = true;
        if (rotationKeyId != null) {
          const errorCode = extractErrorCode(result.streamResults.at(-1));
          const errorType = errorCode.includes("rate_limit") || errorCode.includes("429") ? "rate_limit" : "api_error";
          await recordKeyError(rotationKeyId, errorType, errorCode);
          excludedKeyIds.add(rotationKeyId);
        }

        const nextKey = await selectApiKey(attempt.tomoriState, [...Array.from(excludedKeyIds)]);
        if (!nextKey) break;

        attempt.providerConfig.apiKey = nextKey.apiKey;
        rotationKeyId = nextKey.rotationKeyId;
        log.warn(
          `Key rotation: retrying ${attempt.label} with key ${rotationKeyId ?? "main"} (attempt ${keyAttemptCount + 1}).`,
        );
      }

      if (result.status !== "error" || index === attempts.length - 1) {
        if (index > 0 && shouldSendFallbackNotice(context, result)) {
          log.info(`Fallback generation succeeded with ${attempt.label} after ${failures.length} failed attempt(s).`);
          await sendFallbackNoticeIfNeeded(context, attempt, failures);
        }
        setStreamUserErrorSuppression(context, false);
        context.streamingContext.forceModelFallback = false;

        if (result.status === "error") {
          await emitStreamErrors(responseSink, result.streamResults);
        }
        await responseSink.finalize(result);
        return result;
      }

      failures.push({
        modelCodename: attempt.tomoriState.llm.llm_codename,
        errorCode: extractErrorCode(result.streamResults.at(-1)),
      });
    }

    const skipped: GenerationTurnResult = {
      status: "skipped",
      streamResults: [],
      personaResponses: [],
    };
    setStreamUserErrorSuppression(context, false);
    context.streamingContext.forceModelFallback = false;
    await responseSink.finalize(skipped);
    return skipped;
  } catch (error) {
    setStreamUserErrorSuppression(context, false);
    context.streamingContext.forceModelFallback = false;
    await responseSink.emitError(error);
    const result: GenerationTurnResult = {
      status: "error",
      streamResults: [{ status: "error", data: error }],
      personaResponses: [],
    };
    await responseSink.finalize(result);
    return result;
  }
}

function setStreamUserErrorSuppression(context: ChatTurnContext, temporarySuppressed: boolean): void {
  context.streamingContext.suppressUserErrors = temporarySuppressed || !context.shouldSurfaceUserErrors;
}

async function buildGenerationAttempts(context: ChatTurnContext): Promise<GenerationAttempt[]> {
  const disableAllTools = !!context.streamingContext.disableAllTools;
  const primaryState = await resolvePrimaryTomoriState(context);
  const attempts: GenerationAttempt[] = [await createAttempt("primary", primaryState, undefined, disableAllTools)];
  const fallbackEntries =
    primaryState.fallback_chain ?? primaryState.fallback_llms?.map((model) => ({ kind: "llm" as const, model })) ?? [];

  for (const [index, entry] of fallbackEntries.entries()) {
    try {
      const fallback = await createFallbackAttempt(primaryState, entry, index + 1, disableAllTools);
      if (fallback) {
        attempts.push(fallback);
      }
    } catch (error) {
      log.warn(`Skipping fallback ${index + 1}: failed to prepare provider config.`, error as Error);
    }
  }

  return attempts;
}

// Must run before provider.createConfig — providers eagerly attach the full tool
// list and the streaming path won't strip them if has_tools flips later.
function applyDeliberateToolKillSwitch(state: TomoriState, disableAllTools: boolean): TomoriState {
  if (disableAllTools && state.llm.has_tools) {
    return { ...state, llm: { ...state.llm, has_tools: false } };
  }
  return state;
}

function getRetryExcludedKeyIds(excludedKeyIds: Set<number>, rotationKeyId: number | null): number[] {
  const ids = new Set(excludedKeyIds);
  if (rotationKeyId != null) {
    ids.add(rotationKeyId);
  }
  return [...ids];
}

async function emitStreamErrors(responseSink: ChatResponseSink, streamResults: StreamResult[]): Promise<void> {
  for (const streamResult of streamResults) {
    if (streamResult.status === "error") {
      await responseSink.emitStreamResult(streamResult);
    }
  }
}

async function sendFallbackNoticeIfNeeded(
  context: ChatTurnContext,
  attempt: GenerationAttempt,
  failures: FallbackNoticeAttempt[],
): Promise<void> {
  if (context.isUserImpersonation || failures.length === 0 || !context.shouldSurfaceUserErrors) {
    return;
  }

  await sendFallbackModelUsageNotice({
    context: {
      channel: context.channel as ToolContext["channel"],
      client: context.client,
      message: context.message,
      tomoriState: context.tomoriState,
      locale: context.locale,
      provider: attempt.provider.getInfo().name,
      webhook: context.responseTarget?.webhook,
      personaUsername: context.responseTarget?.personaUsername,
      personaAvatarUrl: context.responseTarget?.personaAvatarUrl,
    },
    failures,
    successModel: attempt.successModel,
  });
}

function shouldSendFallbackNotice(context: ChatTurnContext, result: GenerationTurnResult): boolean {
  if (result.status !== "completed") {
    return false;
  }

  if (!StreamOrchestrator.hasStopRequest(context.channel.id)) {
    return true;
  }

  log.info(
    `Skipping fallback model notice for channel ${context.channel.id} because a stop or follow-up interrupt is pending.`,
  );
  StreamOrchestrator.clearStopRequest(context.channel.id);
  return false;
}

async function resolvePrimaryTomoriState(context: ChatTurnContext): Promise<TomoriState> {
  const incoming = context.turn.lockedTurn.admission.incoming;
  const personalBase =
    context.textCredentialSource === "personal"
      ? (await applyPersonalProviderSelectionsToTomoriState(context.currentPersona, context.personalRoutingUserId))
          .tomoriState
      : context.currentPersona;
  const channelLlmOverride =
    context.isUserImpersonation || context.textCredentialSource === "personal"
      ? null
      : await getCachedChannelLlm(context.currentPersona.server_id, context.channel.id);
  const effectiveLlm =
    context.textCredentialSource === "personal" || context.isUserImpersonation
      ? personalBase.llm
      : (personalBase.persona_llm ?? channelLlmOverride ?? personalBase.llm);
  const overriddenLlm = incoming.llmOverrideCodename
    ? { ...effectiveLlm, llm_codename: incoming.llmOverrideCodename }
    : effectiveLlm;
  let state: TomoriState = { ...personalBase, llm: overriddenLlm };

  if (overriddenLlm.llm_provider.toLowerCase() !== personalBase.llm.llm_provider.toLowerCase()) {
    state = await applySavedProviderConfig(state, overriddenLlm.llm_provider);
  }

  return state;
}

async function createFallbackAttempt(
  primaryState: TomoriState,
  entry: FallbackEntry,
  fallbackIndex: number,
  disableAllTools: boolean,
): Promise<GenerationAttempt | null> {
  if (entry.kind === "custom_endpoint") {
    const customProviderName = `custom:s${primaryState.server_id}:${entry.endpoint.label}`;
    const savedConfig = await llmProviderRepo.loadSavedProviderConfig(primaryState.server_id, customProviderName);
    if (!savedConfig?.api_key) {
      log.warn(`Skipping custom endpoint fallback ${entry.endpoint.label}: no saved key.`);
      return null;
    }

    const state: TomoriState = {
      ...primaryState,
      config: {
        ...primaryState.config,
        api_key: savedConfig.api_key,
        key_version: savedConfig.key_version ?? 1,
        custom_endpoint_url: entry.endpoint.endpoint_url,
        custom_model_name: entry.endpoint.model_name ?? null,
      },
      llm: {
        ...primaryState.llm,
        llm_codename: entry.endpoint.model_name ?? entry.endpoint.label,
        llm_provider: "custom",
        has_tools: entry.endpoint.has_tools,
        sees_images: entry.endpoint.sees_images,
        sees_videos: entry.endpoint.sees_videos,
        supports_structoutput: entry.endpoint.supports_structoutput,
      },
    };
    return await createAttempt(`fallback ${fallbackIndex}: ${entry.endpoint.label}`, state, "custom", disableAllTools);
  }

  let state: TomoriState = { ...primaryState, llm: entry.model };
  if (entry.model.llm_provider.toLowerCase() !== primaryState.llm.llm_provider.toLowerCase()) {
    state = await applySavedProviderConfig(state, entry.model.llm_provider);
  }
  return await createAttempt(
    `fallback ${fallbackIndex}: ${entry.model.llm_codename}`,
    state,
    undefined,
    disableAllTools,
  );
}

async function createAttempt(
  label: string,
  tomoriState: TomoriState,
  forcedProviderName?: string,
  disableAllTools = false,
): Promise<GenerationAttempt> {
  const effectiveState = applyDeliberateToolKillSwitch(tomoriState, disableAllTools);

  const provider = forcedProviderName
    ? await ProviderFactory.getProviderByName(forcedProviderName)
    : await getProviderForTomori(effectiveState);

  // 1. Try the rotation pool first; fall back to the server's own encrypted key.
  const rotationSelection = await selectApiKey(effectiveState);
  const apiKey = rotationSelection ? rotationSelection.apiKey : await resolveApiKey(effectiveState);
  const rotationKeyId = rotationSelection?.rotationKeyId ?? null;

  const providerConfig = await provider.createConfig(effectiveState, apiKey);

  return {
    label,
    tomoriState: effectiveState,
    provider,
    providerConfig,
    successModel: effectiveState.llm,
    rotationKeyId,
  };
}

async function resolveApiKey(tomoriState: TomoriState): Promise<string> {
  const encryptedKey = tomoriState.config.api_key;
  if (!encryptedKey) {
    throw new Error("API key is not configured for the selected text provider.");
  }

  return await decryptApiKey(encryptedKey, tomoriState.config.key_version || 1);
}

async function applySavedProviderConfig(tomoriState: TomoriState, providerName: string): Promise<TomoriState> {
  const savedConfig = await llmProviderRepo.loadSavedProviderConfig(tomoriState.server_id, providerName.toLowerCase());
  if (!savedConfig?.api_key) {
    throw new Error(`No saved credentials found for provider ${providerName}.`);
  }

  return {
    ...tomoriState,
    config: {
      ...tomoriState.config,
      api_key: savedConfig.api_key,
      key_version: savedConfig.key_version ?? 1,
      llm_temperature: savedConfig.llm_temperature ?? tomoriState.config.llm_temperature,
      llm_top_p: savedConfig.llm_top_p ?? tomoriState.config.llm_top_p,
      llm_top_k: savedConfig.llm_top_k ?? tomoriState.config.llm_top_k,
      llm_frequency_penalty: savedConfig.llm_frequency_penalty ?? tomoriState.config.llm_frequency_penalty,
      llm_presence_penalty: savedConfig.llm_presence_penalty ?? tomoriState.config.llm_presence_penalty,
      llm_min_p: savedConfig.llm_min_p ?? tomoriState.config.llm_min_p,
      thinking_level: savedConfig.thinking_level ?? tomoriState.config.thinking_level,
      llm_disabled_params: savedConfig.llm_disabled_params ?? tomoriState.config.llm_disabled_params,
      llm_logit_biases: savedConfig.llm_logit_biases ?? tomoriState.config.llm_logit_biases,
    },
  };
}

function extractErrorCode(streamResult: StreamResult | undefined): string {
  const data = streamResult?.data;
  if (!data || typeof data !== "object") {
    return streamResult?.status ?? "unknown";
  }
  if (data instanceof Error) {
    return data.message || "error";
  }
  const record = data as Record<string, unknown>;
  return String(record.code ?? record.type ?? record.message ?? streamResult?.status ?? "unknown");
}

async function prepareProviderContextItems(args: {
  contextItems: StructuredContextItem[];
  tomoriState: TomoriState;
  serverDiscId: string;
  emptyResponseFinishReason: string | null | undefined;
  retryCount: number;
}): Promise<StructuredContextItem[]> {
  let contextItems = await applyProviderContextTruncation(args.contextItems, args.tomoriState, args.serverDiscId);
  if (
    shouldApplyLengthEmptyRetryTrim(args.tomoriState.llm.llm_provider, args.emptyResponseFinishReason, args.retryCount)
  ) {
    const requestedPairDrops = OPENROUTER_LENGTH_EMPTY_RETRY_DROP_PAIRS * args.retryCount;
    const { truncated, historyPairsDropped } = dropOldestHistoryExchangePairs(contextItems, requestedPairDrops);
    if (historyPairsDropped > 0) {
      log.warn(
        `OpenRouter length-empty retry trimming: dropped ${historyPairsDropped}/${requestedPairDrops} oldest history exchange pair(s) on retry ${args.retryCount}.`,
      );
      contextItems = truncated;
    }
  }
  return contextItems;
}

function dropOldestHistoryExchangePairs(
  contextItems: StructuredContextItem[],
  pairsToDrop: number,
): { truncated: StructuredContextItem[]; historyPairsDropped: number } {
  if (pairsToDrop <= 0) {
    return { truncated: contextItems, historyPairsDropped: 0 };
  }

  const items = [...contextItems];
  let historyPairsDropped = 0;
  while (historyPairsDropped < pairsToDrop) {
    const oldestHistoryIndex = items.findIndex((item) => item.metadataTag === ContextItemTag.DIALOGUE_HISTORY);
    if (oldestHistoryIndex < 0) {
      break;
    }
    const followingModelIndex = items.findIndex(
      (item, index) =>
        index > oldestHistoryIndex && item.metadataTag === ContextItemTag.DIALOGUE_HISTORY && item.role === "model",
    );
    if (followingModelIndex > oldestHistoryIndex) {
      items.splice(oldestHistoryIndex, followingModelIndex - oldestHistoryIndex + 1);
    } else {
      items.splice(oldestHistoryIndex, 1);
    }
    historyPairsDropped++;
  }

  return { truncated: items, historyPairsDropped };
}

async function applyProviderContextTruncation(
  contextItems: StructuredContextItem[],
  tomoriState: TomoriState,
  serverDiscId: string,
): Promise<StructuredContextItem[]> {
  if (
    providerIsApiFamily(tomoriState.llm.llm_provider, "openrouter") &&
    tomoriState.llm.llm_codename !== "other-model" &&
    isOpenRouterCapabilityCacheReady()
  ) {
    const tokenLimits = getOpenRouterTokenLimits(tomoriState.llm.llm_codename);
    const openrouterTruncationOutputCap = Number.parseInt(process.env.OPENROUTER_MAX_OUTPUT_TOKENS || "8192", 10);
    if (tokenLimits && tokenLimits.contextLength > 0 && tokenLimits.maxCompletionTokens) {
      const truncationMaxCompletionTokens = Math.min(tokenLimits.maxCompletionTokens, openrouterTruncationOutputCap);
      const { truncated, historyPairsDropped, sampleItemsDropped, totalDropped } = truncateDialogueHistory(
        contextItems,
        tokenLimits.contextLength,
        truncationMaxCompletionTokens,
      );
      if (totalDropped > 0) {
        log.warn(
          `History truncation: dropped ${historyPairsDropped} history exchange pair(s) and ${sampleItemsDropped} sample dialogue item(s) for ${tomoriState.llm.llm_codename} to preserve output budget`,
        );
        return truncated;
      }
    }
    return contextItems;
  }

  if (providerIsApiFamily(tomoriState.llm.llm_provider, "google-genai")) {
    const tokenLimits = getGeminiTokenLimits(tomoriState.llm.llm_codename);
    if (tokenLimits && tokenLimits.contextLength > 0 && tokenLimits.maxCompletionTokens) {
      const { truncated, historyPairsDropped, sampleItemsDropped, totalDropped } = truncateDialogueHistory(
        contextItems,
        tokenLimits.contextLength,
        tokenLimits.maxCompletionTokens,
      );
      if (totalDropped > 0) {
        log.warn(
          `History truncation: dropped ${historyPairsDropped} history exchange pair(s) and ${sampleItemsDropped} sample dialogue item(s) for ${tomoriState.llm.llm_codename} to preserve output budget`,
        );
        return truncated;
      }
    }
    return contextItems;
  }

  if (providerIsApiFamily(tomoriState.llm.llm_provider, "novelai")) {
    let naiSubscriptionTokens = getCachedContextTokens(serverDiscId);
    if (naiSubscriptionTokens === undefined && tomoriState.config.api_key) {
      try {
        const tempKey = await decryptApiKey(tomoriState.config.api_key, tomoriState.config.key_version || 1);
        naiSubscriptionTokens = await refreshNovelAISubscription(serverDiscId, tempKey);
      } catch (error) {
        log.warn("Failed to refresh NovelAI subscription for context truncation; using default token limits.", error);
      }
    }
    const tokenLimits = getNovelAITokenLimits(tomoriState.llm.llm_codename, naiSubscriptionTokens);
    if (tokenLimits && tokenLimits.contextLength > 0 && tokenLimits.maxCompletionTokens) {
      const { truncated, historyPairsDropped, sampleItemsDropped, totalDropped } = truncateDialogueHistory(
        contextItems,
        tokenLimits.contextLength,
        tokenLimits.maxCompletionTokens,
      );
      if (totalDropped > 0) {
        log.warn(
          `History truncation: dropped ${historyPairsDropped} history exchange pair(s) and ${sampleItemsDropped} sample dialogue item(s) for ${tomoriState.llm.llm_codename} to preserve output budget`,
        );
        return truncated;
      }
    }
  }

  return contextItems;
}

function shouldApplyLengthEmptyRetryTrim(
  providerName: string,
  emptyResponseFinishReason: string | null | undefined,
  retryCount: number,
): boolean {
  return emptyResponseFinishReason === "length" && retryCount > 0 && providerIsApiFamily(providerName, "openrouter");
}

function parseIntegerEnvFlag(value: string | undefined, defaultValue: number, minimum: number): number {
  if (typeof value !== "string") return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return Math.max(minimum, parsed);
}
