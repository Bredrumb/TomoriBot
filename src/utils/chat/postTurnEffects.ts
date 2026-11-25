import { persistMemoryRecall } from "@/utils/text/context/memoryRecall";
import { buildChatPersonaPostContext } from "@/utils/chat/responseEmitter";
import { PrivacyLevel } from "@/types/db/schema";
import { ContextItemTag } from "@/types/misc/context";
import { recordLastReplyUsage } from "@/utils/cache/lastReplyUsageCache";
import { incrementStmTurnCounter, storeShortTermMemory } from "@/utils/cache/shortTermMemoryCache";
import { withProviderOptionCopy } from "@/utils/provider/providerOptionRegistry";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { resolveProviderErrorFooter } from "@/utils/discord/stream/errorUi";
import { hasThoughtLogContent, sendAttributionOnlyEmbed, sendThoughtLogEmbed } from "@/utils/discord/thoughtLog";
import { ColorCode, log } from "@/utils/misc/logger";
import { getLlmDisplayName } from "@/utils/provider/modelDisplay";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { releaseTextQuotaForTrigger, textQuotaTriggerStates } from "@/utils/chat/textQuotaState";
import { localizer } from "@/utils/text/localizer";
import { normalizeCustomEmojisForLlm } from "@/utils/text/processors/mentionProcessor";
import { MAX_EMPTY_RESPONSE_RETRIES } from "@/utils/discord/stream/constants";
import { channelLocks, queuePersonaJobsAtFront } from "@/utils/chat/channelQueue";
import { getMatchLimit } from "@/utils/chat/personaQueue";
import { getTriggerFirstMatchIndexInContent } from "@/utils/chat/triggerProcessor";
import {
  buildSpeakerGuardRetryDirective,
  mergeInjectedContextItems,
  stripInjectedContextAnnotations,
} from "@/utils/chat/contextAnnotations";
import {
  getSelfReplyChainState,
  setLastRespondedPersona,
  updateSelfReplyChainState,
} from "@/utils/chat/selfReplyState";
import { statRepository } from "@/utils/db/repositories";
import { metricSampleRepository, type MetricFields } from "@/utils/db/repositories/MetricSampleRepository";
import { charsToTokensText, estimateContextItemsTokens, sumTurnUsage } from "@/utils/text/tokenEstimate";
import type { ChatIncoming, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import type { TurnUsageEntry } from "@/utils/chat/responseReview";
import { recordReunionPresence } from "@/utils/chat/reunionPresence";
import { invalidateInactiveNaturalNudgeGates } from "@/modules/natural-nudges/runtime/configCache";
import { discordPresenceRetention } from "@/utils/cache/discordPresenceRetention";

// Server-emoji resolves are counted here (capture 1 = name) because cleanLLMOutput converts valid :name: shortcodes
// to Discord tags and drops unresolved ones.
const RESOLVED_CUSTOM_EMOJI_RE = /<a?:([A-Za-z0-9_~]+):\d+>/g;

const EMPTY_RESPONSE_RETRY_DELAY_MS = 1000;

export async function runPostTurnEffects(context: ChatTurnContext, result: GenerationTurnResult): Promise<void> {
  if (context.memoryRecall) void persistMemoryRecall(context.memoryRecall);
  // Empty-response retries rebuild context recursively, so release or commit the
  // claim before that retry tries to acquire it again.
  await recordReunionPresence(context.reunionPresence, result);
  if (!context.isDMChannel && (result.personaResponses.length > 0 || result.toolResponseDelivered === true)) {
    discordPresenceRetention.retain(context.serverDiscId, context.userDiscId);
  }
  await maybeScheduleEmptyResponseRetry(context, result);
  await settleTextQuota(context, result);
  updateSelfReplyBookkeeping(context, result);
  queueNaturalNudgeReplies(context, result);
  await writeShortTermMemory(context, result);
  await emitThoughtLog(context, result);
  scheduleBoomerangFollowUp(context);
  rememberLastReplyUsage(context, result);
  // Fire-and-forget so stat tracking never adds latency to the response path.
  void recordUsageStats(context, result);
}

// Only the first request's input tokens are saved for /context because later tool-loop calls include tool results
// that /context does not rebuild.
function rememberLastReplyUsage(context: ChatTurnContext, result: GenerationTurnResult): void {
  if (result.personaResponses.length === 0 || context.isDMChannel) return;
  const personaId = context.currentPersona.persona_id;
  const inputTokens = result.streamResults.find((stream) => stream.usage)?.usage?.inputTokens ?? 0;
  if (typeof personaId !== "number" || inputTokens <= 0) return;
  recordLastReplyUsage(context.channel.id, personaId, {
    inputTokens,
    modelCodename: context.tomoriState.llm.llm_codename,
  });
}

async function recordUsageStats(context: ChatTurnContext, result: GenerationTurnResult): Promise<void> {
  const accountedUsage = sumTurnUsage(result.usageEntries ?? result.streamResults);
  const turnUsage = accountedUsage ?? {
    inputTokens: estimateContextItemsTokens(context.contextItems),
    outputTokens: result.personaResponses.reduce(
      (total, response) => total + charsToTokensText(response.text.length),
      0,
    ),
  };
  const fields: MetricFields = {
    provider: context.tomoriState.llm.llm_provider,
    model: context.tomoriState.llm.llm_codename,
    source:
      accountedUsage && !result.usageEntries?.some((entry) => entry.source === "estimated") ? "measured" : "estimated",
    input_tokens: turnUsage.inputTokens,
    cache_read_tokens: accountedUsage?.cacheReadTokens ?? "unknown",
    cache_write_tokens: accountedUsage?.cacheWriteTokens ?? "unknown",
    output_tokens: turnUsage.outputTokens,
  };
  if (accountedUsage?.costUsd !== undefined) fields.cost_usd = accountedUsage.costUsd;
  log.metric("turn_usage", fields);
  void metricSampleRepository.recordSample("turn_usage", fields);

  // Actual spend survives cancellation and discarded drafts; dialogue metrics require delivery.
  if (!context.isDMChannel && context.tomoriState.server_id && context.triggererUserId && result.usageEntries) {
    const lineageId = context.currentPersona.persona_lineage_id ?? 0;
    const serverId = context.tomoriState.server_id;
    const userId = context.triggererUserId;
    const recordEntry = (entry: TurnUsageEntry) => {
      for (const [direction, delta] of [
        ["in", entry.usage.inputTokens],
        ["out", entry.usage.outputTokens],
      ] as const) {
        if (delta <= 0) continue;
        statRepository.recordStat({
          serverId,
          userId,
          lineageId,
          metric: direction === "in" ? "tokens_in" : "tokens_out",
          metricKey: entry.model,
          delta,
        });
        if (entry.kind === "reviewer")
          statRepository.recordStat({
            serverId,
            userId,
            lineageId,
            metric: direction === "in" ? "reviewer_tokens_in" : "reviewer_tokens_out",
            metricKey: entry.model,
            delta,
          });
      }
      for (const [metric, delta] of [
        ["cache_read_tokens", entry.usage.cacheReadTokens],
        ["cache_write_tokens", entry.usage.cacheWriteTokens],
      ] as const) {
        if (delta === undefined || delta <= 0) continue;
        statRepository.recordStat({ serverId, userId, lineageId, metric, metricKey: entry.model, delta });
      }
    };
    for (const entry of result.usageEntries) recordEntry(entry);
    if (context.responseReview?.usage === result.usageEntries) context.responseReview.usageRecorder = recordEntry;
  }
  if (result.personaResponses.length === 0 || context.isDMChannel) return;
  const serverId = context.tomoriState.server_id;
  if (!serverId) return;

  try {
    // Triggerer's internal users FK is resolved during turn planning so stat recording needs no per-turn DB lookup.
    const userId = context.triggererUserId;
    if (!userId) return;

    const hour = String(new Date().getUTCHours());
    const modelCodename = context.tomoriState.llm.llm_codename;
    const primaryLineage = context.currentPersona.persona_lineage_id ?? context.tomoriState.persona_lineage_id ?? 0;

    // Record model_used and active_hour once per turn on primaryLineage because active_hour sums across lineages
    // at read time.
    statRepository.recordStat({
      serverId,
      userId,
      lineageId: primaryLineage,
      metric: "model_used",
      metricKey: modelCodename,
    });
    // Generated nudges and persona reactions must not sustain their own heat or learned waking hours.
    const incoming = context.turn.lockedTurn.admission.incoming;
    const recordsEngagement = !incoming.naturalNudge && incoming.conditioningInteraction?.actorType !== "persona";
    if (recordsEngagement) {
      statRepository.recordStat({
        serverId,
        userId,
        lineageId: primaryLineage,
        metric: "active_hour",
        metricKey: hour,
      });
    }
    // Automatic Natural Nudges channels come from human-triggered turns, so a random trigger cannot
    // keep its own channel eligible.
    if (recordsEngagement && !incoming.borrowsTriggerMessage) {
      statRepository.recordStat({
        serverId,
        userId,
        metric: "channel_turn",
        metricKey: context.channel.isThread() ? (context.channel.parentId ?? context.channel.id) : context.channel.id,
      });
    }

    // Message counts are keyed to each response's own lineage so multi-persona affinity tracks every speaker
    // individually.
    const lineages = new Set<number>();
    let estimatedOutputTokens = 0;
    for (const response of result.personaResponses) {
      lineages.add(response.personaLineageId ?? primaryLineage);

      if (response.text) estimatedOutputTokens += charsToTokensText(response.text.length);
    }
    if (recordsEngagement) {
      for (const lineageId of lineages) {
        statRepository.recordStat({
          serverId,
          userId,
          lineageId,
          metric: "message_sent",
          metricKey: incoming.conditioningInteraction?.type,
        });
      }
    }

    // Read emoji uses from stream.accumulatedText rather than personaResponses[].text because accumulatedText only
    // records text accepted by Discord (excluding drained Scene Metadata).
    const emojiCounts = new Map<string, number>();
    for (const stream of result.streamResults) {
      for (const match of (stream.accumulatedText ?? "").matchAll(RESOLVED_CUSTOM_EMOJI_RE)) {
        const name = match[1];
        emojiCounts.set(name, (emojiCounts.get(name) ?? 0) + 1);
      }
    }
    for (const [name, count] of emojiCounts) {
      statRepository.recordStat({
        serverId,
        userId,
        lineageId: primaryLineage,
        metric: "emoji_used",
        metricKey: name,
        delta: count,
      });
    }
    statRepository.recordStat({ serverId, userId, lineageId: primaryLineage, metric: "text_generated" });

    // Record target ID in metric_key while keeping actor user_id and primaryLineage so impersonation stays
    // queryable without altering card reads.
    if (context.isUserImpersonation && context.impersonatedUserId) {
      statRepository.recordStat({
        serverId,
        userId,
        lineageId: primaryLineage,
        metric: "user_impersonation_triggered",
        metricKey: context.impersonatedUserId,
      });
    }

    // Record input and output token counts separately when usageEntries was absent so read-time pricing applies
    // exact directional rates.
    const realUsage = sumTurnUsage(result.streamResults);
    const inputTokens = result.usageEntries
      ? 0
      : realUsage
        ? realUsage.inputTokens
        : estimateContextItemsTokens(context.contextItems);
    const outputTokens = result.usageEntries ? 0 : realUsage ? realUsage.outputTokens : estimatedOutputTokens;
    if (realUsage) {
      log.info(`Stats: recording real provider usage (in=${inputTokens}, out=${outputTokens}) for ${modelCodename}`);
    }
    if (inputTokens > 0) {
      statRepository.recordStat({
        serverId,
        userId,
        lineageId: primaryLineage,
        metric: "tokens_in",
        metricKey: modelCodename,
        delta: inputTokens,
      });
    }
    if (outputTokens > 0) {
      statRepository.recordStat({
        serverId,
        userId,
        lineageId: primaryLineage,
        metric: "tokens_out",
        metricKey: modelCodename,
        delta: outputTokens,
      });
    }
    if (!result.usageEntries && realUsage) {
      for (const [metric, delta] of [
        ["cache_read_tokens", realUsage.cacheReadTokens],
        ["cache_write_tokens", realUsage.cacheWriteTokens],
      ] as const) {
        if (delta === undefined || delta <= 0) continue;
        statRepository.recordStat({
          serverId,
          userId,
          lineageId: primaryLineage,
          metric,
          metricKey: modelCodename,
          delta,
        });
      }
    }

    // Exclude identity sprites from sprite_emotion because getEmotionBreakdown unions it directly as an emotion
    // metric without joining persona tables.
    const spriteCounts = new Map<string, number>();
    const spriteEmotionCounts = new Map<string, number>();
    for (const stream of result.streamResults) {
      for (const entry of stream.spritesShown ?? []) {
        spriteCounts.set(entry.name, (spriteCounts.get(entry.name) ?? 0) + 1);
        if (!entry.isIdentity) {
          spriteEmotionCounts.set(entry.name, (spriteEmotionCounts.get(entry.name) ?? 0) + 1);
        }
      }
    }
    for (const [spriteName, count] of spriteCounts) {
      statRepository.recordStat({
        serverId,
        userId,
        lineageId: primaryLineage,
        metric: "sprite_shown",
        metricKey: spriteName,
        delta: count,
      });
    }
    for (const [spriteName, count] of spriteEmotionCounts) {
      statRepository.recordStat({
        serverId,
        userId,
        lineageId: primaryLineage,
        metric: "sprite_emotion",
        metricKey: spriteName,
        delta: count,
      });
    }
    // An in-flight flush can predate this turn's stats, so the following snapshot must finish before eligibility
    // refreshes.
    if (incoming.isDirectChat && (await statRepository.flush()) && (await statRepository.flush())) {
      invalidateInactiveNaturalNudgeGates(serverId);
    }
  } catch (error) {
    log.warn("Failed to record usage stats for turn", error);
  }
}

async function maybeScheduleEmptyResponseRetry(context: ChatTurnContext, result: GenerationTurnResult): Promise<void> {
  const incoming = context.turn.lockedTurn.admission.incoming;
  if (result.status !== "empty_response") {
    return;
  }

  const lastStreamResult = result.streamResults.at(-1);
  const streamResultData =
    lastStreamResult?.data && typeof lastStreamResult.data === "object"
      ? (lastStreamResult.data as Record<string, unknown>)
      : undefined;
  const terminalFinishReason =
    typeof streamResultData?.finishReason === "string" ? streamResultData.finishReason : undefined;

  if (!shouldRetryEmptyResponse(incoming, result)) {
    log.warn(`Empty response after ${MAX_EMPTY_RESPONSE_RETRIES} retries.`);

    if (context.isUserImpersonation) {
      throw new Error("User impersonation returned an empty response.");
    }

    if (!context.shouldSurfaceUserErrors) {
      log.warn(`Suppressing empty response embed for non-deliberate chat turn ${context.message.id}`);
      return;
    }

    const isPersonal = context.textCredentialSource === "personal";
    const tipKeys = await withProviderOptionCopy(
      [
        "genai.tips.refresh_context",
        ...(isPersonal
          ? ["genai.tips.disable_personal_text_override", "genai.tips.switch_model_provider_personal"]
          : ["genai.tips.switch_model_provider"]),
      ],
      {
        surface: "recovery",
        managedProvider: context.usageContext?.credentialProvider ?? null,
        userDiscId: context.userDiscId,
        serverId: context.tomoriState.server_id,
        credentialScope:
          context.usageContext?.credentialScope ??
          (context.textCredentialSource === "personal"
            ? "personal"
            : context.textCredentialSource === "server"
              ? "server"
              : undefined),
      },
    );

    await sendStandardEmbed(
      context.channel as Parameters<typeof sendStandardEmbed>[0],
      context.locale,
      {
        titleKey: "genai.empty_response_title",
        descriptionKey: "genai.empty_response_description",
        color: ColorCode.WARN,
        tipKeys,
        ...resolveProviderErrorFooter({
          providerName: context.tomoriState.llm.llm_provider,
          textCredentialSource: context.textCredentialSource,
          isDM: context.isDMChannel,
        }),
      },
      buildChatPersonaPostContext(context),
    ).catch((error) => log.warn("Failed to send empty response embed to channel", error));
    return;
  }

  log.info(
    `Empty response detected (attempt ${incoming.retryCount + 1}/${MAX_EMPTY_RESPONSE_RETRIES + 1}). ` +
      `finishReason=${terminalFinishReason ?? "unknown"}. Retrying with fresh context in ${EMPTY_RESPONSE_RETRY_DELAY_MS}ms...`,
  );
  await new Promise((resolve) => setTimeout(resolve, EMPTY_RESPONSE_RETRY_DELAY_MS));
  const emptyResponseReason =
    typeof streamResultData?.emptyResponseReason === "string" ? streamResultData.emptyResponseReason : undefined;
  const speakerGuardRetryDirective =
    emptyResponseReason === "speaker_guard"
      ? buildSpeakerGuardRetryDirective(
          context.currentPersona.persona_nickname ?? context.tomoriState.persona_nickname,
          context.contextItems.some((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_PERSONA_SPRITES),
        )
      : null;
  const retryInjectedContextItems = mergeInjectedContextItems(
    incoming.injectedContextItems,
    speakerGuardRetryDirective,
  );
  if (emptyResponseReason === "speaker_guard") {
    log.info(
      `Empty response retry will inject active-speaker guidance for persona "${context.currentPersona.persona_nickname ?? context.tomoriState.persona_nickname ?? "Tomori"}".`,
    );
  }

  const { tomoriChat } = await import("@/events/messageCreate/tomoriChat");
  await tomoriChat({
    client: context.client,
    message: context.message,
    isFromQueue: context.isFromQueue,
    isManuallyTriggered: true,
    isDirectChat: incoming.isDirectChat,
    forceReason: incoming.forceReason,
    reasoningQuery: incoming.reasoningQuery,
    llmOverrideCodename: incoming.llmOverrideCodename,
    isStopResponse: incoming.isStopResponse,
    retryCount: incoming.retryCount + 1,
    skipLock: true,
    reminderRecipientID: incoming.reminderRecipientID,
    reminderData: incoming.reminderData,
    selectedPersonaId: context.currentPersona.persona_id ?? incoming.selectedPersonaId,
    triggeredPersonaIds: context.turn.triggeredPersonaIds,
    isPersonaJob: context.isPersonaJob,
    isUserImpersonation: context.isUserImpersonation,
    impersonatedUserId: context.impersonatedUserId,
    textQuotaSource: incoming.textQuotaSource,
    textQuotaTriggerKey: context.textQuotaTriggerKey,
    textQuotaUserDiscId: incoming.textQuotaUserDiscId,
    manualSystemPrompt: incoming.manualSystemPrompt,
    manualPrefill: incoming.manualPrefill,
    emptyResponseFinishReason: streamResultData?.finishReason === "length" ? "length" : undefined,
    shouldSurfaceUserErrors: context.shouldSurfaceUserErrors,
    injectedContextItems: retryInjectedContextItems,
    forcedMentions: incoming.forcedMentions,
    manualTriggerInvoker: incoming.manualTriggerInvoker,
    systemTriggerIdentity: incoming.systemTriggerIdentity,
    manualStreamingContextOverrides: incoming.manualStreamingContextOverrides,
    sceneTurn: incoming.sceneTurn,
    naturalNudge: incoming.naturalNudge,
    conditioningInteraction: incoming.conditioningInteraction,
    borrowsTriggerMessage: incoming.borrowsTriggerMessage,
    suppressSelfReply: incoming.suppressSelfReply,
    carriedExpressionDelivery: context.currentPersona.persona_id
      ? { personaId: context.currentPersona.persona_id, state: context.expressionDelivery }
      : undefined,
    onGenerationResult: incoming.onGenerationResult,
    onQueueDiscard: incoming.onQueueDiscard,
  });
}

export function shouldRetryEmptyResponse(incoming: ChatIncoming, result: GenerationTurnResult): boolean {
  return result.status === "empty_response" && incoming.retryCount < MAX_EMPTY_RESPONSE_RETRIES;
}

export function isDeliveredTurnResult(result: GenerationTurnResult): boolean {
  return result.status === "completed" && (result.personaResponses.length > 0 || result.toolResponseDelivered === true);
}

// A provider that answered has billed the call even when no text reached the channel, so only a turn whose every
// provider call failed gets its unit back.
function providerAnswered(result: GenerationTurnResult): boolean {
  return result.streamResults.some(
    (stream) =>
      stream.usage !== undefined ||
      stream.answeredBeforeStop === true ||
      stream.status === "completed" ||
      stream.status === "function_call" ||
      stream.status === "empty_response",
  );
}

async function settleTextQuota(context: ChatTurnContext, result: GenerationTurnResult): Promise<void> {
  if (
    context.shouldApplyTextQuota &&
    context.textQuotaState &&
    !context.textQuotaState.consumed &&
    (result.personaResponses.length > 0 || providerAnswered(result))
  ) {
    context.textQuotaState.consumed = true;
    context.textQuotaState.reservation = null;
    context.textQuotaState.reservationReleased = false;
    textQuotaTriggerStates.set(context.textQuotaTriggerKey, context.textQuotaState);
  }

  const isLastTurn = context.turn.personaIndex + 1 >= context.turn.totalPersonas;
  // A queued persona job may still spend a unit reserved during planning, so a personal-route turn
  // releases only as the last turn of a multi-persona plan, which queues no jobs.
  if (isLastTurn && (context.shouldApplyTextQuota || context.turn.totalPersonas > 1)) {
    await releaseTextQuotaForTrigger(context.textQuotaTriggerKey);
  }
}

function updateSelfReplyBookkeeping(context: ChatTurnContext, result: GenerationTurnResult): void {
  const incoming = context.turn.lockedTurn.admission.incoming;
  if (isDeliveredTurnResult(result) && incoming.naturalNudge && !incoming.isPersonaJob && !incoming.sceneTurn) {
    updateSelfReplyChainState(context.channel.id, false).triggerCount = 1;
  }
  if (result.personaResponses.length > 0 && context.currentPersona.persona_id) {
    setLastRespondedPersona(context.channel.id, context.currentPersona.persona_id);
  }

  if (
    result.personaResponses.length > 0 &&
    (!incoming.isManuallyTriggered || incoming.isPersonaJob) &&
    !incoming.sceneTurn &&
    !incoming.reminderRecipientID &&
    !incoming.reminderData?.self_reminder &&
    !incoming.isStopResponse
  ) {
    const triggerState = getSelfReplyChainState(context.channel.id);
    triggerState.triggerCount += 1;
    triggerState.updatedAt = Date.now();
    if (context.isSelfMessage) {
      triggerState.lastWasSelf = true;
    }
  }
}

function queueNaturalNudgeReplies(context: ChatTurnContext, result: GenerationTurnResult): void {
  const incoming = context.turn.lockedTurn.admission.incoming;
  if (!incoming.naturalNudge || incoming.sceneTurn || !isDeliveredTurnResult(result)) return;
  const lockEntry = channelLocks.get(context.channel.id);
  if (!lockEntry?.isLocked || lockEntry.nudgeInterrupted) return;

  const content = result.streamResults.map((stream) => stream.accumulatedText ?? "").join("\n");
  const personaJobs = context.allPersonas
    .flatMap((persona) =>
      persona.persona_id === undefined ||
      persona.persona_id === context.currentPersona.persona_id ||
      lockEntry.messageQueue.some(
        (job) =>
          job.naturalNudge &&
          job.textQuotaTriggerKey === context.textQuotaTriggerKey &&
          job.selectedPersonaId === persona.persona_id,
      )
        ? []
        : [
            {
              personaName: persona.persona_nickname,
              selectedPersonaId: persona.persona_id,
              index: Math.min(
                ...(persona.trigger_words ?? []).map((trigger) =>
                  getTriggerFirstMatchIndexInContent(content, trigger, true),
                ),
              ),
            },
          ],
    )
    .filter((match) => Number.isFinite(match.index))
    .sort((a, b) => a.index - b.index)
    .slice(0, getMatchLimit(context.tomoriState))
    .map(({ personaName, selectedPersonaId }) => ({ personaName, selectedPersonaId }));
  if (personaJobs.length === 0) return;

  queuePersonaJobsAtFront({
    lockEntry,
    message: context.message,
    personaJobs,
    triggeredPersonaIds: personaJobs.map((job) => job.selectedPersonaId),
    textQuotaSource: "system",
    textQuotaTriggerKey: context.textQuotaTriggerKey,
    textQuotaUserDiscId: incoming.textQuotaUserDiscId ?? context.userDiscId,
    shouldSurfaceUserErrors: false,
    naturalNudge: { toolNames: [], targetUserDiscId: incoming.naturalNudge.targetUserDiscId },
    borrowsTriggerMessage: true,
    manualSystemPrompt:
      "Answer the persona who addressed you in the latest conversation; the borrowed channel message is only an anchor, not a new request.",
  });
}

async function writeShortTermMemory(context: ChatTurnContext, result: GenerationTurnResult): Promise<void> {
  // Generated nudges and persona reactions cannot establish a human relationship for Ping User.
  if (
    context.turn.lockedTurn.admission.incoming.naturalNudge ||
    context.turn.lockedTurn.admission.incoming.conditioningInteraction?.actorType === "persona" ||
    context.isStopResponse ||
    context.simplifiedMessages.length === 0 ||
    context.turn.requestSnapshot.triggererPrivacyLevel === PrivacyLevel.FULL ||
    result.personaResponses.length === 0
  ) {
    return;
  }

  try {
    const messagesToStore = context.simplifiedMessages
      .filter((message) => message.authorType === "user" || message.authorType === "persona")
      .map((message) => ({
        role: message.authorType === "user" ? ("user" as const) : ("model" as const),
        // Strip turn-ephemeral [System: …] annotations (reply refs, metadata, reactions,
        // media notices) so durable STM holds clean conversational text only.
        content: stripInjectedContextAnnotations(normalizeCustomEmojisForLlm(message.content || "")),
        timestamp: Date.now(),
        speakerName: message.authorType === "persona" ? message.personaName || message.authorName : message.authorName,
      }))
      .filter((message) => message.content.length > 0);

    for (const response of result.personaResponses) {
      messagesToStore.push({
        role: "model",
        content: stripInjectedContextAnnotations(normalizeCustomEmojisForLlm(response.text)),
        timestamp: Date.now(),
        speakerName: response.personaName,
      });
    }

    const personaIds = [
      ...new Set(
        result.personaResponses.map((response) => response.personaId).filter((id): id is number => id !== undefined),
      ),
    ];
    for (const personaId of personaIds.length > 0 ? personaIds : [null]) {
      const response = result.personaResponses.find((entry) => entry.personaId === personaId);
      storeShortTermMemory(
        context.userDiscId,
        context.channel.id,
        messagesToStore,
        context.isDMChannel ? "DM" : context.serverDiscId,
        context.serverName,
        context.channelName,
        personaId,
        response?.personaLineageId ?? null,
      );
      // Advance the scope cadence counter once per bot-participation cycle rather than per raw inbound message
      // (server-shared in guilds, user-scoped in DMs).
      void incrementStmTurnCounter(
        context.channel.id,
        context.isDMChannel ? null : context.serverDiscId,
        context.isDMChannel ? context.userDiscId : null,
        personaId,
      );
    }
  } catch (error) {
    log.warn("Failed to store short-term memory, but conversation completed successfully", error);
  }
}

async function emitThoughtLog(context: ChatTurnContext, result: GenerationTurnResult): Promise<void> {
  const thoughtLog = result.thoughtLog;
  const thoughtLogChannelId = context.tomoriState.config.thought_log_channel_disc_id;
  if (!thoughtLogChannelId || context.isDMChannel) {
    return;
  }

  const personalProvider = context.textCredentialSource === "personal" ? context.personalTextProvider : undefined;
  // context.tomoriState is the attempt that answered, so this names the model actually used and reads
  // the randomizer flag of the route (server or personal) that drew it.
  const { tomoriState } = context;
  const attributionLines = [
    personalProvider
      ? localizer(context.locale, "genai.thought_log.personal_attribution", {
          user_mention: `<@${context.userDiscId}>`,
          provider: getProviderDisplayName(personalProvider),
        })
      : undefined,
    tomoriState.config.model_randomizer_enabled
      ? localizer(context.locale, "genai.thought_log.randomizer_attribution", {
          model: getLlmDisplayName(tomoriState.llm, tomoriState.config.custom_model_name),
        })
      : undefined,
  ].filter((line): line is string => Boolean(line));
  const attributionLine = attributionLines.length > 0 ? attributionLines.join("\n") : undefined;

  if (thoughtLog && hasThoughtLogContent(thoughtLog)) {
    thoughtLog.generationDurationMs = Date.now() - context.message.createdTimestamp;
    await sendThoughtLogEmbed({
      client: context.client,
      locale: context.locale,
      tomoriState: context.tomoriState,
      sourceChannel: context.channel as Parameters<typeof sendThoughtLogEmbed>[0]["sourceChannel"],
      thoughtLogChannelId,
      thoughtLog,
      owner: result.thoughtLogOwner,
      attributionLine,
    });
    return;
  }

  if (attributionLine) {
    await sendAttributionOnlyEmbed({
      client: context.client,
      locale: context.locale,
      tomoriState: context.tomoriState,
      sourceChannel: context.channel as Parameters<typeof sendAttributionOnlyEmbed>[0]["sourceChannel"],
      thoughtLogChannelId,
      title: localizer(
        context.locale,
        personalProvider
          ? "genai.thought_log.personal_attribution_title"
          : "genai.thought_log.randomizer_attribution_title",
      ),
      attributionLine,
    });
  }
}

function scheduleBoomerangFollowUp(context: ChatTurnContext): void {
  setImmediate(async () => {
    try {
      const { consumePendingBoomerang, buildBoomerangContext } = await import(
        "@/tools/functionCalls/crossChannelMessageTool"
      );
      const boomerang = consumePendingBoomerang(context.channel.id);
      if (!boomerang) return;

      const sourceChannel = await context.client.channels.fetch(boomerang.sourceChannelId).catch(() => null);
      if (!sourceChannel?.isTextBased()) {
        log.warn(`Boomerang: Source channel ${boomerang.sourceChannelId} not found or not text-based`);
        return;
      }

      const sourceMessages = await sourceChannel.messages.fetch({ limit: 1 }).catch(() => null);
      const sourceLastMessage = sourceMessages?.first();
      if (!sourceLastMessage) {
        log.warn(`Boomerang: No messages in source channel ${boomerang.sourceChannelId}`);
        return;
      }

      const { tomoriChat } = await import("@/events/messageCreate/tomoriChat");
      await tomoriChat({
        client: context.client,
        message: sourceLastMessage,
        isFromQueue: false,
        isManuallyTriggered: true,
        forceReason: false,
        isStopResponse: false,
        selectedPersonaId: boomerang.personaId,
        isPersonaJob: false,
        isUserImpersonation: boomerang.isUserImpersonation === true,
        impersonatedUserId: boomerang.impersonatedUserId,
        textQuotaSource: "system",
        manualTriggerInvoker: boomerang.manualTriggerInvoker,
        borrowsTriggerMessage: boomerang.borrowsTriggerMessage,
        suppressSelfReply: true,
        shouldSurfaceUserErrors: context.shouldSurfaceUserErrors,
        injectedContextItems: buildBoomerangContext(boomerang),
        manualStreamingContextOverrides: { disableCrossChannelMessage: true },
      });
    } catch (error) {
      log.warn("Failed to check/execute boomerang, but conversation completed successfully", error);
    }
  });
}
