import { withProviderUsageContext } from "@/utils/provider/providerUsage";
import { storedCredentialUsageContext, type StoredCredentialActivity } from "@/utils/security/apiKeyRetention";
import { createResponseReviewState } from "@/utils/chat/responseReview";
import type { FallbackEntry, LlmRow, TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { LLMProvider, ProviderConfig, StreamResult } from "@/types/provider/interfaces";
import type { ProviderError } from "@/types/stream/interfaces";
import type { ToolContext } from "@/types/tool/interfaces";
import { resolveRouteTextModel } from "@/utils/provider/textModelSelection";
import { llmProviderRepo } from "@/utils/db/repositories";
import { loadSpeechRoutingPolicy } from "@/utils/db/repositories/SpeechRepository";
import { type FallbackNoticeAttempt, sendFallbackModelUsageNotice } from "@/utils/discord/fallbackModelNotice";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import type { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { classifySendFailure } from "@/utils/discord/stream/sendFailureCache";
import { log } from "@/utils/misc/logger";
import { buildCustomProviderName } from "@/utils/provider/customProviderUtils";
import { getProviderForTomori, ProviderFactory } from "@/utils/provider/providerFactory";
import { formatProviderErrorCodeForDisplay, isStreamInterruption } from "@/utils/provider/providerErrorClassification";
import { applyProviderContextTruncation } from "@/utils/provider/contextBudget";
import { withSavedProviderConfig } from "@/utils/provider/savedProviderConfig";
import { decryptApiKey } from "@/utils/security/crypto";
import { resolveMediaForModel } from "@/utils/text/context/mediaResolver";
import {
  hasAvailableRotationKey,
  MAX_KEY_ATTEMPTS,
  recordKeyError,
  recordKeySuccess,
  selectApiKey,
} from "@/utils/security/keyRotation";
import { buildVerbatimToolDefinitionsContextItem } from "@/utils/text/context/toolDefinitions";
import {
  checkTextQuotaForAdmission,
  enforceServerTriggerCooldownForAdmission,
  shouldApplyServerTextQuota,
} from "@/utils/chat/admissionGuards";
import { hasTextQuotaBeenRefused, markTextQuotaRefused } from "@/utils/chat/textQuotaState";
import {
  recordChatAttemptStarted,
  recordChatDiagnostic,
  recordChatProviderContext,
  runWithChatDiagnosticStage,
} from "@/utils/chat/diagnosticTimeline";
import { recordChatTurnFlags } from "@/utils/chat/turnLatency";
import { applyAssistantPrefill } from "@/utils/chat/assistantPrefill";
import type { ChatResponseSink, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import {
  carryDeliveredOutput,
  type DeliveredTurnOutput,
  prependDeliveredOutput,
  providerIsApiFamily,
  runToolLoop,
  sendStreamTimeoutNotice,
} from "@/utils/chat/toolLoop";
import {
  VERBATIM_TOOL_CALLING_CONTEXT_DEPTH,
  VERBATIM_TOOL_CALLING_NUDGE,
  shouldInjectVerbatimToolCallingNudge,
} from "@/utils/tools/verbatimToolCalling";

type SendableChannel = Parameters<typeof sendStandardEmbed>[0];

type TextCredentialSource = ChatTurnContext["textCredentialSource"];

interface GenerationAttempt {
  activity?: StoredCredentialActivity;
  credentialSource: TextCredentialSource;
  label: string;
  tomoriState: TomoriState;
  provider: LLMProvider;
  providerConfig: ProviderConfig;
  successModel: LlmRow;
  rotationKeyId: number | null;
}

interface GenerationPlan {
  attempts: GenerationAttempt[];
  // Deferred until all planned attempts fail because eager resolution prepares server config and spends server text
  // quota on turns that never fall back.
  extendWithServerRoute: ((startIndex: number) => Promise<GenerationAttempt[]>) | null;
}

const OPENROUTER_LENGTH_EMPTY_RETRY_DROP_PAIRS = 2;

export async function runGenerationTurn(
  context: ChatTurnContext,
  responseSink: ChatResponseSink,
): Promise<GenerationTurnResult> {
  try {
    // Inside the try because prepare() is what creates the temporary webhook: a throw in the
    // channel-lock bookkeeping that follows creation would otherwise strand it with no cleanup.
    const responseTarget = await responseSink.prepare?.(context);
    if (responseTarget) {
      context.responseTarget = responseTarget;
    }
    context.streamingContext.deliveryMode = context.isUserImpersonation ? "user_impersonation" : "persona";
    context.streamingContext.deliveryReceipts ??= [];

    return await runGenerationAttempts(context, responseSink);
  } finally {
    // Temporary impersonation webhooks must clean up in finally because emitGenerationError rethrows and can skip
    // finalize.
    await responseSink.cleanup?.();
  }
}

async function runGenerationAttempts(
  context: ChatTurnContext,
  responseSink: ChatResponseSink,
): Promise<GenerationTurnResult> {
  try {
    context.streamingContext.deliveryState ??= { unconfirmed: false };
    context.responseReview = createResponseReviewState(context);
    context.streamingContext.holdResponseText = Boolean(context.responseReview);
    recordChatTurnFlags({ drafting: context.streamingContext.holdResponseText });
    const plan = await buildGenerationPlan(context);
    const attempts = plan.attempts;
    const failures: FallbackNoticeAttempt[] = [];
    const baseContextItems = context.contextItems;

    // Initialized once per turn so expression delivery sees text any attempt of this turn posted.
    context.streamingContext.deliveredMessageRefs ??= [];
    const carried: DeliveredTurnOutput = { text: "", details: "", streamResults: [] };
    let supersededResult: GenerationTurnResult | undefined;
    // Starting index of the server fallback route (null until used) so the receipt knows when to offer personal
    // fallback opt-out.
    let serverRouteStartIndex: number | null = null;
    let streamInterruptionRetried = false;

    for (let index = 0; index < attempts.length; index++) {
      const attempt = attempts[index];
      if (!attempt) continue;
      context.textCredentialSource = attempt.credentialSource;
      context.streamingContext.textCredentialSource = attempt.credentialSource;
      recordChatAttemptStarted(
        index + 1,
        context.textCredentialSource,
        `${attempt.successModel.llm_provider}:${attempt.successModel.llm_codename}`,
      );
      // A server route that has not been built yet still counts as a pending model, so the last
      // planned attempt keeps its errors suppressed while a later model may yet answer.
      const hasPendingModelFallback = index < attempts.length - 1 || plan.extendWithServerRoute !== null;
      context.tomoriState = attempt.tomoriState;
      const attemptContextItems = await prepareProviderContextItems({
        contextItems: providerIsApiFamily(attempt.tomoriState.llm.llm_provider, "novelai")
          ? (context.nativeContextItems ?? baseContextItems)
          : baseContextItems,
        isUserImpersonation: context.isUserImpersonation,
        userId: context.streamingContext.triggererUserId,
        tomoriState: attempt.tomoriState,
        deliberateToolAllowedNames: context.streamingContext.deliberateToolAllowedNames,
        sendsTools: (attempt.providerConfig.tools?.length ?? 0) > 0,
      });

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
        const hasFallbackKey =
          attempt.credentialSource === "server" &&
          (await hasAvailableRotationKey(attempt.tomoriState, retryExcludedKeyIds));
        setStreamUserErrorSuppression(context, hasFallbackKey || hasPendingModelFallback);
        context.streamingContext.forceModelFallback = hasPendingModelFallback;
        // The state machine withholds an interruption's error on this flag, so the retry below must
        // read the same value: one held back with no retry left would leave the user with silence.
        context.streamingContext.retryStreamInterruption =
          !streamInterruptionRetried && keyAttemptCount < MAX_KEY_ATTEMPTS;

        if (context.responseReview) {
          context.responseReview.pending = [];
        } else if (supersededResult) {
          carryDeliveredOutput(carried, supersededResult);
        }
        supersededResult = undefined;
        // Rebuilt per key attempt because a key-rotation retry continues what the failed key posted.
        const prefilled = await applyAssistantPrefill({
          contextItems: attemptContextItems,
          prefill: carried.text ? { text: carried.text, source: "continuation" } : context.assistantPrefill,
          tomoriState: attempt.tomoriState,
          forceReason: context.streamingContext.forceReason,
        });
        // applyAssistantPrefill only appends, so this is exactly the prefill turn or directive.
        const prefillItems = prefilled.contextItems.slice(attemptContextItems.length);
        context.contextItems = [
          ...(await fitProviderContextBudget({
            contextItems: attemptContextItems,
            reservedTailItems: prefillItems,
            tomoriState: attempt.tomoriState,
            emptyResponseFinishReason: context.turn.lockedTurn.admission.incoming.emptyResponseFinishReason,
            retryCount: context.turn.lockedTurn.admission.incoming.retryCount,
          })),
          ...prefillItems,
        ];
        context.streamingContext.outputPrefill = prefilled.outputPrefill;
        recordChatProviderContext(
          index + 1,
          context.contextItems.flatMap((item) =>
            item.metadataTag === ContextItemTag.DIALOGUE_HISTORY && item.messageId ? [item.messageId] : [],
          ),
        );
        result = await runWithChatDiagnosticStage({ attempt: index + 1, keyAttempt: keyAttemptCount }, () =>
          withProviderUsageContext(
            context.usageContext,
            async () =>
              runToolLoop({
                context,
                provider: attempt.provider,
                providerConfig: attempt.providerConfig,
                tomoriState: attempt.tomoriState,
              }),
            attempt.activity,
          ),
        );
        supersededResult = result;
        if (carried.text && result.status === "empty_response" && !isRetryableEmptyResponse(result)) {
          result = { ...result, status: "completed" };
        }

        if (context.streamingContext.deliveryState.unconfirmed) break;

        if (result.status !== "error") {
          // Don't credit a timed-out key as successful : a timeout is not a clean completion.
          if (result.status !== "timeout" && rotationKeyId != null) await recordKeySuccess(rotationKeyId);
          break;
        }

        // Stays on the same key because rotating would record a backend fault against a healthy key.
        if (
          context.streamingContext.retryStreamInterruption &&
          isStreamInterruption(result.streamResults.at(-1)?.data)
        ) {
          streamInterruptionRetried = true;
          log.warn(`Stream interrupted: retrying ${attempt.label} once on the same key.`);
          continue;
        }

        if (!hasFallbackKey) break;

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
        attempt.activity = nextKey.usageContext?.storedCredentialActivity;
        rotationKeyId = nextKey.rotationKeyId;
        log.warn(
          `Key rotation: retrying ${attempt.label} with key ${rotationKeyId ?? "main"} (attempt ${keyAttemptCount + 1}).`,
        );
      }

      recordChatDiagnostic({
        kind: "attempt_finished",
        ordinal: index + 1,
        status: result?.status ?? "skipped",
        keyAttempts: keyAttemptCount,
      });

      // Unreachable destinations fail identically for every key and model, so break here rather than burning fallback
      // attempts.
      if (isUnreachableDestinationResult(result)) {
        log.warn(`Abandoning ${attempt.label}: the destination channel cannot receive messages.`);
        break;
      }

      if (context.streamingContext.deliveryState.unconfirmed) {
        if (context.responseReview) context.responseReview.pending = [];
        await responseSink.finalize(result);
        return result;
      }

      const isRetryableStatus =
        (result.status === "error" || result.status === "timeout") && !isUnreachableDestinationResult(result);

      // Extend once with the self-admitting server route when planned attempts fail, stopping here if the server
      // refuses.
      if (isRetryableStatus && index === attempts.length - 1 && plan.extendWithServerRoute) {
        const extendWithServerRoute = plan.extendWithServerRoute;
        plan.extendWithServerRoute = null;
        let serverAttempts: GenerationAttempt[] = [];
        try {
          serverAttempts = await extendWithServerRoute(attempts.length);
        } catch (error) {
          // Preparing the server route is best effort, like each pool entry: a failure here leaves
          // the planned route's own failure as the turn's outcome instead of replacing it.
          log.warn("Failed to prepare the server model fallback route.", error as Error);
        }
        if (serverAttempts.length > 0) {
          serverRouteStartIndex = attempts.length;
          attempts.push(...serverAttempts);
        }
      }

      if (!isRetryableStatus || index === attempts.length - 1) {
        if (index > 0 && shouldSendFallbackNotice(context, result)) {
          log.info(`Fallback generation succeeded with ${attempt.label} after ${failures.length} failed attempt(s).`);
          await sendFallbackNoticeIfNeeded(context, attempt, failures, {
            offerPersonalFallbackOptOut: serverRouteStartIndex !== null && index >= serverRouteStartIndex,
          });
        }
        setStreamUserErrorSuppression(context, false);
        context.streamingContext.forceModelFallback = false;
        context.streamingContext.retryStreamInterruption = false;

        // Flush any withheld timeout notice here because error emission ignores timeouts and no later model remains
        // to answer.
        if (result.status === "timeout") {
          await sendDeferredTimeoutNoticeIfPending(context);
        }

        if (result.status === "error") {
          await emitStreamErrors(responseSink, result.streamResults);
        }
        // After the errors are emitted, because a carried attempt's error was suppressed for the
        // retry and must not surface as a second embed.
        const finalResult = prependDeliveredOutput(result, context, carried);
        if (context.responseReview) finalResult.usageEntries = context.responseReview.usage;
        await responseSink.finalize(finalResult);
        return finalResult;
      }

      failures.push({
        modelCodename: attempt.tomoriState.llm.llm_codename,
        errorDetail: extractErrorDetail(result.streamResults.at(-1)),
      });
    }

    const skipped: GenerationTurnResult = {
      status: "skipped",
      streamResults: [],
      personaResponses: [],
    };
    setStreamUserErrorSuppression(context, false);
    context.streamingContext.forceModelFallback = false;
    context.streamingContext.retryStreamInterruption = false;
    if (context.responseReview) skipped.usageEntries = context.responseReview.usage;
    await responseSink.finalize(skipped);
    return skipped;
  } catch (error) {
    setStreamUserErrorSuppression(context, false);
    context.streamingContext.forceModelFallback = false;
    context.streamingContext.retryStreamInterruption = false;
    await responseSink.emitError(error);
    const result: GenerationTurnResult = {
      status: "error",
      streamResults: [{ status: "error", data: error }],
      personaResponses: [],
    };
    if (context.responseReview) result.usageEntries = context.responseReview.usage;
    await responseSink.finalize(result);
    return result;
  }
}

function setStreamUserErrorSuppression(context: ChatTurnContext, temporarySuppressed: boolean): void {
  context.streamingContext.suppressUserErrors = temporarySuppressed || !context.shouldSurfaceUserErrors;
}

async function buildGenerationPlan(context: ChatTurnContext): Promise<GenerationPlan> {
  return {
    attempts: await buildPlannedRouteAttempts(context),
    extendWithServerRoute: await resolveServerRouteExtension(context),
  };
}

async function resolveServerRouteExtension(
  context: ChatTurnContext,
): Promise<((startIndex: number) => Promise<GenerationAttempt[]>) | null> {
  if (
    context.turn.lockedTurn.admission.incoming.sceneTurn?.modelSelection ||
    context.textCredentialSource !== "personal" ||
    context.isUserImpersonation
  ) {
    return null;
  }
  if (context.currentPersona.config.user_byok_mode) {
    log.info(
      `Withholding the server model fallback for user ${context.userDiscId}: server ${context.serverDiscId} requires personal providers.`,
    );
    return null;
  }
  // Only an explicit opt-out disables server fallback (default true for missing rows), checked against
  // `personalRoutingUserId` when a borrowed trigger bills another user.
  const routingUserId = context.personalRoutingUserId;
  const fallbackEnabled =
    routingUserId == null || routingUserId === context.turn.userRow.user_id
      ? context.turn.userRow.personal_server_fallback_enabled !== false
      : (await loadSpeechRoutingPolicy(context.currentPersona.server_id, routingUserId)).fallbackEnabled;
  if (!fallbackEnabled) {
    log.info(`Skipping the server model fallback for user_id ${routingUserId}: disabled in their personal config.`);
    return null;
  }
  return (startIndex) => buildServerRouteAttempts(context, startIndex);
}

async function buildPlannedRouteAttempts(context: ChatTurnContext): Promise<GenerationAttempt[]> {
  const disableAllTools = !!context.streamingContext.disableAllTools;
  const primaryState = await resolveTomoriStateForRoute(context, "planned");
  const personalUserId = context.textCredentialSource === "personal" ? (context.personalRoutingUserId ?? null) : null;
  const fallbackEntries = resolveFallbackEntries(primaryState);

  const pool: FallbackEntry[] = [{ kind: "llm", model: primaryState.llm }, ...fallbackEntries];

  applyModelRandomizer(pool, primaryState.config.model_randomizer_enabled);

  // Reusing createFallbackAttempt on the primary entry keeps index 0 equivalent to primaryState when the pool is not
  // reordered.
  const attempts: GenerationAttempt[] = [];
  for (const [index, entry] of pool.entries()) {
    try {
      const attempt = await createFallbackAttempt(
        primaryState,
        entry,
        index,
        disableAllTools,
        personalUserId,
        context.textCredentialSource,
      );
      if (!attempt) {
        // Pool entries without usable endpoints or scoped keys return null, while the primary entry shares
        // primaryState's provider so at least one attempt always survives.
        continue;
      }
      // Label index 0 "primary" for log consistency because `successModel` still records the actual drawn model.
      if (index === 0) {
        attempt.label = "primary";
      }
      attempts.push(attempt);
    } catch (error) {
      log.warn(`Skipping pool entry ${index}: failed to prepare provider config.`, error as Error);
    }
  }

  return attempts;
}

async function buildServerRouteAttempts(context: ChatTurnContext, startIndex: number): Promise<GenerationAttempt[]> {
  const disableAllTools = !!context.streamingContext.disableAllTools;
  if (!(await admitServerRoute(context))) {
    return [];
  }

  const serverState = await resolveTomoriStateForRoute(context, "server");
  const serverPool: FallbackEntry[] = [{ kind: "llm", model: serverState.llm }, ...resolveFallbackEntries(serverState)];
  applyModelRandomizer(serverPool, serverState.config.model_randomizer_enabled);

  const attempts: GenerationAttempt[] = [];
  for (const entry of serverPool) {
    const fallbackIndex = startIndex + attempts.length;
    try {
      const attempt = await createFallbackAttempt(serverState, entry, fallbackIndex, disableAllTools, null, "server");
      if (attempt) {
        attempts.push(attempt);
      }
    } catch (error) {
      log.warn(
        `Skipping server fallback pool entry ${fallbackIndex}: failed to prepare provider config.`,
        error as Error,
      );
    }
  }

  return attempts;
}

function resolveFallbackEntries(state: TomoriState): FallbackEntry[] {
  return state.fallback_chain ?? state.fallback_llms?.map((model) => ({ kind: "llm" as const, model })) ?? [];
}

function applyModelRandomizer(pool: FallbackEntry[], enabled: boolean): void {
  if (!enabled || pool.length <= 1) {
    return;
  }
  const leadIdx = Math.floor(Math.random() * pool.length);
  pool.unshift(...pool.splice(leadIdx, 1));
}

// Server cooldown and text quota were skipped during planning because the personal route paid, so borrowing a server
// fallback requires passing both here.
async function admitServerRoute(context: ChatTurnContext): Promise<boolean> {
  if (!(await admitServerRouteCooldown(context))) {
    return false;
  }
  return await admitServerRouteTextQuota(context);
}

async function admitServerRouteCooldown(context: ChatTurnContext): Promise<boolean> {
  const incoming = context.turn.lockedTurn.admission.incoming;
  // The exemptions planning applies: a stop response, a persona job that shares its group's
  // admission, and the bot's own message (same predicate that produced `turn.isSelfMessage`).
  if (incoming.isStopResponse || incoming.isPersonaJob || context.isSelfMessage) {
    return true;
  }

  const allowed = await enforceServerTriggerCooldownForAdmission({
    serverDiscId: context.serverDiscId,
    cooldownUserDiscId: context.turn.lockedTurn.admission.cooldownUserDiscId ?? context.userDiscId,
    message: context.message,
    tomoriState: context.currentPersona,
    locale: context.locale,
    notifyUser: context.shouldSurfaceUserErrors,
  });
  if (!allowed) {
    log.info(
      `Refusing the server model fallback for user ${context.userDiscId}: the server's message cooldown is active.`,
    );
  }
  return allowed;
}

async function admitServerRouteTextQuota(context: ChatTurnContext): Promise<boolean> {
  const incoming = context.turn.lockedTurn.admission.incoming;
  if (!shouldApplyServerTextQuota(incoming, context.isDMChannel)) {
    return true;
  }

  // The embed is sent once for the trigger: a refusal grants nothing, so a later persona turn in
  // the same reply would otherwise re-check and re-post the same notice.
  const alreadyReported = hasTextQuotaBeenRefused(context.textQuotaTriggerKey);

  const quota = await checkTextQuotaForAdmission({
    shouldApplyTextQuota: true,
    // A persona job normally reuses its group's admission, but a group whose earlier turns all ran
    // on personal credentials has none yet, so this turn has to take the check itself.
    isPersonaJob: false,
    triggerKey: context.textQuotaTriggerKey,
    serverId: context.currentPersona.server_id,
    userDiscId:
      incoming.textQuotaUserDiscId ?? context.turn.lockedTurn.admission.cooldownUserDiscId ?? context.userDiscId,
    channel: context.channel as SendableChannel,
    locale: context.locale,
    notifyUser: context.shouldSurfaceUserErrors && !alreadyReported,
  });

  if (!quota.allowed) {
    markTextQuotaRefused(context.textQuotaTriggerKey);
    log.info(`Refusing the server model fallback for user ${context.userDiscId}: the server text quota is exhausted.`);
    return false;
  }

  context.shouldApplyTextQuota = true;
  context.textQuotaState = quota.state;
  return true;
}

// Must run before provider.createConfig : providers eagerly attach the full tool
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

// Both data and stopReason are checked because destination failures arrive via either route, while transient errors
// keep fallback arms.
function isUnreachableDestinationResult(result: GenerationTurnResult): boolean {
  return result.streamResults.some((streamResult) => {
    const classified = classifySendFailure(streamResult.data);
    return (
      classified === "channel_gone" ||
      classified === "missing_access" ||
      streamResult.stopReason === "channel_deleted" ||
      streamResult.stopReason === "missing_access"
    );
  });
}

function isRetryableEmptyResponse(result: GenerationTurnResult): boolean {
  const streamResult = result.streamResults.at(-1);
  const data = streamResult?.data as { finishReason?: unknown; emptyResponseReason?: unknown } | undefined;
  return data?.finishReason === "length" || data?.emptyResponseReason === "speaker_guard";
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
  options: { offerPersonalFallbackOptOut: boolean },
): Promise<void> {
  if (context.isUserImpersonation || failures.length === 0 || !context.shouldSurfaceUserErrors) {
    return;
  }

  await sendFallbackModelUsageNotice({
    context: {
      channel: context.channel as ToolContext["channel"],
      client: context.client,
      message: context.message,
      tomoriState: context.currentPersona,
      locale: context.locale,
      streamContext: context.streamingContext,
      deliveryMode: context.streamingContext.deliveryMode,
      isUserImpersonation: context.isUserImpersonation,
      provider: attempt.provider.getInfo().name,
      webhook: context.responseTarget?.webhook,
      personaUsername: context.responseTarget?.personaUsername,
      personaAvatarUrl: context.responseTarget?.personaAvatarUrl,
    },
    failures,
    successModel: attempt.successModel,
    offerPersonalFallbackOptOut: options.offerPersonalFallbackOptOut,
  });
}

async function sendDeferredTimeoutNoticeIfPending(context: ChatTurnContext): Promise<void> {
  const notice = context.streamingContext.deferredTimeoutNotice;
  if (!notice) {
    return;
  }
  context.streamingContext.deferredTimeoutNotice = undefined;
  // Suppressed turns (such as auto-chat or impersonation) defer silently in the tool loop and must stay silent
  // here too.
  if (context.isUserImpersonation || !context.shouldSurfaceUserErrors) {
    return;
  }

  await sendStreamTimeoutNotice({
    channel: context.channel as SendableChannel,
    locale: context.locale,
    providerName: notice.providerName,
    textCredentialSource: context.streamingContext.textCredentialSource,
    sawStreamProgress: notice.sawStreamProgress,
    managedProvider: context.usageContext?.credentialProvider ?? null,
    credentialScope:
      context.usageContext?.credentialScope ??
      (context.textCredentialSource === "personal"
        ? "personal"
        : context.textCredentialSource === "server"
          ? "server"
          : undefined),
    userDiscId: context.userDiscId,
    serverId: context.tomoriState.server_id,
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

async function resolveTomoriStateForRoute(context: ChatTurnContext, route: "planned" | "server"): Promise<TomoriState> {
  const incoming = context.turn.lockedTurn.admission.incoming;
  const { base, llm: overriddenLlm } = await resolveRouteTextModel({
    state: context.currentPersona,
    route,
    textCredentialSource: context.textCredentialSource,
    personalRoutingUserId: context.personalRoutingUserId,
    channel: context.channel,
    isUserImpersonation: context.isUserImpersonation,
    hasSceneModelSelection: Boolean(incoming.sceneTurn?.modelSelection),
    llmOverrideCodename: incoming.llmOverrideCodename,
  });
  let state: TomoriState = { ...base, llm: overriddenLlm };

  if (overriddenLlm.llm_provider.toLowerCase() !== base.llm.llm_provider.toLowerCase()) {
    state = await applySavedProviderConfig(state, overriddenLlm.llm_provider);
  }

  return state;
}

async function createFallbackAttempt(
  primaryState: TomoriState,
  entry: FallbackEntry,
  fallbackIndex: number,
  disableAllTools: boolean,
  personalUserId: number | null,
  credentialSource: TextCredentialSource,
): Promise<GenerationAttempt | null> {
  if (entry.kind === "custom_endpoint") {
    const endpointServerId = personalUserId === null ? primaryState.server_id : null;
    if (
      (entry.endpoint.user_id ?? null) !== personalUserId ||
      (entry.endpoint.server_id ?? null) !== endpointServerId
    ) {
      return null;
    }
    if (!entry.endpoint.connection_id) {
      log.warn(`Skipping custom endpoint fallback ${entry.endpoint.label}: missing connection_id.`);
      return null;
    }
    const customProviderName = buildCustomProviderName(entry.endpoint.connection_id);
    const savedConfig =
      personalUserId !== null
        ? await llmProviderRepo.loadUserSavedProviderConfig(personalUserId, customProviderName)
        : await llmProviderRepo.loadSavedProviderConfig(primaryState.server_id, customProviderName);
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
        custom_num_ctx: entry.endpoint.num_ctx ?? null,
      },
      llm: {
        ...primaryState.llm,
        llm_id: entry.endpoint.model_ref_id ?? primaryState.llm.llm_id,
        llm_codename: entry.endpoint.model_name ?? entry.endpoint.label,
        llm_provider: customProviderName,
        has_tools: entry.endpoint.has_tools,
        sees_images: entry.endpoint.sees_images,
        sees_videos: entry.endpoint.sees_videos,
        supports_structoutput: entry.endpoint.supports_structoutput,
        strict_role_alternation: entry.endpoint.strict_role_alternation,
        supports_prefix_completion: entry.endpoint.supports_prefix_completion,
        supports_assistant_prefill: entry.endpoint.supports_assistant_prefill,
        verbatim_tool_calling: entry.endpoint.verbatim_tool_calling,
      },
    };
    return await createAttempt(
      `fallback ${fallbackIndex}: ${entry.endpoint.label}`,
      state,
      credentialSource,
      "custom",
      disableAllTools,
    );
  }

  let state: TomoriState = { ...primaryState, llm: entry.model };
  if (entry.model.llm_provider.toLowerCase() !== primaryState.llm.llm_provider.toLowerCase()) {
    const recredentialed = await applyCrossProviderConfig(state, entry.model.llm_provider, personalUserId);
    if (!recredentialed) {
      log.warn(
        `Skipping fallback ${entry.model.llm_codename}: no ${personalUserId ? "personal" : "server"} key saved for provider ${entry.model.llm_provider}.`,
      );
      return null;
    }
    state = recredentialed;
  }
  return await createAttempt(
    `fallback ${fallbackIndex}: ${entry.model.llm_codename}`,
    state,
    credentialSource,
    undefined,
    disableAllTools,
  );
}

async function createAttempt(
  label: string,
  tomoriState: TomoriState,
  credentialSource: TextCredentialSource,
  forcedProviderName?: string,
  disableAllTools = false,
): Promise<GenerationAttempt> {
  const effectiveState = applyDeliberateToolKillSwitch(tomoriState, disableAllTools);

  const provider = forcedProviderName
    ? await ProviderFactory.getProviderByName(forcedProviderName)
    : await getProviderForTomori(effectiveState);

  const rotationSelection = credentialSource === "server" ? await selectApiKey(effectiveState) : null;
  const apiKey = rotationSelection ? rotationSelection.apiKey : await resolveApiKey(effectiveState);
  const rotationKeyId = rotationSelection?.rotationKeyId ?? null;

  const providerConfig = await provider.createConfig(effectiveState, apiKey);
  const ciphertext = effectiveState.config.api_key;

  return {
    credentialSource,
    activity:
      effectiveState.llm.llm_provider.toLowerCase() === "vertex"
        ? undefined
        : rotationSelection
          ? rotationSelection.usageContext?.storedCredentialActivity
          : ciphertext
            ? (await storedCredentialUsageContext(ciphertext, apiKey)).storedCredentialActivity
            : undefined,
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

// Personal-routed turns check only the user's saved providers and return null when absent, so fallback chains cannot
// silently spend the server key.
async function applyCrossProviderConfig(
  tomoriState: TomoriState,
  providerName: string,
  personalUserId: number | null,
): Promise<TomoriState | null> {
  const provider = providerName.toLowerCase();
  const savedConfig = personalUserId
    ? await llmProviderRepo.loadUserSavedProviderConfig(personalUserId, provider)
    : await llmProviderRepo.loadSavedProviderConfig(tomoriState.server_id, provider);

  return savedConfig?.api_key ? withSavedProviderConfig(tomoriState, savedConfig) : null;
}

async function applySavedProviderConfig(tomoriState: TomoriState, providerName: string): Promise<TomoriState> {
  const state = await applyCrossProviderConfig(tomoriState, providerName, null);
  if (!state) {
    throw new Error(`No saved credentials found for provider ${providerName}.`);
  }

  return state;
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

// Public fallback notices carry only classified codes because upstream error text can echo request headers and is
// read back into model context.
function extractErrorDetail(streamResult: StreamResult | undefined): string {
  const data = streamResult?.data;
  if (data && typeof data === "object" && !(data instanceof Error) && "type" in data) {
    const error = data as ProviderError;
    return `${formatProviderErrorCodeForDisplay(error.type)} (${formatProviderErrorCodeForDisplay(error.code)})`;
  }
  return streamResult?.status ?? "unknown";
}

async function prepareProviderContextItems(args: {
  userId?: number;
  contextItems: StructuredContextItem[];
  isUserImpersonation: boolean;
  tomoriState: TomoriState;
  deliberateToolAllowedNames: string[] | undefined;
  // Must come from the built provider config rather than tomoriState because a provider's live capability catalog can
  // withdraw tools the state still allows.
  sendsTools: boolean;
}): Promise<StructuredContextItem[]> {
  let contextItems = await resolveMediaForModel(args.contextItems, args.tomoriState, args.deliberateToolAllowedNames);
  if (!args.sendsTools) {
    contextItems = contextItems.filter((item) => !item.requiresToolCalling);
  }

  // Adapt verbatim schemas and nudge independently into new arrays per fallback attempt, because contexts can carry
  // the nudge even when no tool schemas resolve.
  const attemptNeedsVerbatim = shouldInjectVerbatimToolCallingNudge(args.tomoriState);
  if (attemptNeedsVerbatim) {
    // Native-to-custom fallback arrives without verbatim halves, so inject both tool schemas and calling-format nudge
    // or custom tool calls fail.
    if (!contextItems.some((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS)) {
      const toolItem = await buildVerbatimToolDefinitionsContextItem({
        tomoriState: args.tomoriState,
        userId: args.userId,
        contextItems,
        isUserImpersonation: args.isUserImpersonation,
      });
      if (toolItem) {
        contextItems = injectVerbatimToolDefinitionsItem(contextItems, toolItem);
      }
    }
    if (!contextItems.some(isVerbatimNudgeItem)) {
      contextItems = injectVerbatimNudgeItem(contextItems);
    }
  } else if (contextItems.some(isAnyVerbatimItem)) {
    // Custom-to-native fallback must strip both verbatim halves because native providers lack a verbatim parser and
    // conflict with text-form tool instructions.
    contextItems = stripAllVerbatimItems(contextItems);
  }
  return contextItems;
}

// Prefill items stay in reservedTailItems rather than contextItems because instruction-mode directives are user turns
// that would displace the real trigger.
async function fitProviderContextBudget(args: {
  contextItems: StructuredContextItem[];
  reservedTailItems: StructuredContextItem[];
  tomoriState: TomoriState;
  emptyResponseFinishReason: string | null | undefined;
  retryCount: number;
}): Promise<StructuredContextItem[]> {
  let contextItems = await applyProviderContextTruncation(args.contextItems, args.tomoriState, args.reservedTailItems);
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

// Matched by exact text from appendDialogueHistoryContext because ContextItemTag.CONTEXT_NOTE_INJECTION is shared
// with the user's global context note.
const VERBATIM_NUDGE_CONTEXT_TEXT = `[System: ${VERBATIM_TOOL_CALLING_NUDGE}]`;

function isVerbatimNudgeItem(item: StructuredContextItem): boolean {
  if (item.metadataTag !== ContextItemTag.CONTEXT_NOTE_INJECTION) {
    return false;
  }
  const text = item.parts.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");
  return text === VERBATIM_NUDGE_CONTEXT_TEXT;
}

function isAnyVerbatimItem(item: StructuredContextItem): boolean {
  return item.metadataTag === ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS || isVerbatimNudgeItem(item);
}

function stripAllVerbatimItems(items: StructuredContextItem[]): StructuredContextItem[] {
  return items.filter((item) => !isAnyVerbatimItem(item));
}

// Placed ahead of the first dialogue item rather than stage 07b's earlier pre-document slot because the pre-dialogue
// region cannot be re-derived here.
function injectVerbatimToolDefinitionsItem(
  items: StructuredContextItem[],
  toolItem: StructuredContextItem,
): StructuredContextItem[] {
  const firstDialogueIndex = items.findIndex((item) => item.metadataTag === ContextItemTag.DIALOGUE_HISTORY);
  const insertionIndex = firstDialogueIndex >= 0 ? firstDialogueIndex : items.length;
  return [...items.slice(0, insertionIndex), toolItem, ...items.slice(insertionIndex)];
}

// DIALOGUE_HISTORY items are counted rather than messages (unlike stage 11) because only tags remain recoverable here
// and approximate tail placement suffices.
function injectVerbatimNudgeItem(items: StructuredContextItem[]): StructuredContextItem[] {
  const nudgeItem: StructuredContextItem = {
    role: "user",
    parts: [{ type: "text", text: VERBATIM_NUDGE_CONTEXT_TEXT }],
    metadataTag: ContextItemTag.CONTEXT_NOTE_INJECTION,
  };
  const dialogueItemCount = items.filter((item) => item.metadataTag === ContextItemTag.DIALOGUE_HISTORY).length;
  const targetDialogueIndex = Math.max(0, dialogueItemCount - VERBATIM_TOOL_CALLING_CONTEXT_DEPTH);

  let dialogueSeen = 0;
  let insertionIndex = items.length;
  for (const [index, item] of items.entries()) {
    if (item.metadataTag !== ContextItemTag.DIALOGUE_HISTORY) {
      continue;
    }
    if (dialogueSeen === targetDialogueIndex) {
      insertionIndex = index;
      break;
    }
    dialogueSeen += 1;
  }
  return [...items.slice(0, insertionIndex), nudgeItem, ...items.slice(insertionIndex)];
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

function shouldApplyLengthEmptyRetryTrim(
  providerName: string,
  emptyResponseFinishReason: string | null | undefined,
  retryCount: number,
): boolean {
  return emptyResponseFinishReason === "length" && retryCount > 0 && providerIsApiFamily(providerName, "openrouter");
}
