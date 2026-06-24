import { PrivacyLevel } from "@/types/db/schema";
import { storeShortTermMemory } from "@/utils/cache/shortTermMemoryCache";
import { hasThoughtLogContent, sendAttributionOnlyEmbed, sendThoughtLogEmbed } from "@/utils/discord/thoughtLog";
import { log } from "@/utils/misc/logger";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { incrementTextQuota } from "@/utils/quota/textQuotaManager";
import { localizer } from "@/utils/text/localizer";
import { normalizeCustomEmojisForLlm } from "@/utils/text/processors/mentionProcessor";
import { suppressNextSelfReply } from "@/utils/chat/channelQueue";
import { buildSpeakerGuardRetryDirective, mergeInjectedContextItems } from "@/utils/chat/contextAnnotations";
import { getSelfReplyChainState, setLastRespondedPersona } from "@/utils/chat/selfReplyState";
import { textQuotaTriggerStates } from "@/utils/chat/textQuotaState";
import { statRepository } from "@/utils/db/repositories";
import { charsToTokensText, estimateContextItemsTokens, sumTurnUsage } from "@/utils/text/tokenEstimate";
import type { ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";

/**
 * Matches a fully-resolved Discord custom emoji tag (`<:name:id>` / `<a:name:id>`).
 * Only resolved tags appear in the final persona text (cleanLLMOutput converts a
 * successful `:name:` shortcode into this form), so counting these is exactly the
 * "successful server-emoji resolve" signal the stat plan calls for. Capture 1 = name.
 */
const RESOLVED_CUSTOM_EMOJI_RE = /<a?:([A-Za-z0-9_~]+):\d+>/g;

const MAX_EMPTY_RESPONSE_RETRIES = 2;
const EMPTY_RESPONSE_RETRY_DELAY_MS = 1000;

/**
 * Runs side effects that must happen after a generation attempt finishes.
 */
export async function runPostTurnEffects(context: ChatTurnContext, result: GenerationTurnResult): Promise<void> {
  await maybeScheduleEmptyResponseRetry(context, result);
  await consumeTextQuota(context, result);
  updateSelfReplyBookkeeping(context, result);
  await writeShortTermMemory(context, result);
  await emitThoughtLog(context, result);
  scheduleBoomerangFollowUp(context);
  // Fire-and-forget so stat tracking never adds latency to the response path.
  void recordUsageStats(context, result);
}

/**
 * Records per-turn usage stats at the single post-turn chokepoint:
 * message_sent, active_hour, model_used, tokens_in/tokens_out (estimated),
 * emoji_used, and sprite_shown. Only counts turns that actually produced a persona
 * response. DMs are skipped (stat_counters.server_id is a NOT NULL FK).
 *
 * Tokens prefer REAL provider usage when available: the orchestrator normalizes
 * each provider's reported usage onto `StreamResult.usage`, and these are summed
 * across the turn's stream segments (one per tool-loop request, each billed
 * separately). When no segment reports usage (e.g. NovelAI, or a provider that
 * omits it), tokens fall back to the CHARACTER-ESTIMATE ("Track A", shared with
 * `/tool estimate cost`): input from the built context, output from the response
 * text. The estimate over-counts dense languages (e.g. Japanese) and is rough;
 * real usage is billing-accurate. Either way the metric shape is identical
 * (`tokens_in`/`tokens_out` keyed by model id), so getEstimatedCost is unchanged.
 *
 * @param context - The completed turn's context (model + persona + server scope).
 * @param result  - The turn result; personaResponses carry the responding lineages.
 */
async function recordUsageStats(context: ChatTurnContext, result: GenerationTurnResult): Promise<void> {
  // 1. Only count turns that produced a real persona response, and not DMs.
  if (result.personaResponses.length === 0 || context.isDMChannel) return;
  const serverId = context.tomoriState.server_id;
  if (!serverId) return;

  try {
    // 2. Triggerer's internal users FK — resolved once at turn planning and
    //    carried on the context, so stat recording needs no per-turn DB lookup.
    const userId = context.triggererUserId;
    if (!userId) return;

    const hour = String(new Date().getUTCHours());
    const modelCodename = context.tomoriState.llm.llm_codename;
    const primaryLineage = context.currentPersona.persona_lineage_id ?? context.tomoriState.persona_lineage_id ?? 0;

    // 3. Once per turn: the model used and the active hour-of-day, keyed to the
    //    answering persona. (active_hour is summed across lineages at read time,
    //    so recording it once per turn keeps the hour histogram un-inflated.)
    statRepository.recordStat({
      serverId,
      userId,
      lineageId: primaryLineage,
      metric: "model_used",
      metricKey: modelCodename,
    });
    statRepository.recordStat({ serverId, userId, lineageId: primaryLineage, metric: "active_hour", metricKey: hour });

    // 4. Per responding persona: one message exchanged (drives favorite-persona
    //    affinity), plus that persona's emoji usage and output-token volume — all
    //    persona-scoped, so keyed to the response's own lineage.
    const lineages = new Set<number>();
    let estimatedOutputTokens = 0;
    for (const response of result.personaResponses) {
      const lineageId = response.personaLineageId ?? primaryLineage;
      lineages.add(lineageId);

      // 4a. Output token volume (character-estimated) for this response — used
      //     only as the fallback when the provider reported no real usage (5).
      if (response.text) estimatedOutputTokens += charsToTokensText(response.text.length);

      // 4b. Successful custom-emoji uses in the final text, one increment per
      //     occurrence. Pre-aggregated per name so repeats collapse to one UPSERT.
      const emojiCounts = new Map<string, number>();
      for (const match of response.text.matchAll(RESOLVED_CUSTOM_EMOJI_RE)) {
        const name = match[1];
        emojiCounts.set(name, (emojiCounts.get(name) ?? 0) + 1);
      }
      for (const [name, count] of emojiCounts) {
        statRepository.recordStat({
          serverId,
          userId,
          lineageId,
          metric: "emoji_used",
          metricKey: name,
          delta: count,
        });
      }
    }
    for (const lineageId of lineages) {
      statRepository.recordStat({ serverId, userId, lineageId, metric: "message_sent" });
    }
    // 4c. One text_generated increment per completed turn (persona-scoped to the answering persona).
    statRepository.recordStat({ serverId, userId, lineageId: primaryLineage, metric: "text_generated" });

    // 5. Token volume keyed by model id, attributed to the answering persona.
    //    Prefer REAL provider usage summed across the turn's stream segments
    //    (billing-accurate); fall back to the character estimate (input from the
    //    built context, output from response text) when no segment reported usage.
    //    Cost is derived at read time from catalog pricing (getEstimatedCost), so
    //    input vs output rate applies exactly per direction either way.
    const realUsage = sumTurnUsage(result.streamResults);
    const inputTokens = realUsage ? realUsage.inputTokens : estimateContextItemsTokens(context.contextItems);
    const outputTokens = realUsage ? realUsage.outputTokens : estimatedOutputTokens;
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

    // 6. Sprite deliveries surfaced from the stream (one entry per delivered sprite
    //    message). Sprites are the answering persona's own, so key on primaryLineage.
    const spriteCounts = new Map<string, number>();
    for (const stream of result.streamResults) {
      for (const spriteName of stream.spritesShown ?? []) {
        spriteCounts.set(spriteName, (spriteCounts.get(spriteName) ?? 0) + 1);
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
  } catch (error) {
    log.warn("Failed to record usage stats for turn", error);
  }
}

async function maybeScheduleEmptyResponseRetry(context: ChatTurnContext, result: GenerationTurnResult): Promise<void> {
  const incoming = context.turn.lockedTurn.admission.incoming;
  if (result.status !== "empty_response" || incoming.retryCount >= MAX_EMPTY_RESPONSE_RETRIES) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, EMPTY_RESPONSE_RETRY_DELAY_MS));
  const lastStreamResult = result.streamResults.at(-1);
  const streamResultData =
    lastStreamResult?.data && typeof lastStreamResult.data === "object"
      ? (lastStreamResult.data as Record<string, unknown>)
      : undefined;
  const emptyResponseReason =
    typeof streamResultData?.emptyResponseReason === "string" ? streamResultData.emptyResponseReason : undefined;
  const speakerGuardRetryDirective =
    emptyResponseReason === "speaker_guard"
      ? buildSpeakerGuardRetryDirective(context.currentPersona.persona_nickname ?? context.tomoriState.persona_nickname)
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
    naiContinuationPrefill: lastStreamResult?.naiContinuationPrefill,
    emptyResponseFinishReason: streamResultData?.finishReason === "length" ? "length" : undefined,
    shouldSurfaceUserErrors: context.shouldSurfaceUserErrors,
    injectedContextItems: retryInjectedContextItems,
    forcedMentions: incoming.forcedMentions,
    manualTriggerInvoker: incoming.manualTriggerInvoker,
    manualStreamingContextOverrides: incoming.manualStreamingContextOverrides,
    sceneTurn: incoming.sceneTurn,
  });
}

async function consumeTextQuota(context: ChatTurnContext, result: GenerationTurnResult): Promise<void> {
  if (
    !context.shouldApplyTextQuota ||
    !context.textQuotaState ||
    context.textQuotaState.consumed ||
    result.personaResponses.length === 0
  ) {
    return;
  }

  await incrementTextQuota(context.textQuotaState.serverId, context.textQuotaState.userDiscId);
  context.textQuotaState.consumed = true;
  textQuotaTriggerStates.set(context.textQuotaTriggerKey, context.textQuotaState);
}

function updateSelfReplyBookkeeping(context: ChatTurnContext, result: GenerationTurnResult): void {
  if (result.personaResponses.length > 0 && context.currentPersona.persona_id) {
    setLastRespondedPersona(context.channel.id, context.currentPersona.persona_id);
  }

  const incoming = context.turn.lockedTurn.admission.incoming;
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

async function writeShortTermMemory(context: ChatTurnContext, result: GenerationTurnResult): Promise<void> {
  if (
    context.isStopResponse ||
    context.simplifiedMessages.length === 0 ||
    context.turn.requestSnapshot.triggererPrivacyLevel === PrivacyLevel.FULL ||
    result.personaResponses.length === 0
  ) {
    return;
  }

  try {
    const messagesToStore = context.simplifiedMessages
      .slice(-10)
      .filter((message) => message.authorType === "user" || message.authorType === "persona")
      .map((message) => ({
        role: message.authorType === "user" ? ("user" as const) : ("model" as const),
        content: normalizeCustomEmojisForLlm(message.content || ""),
        timestamp: Date.now(),
        speakerName: message.authorType === "persona" ? message.personaName || message.authorName : message.authorName,
      }));

    for (const response of result.personaResponses) {
      messagesToStore.push({
        role: "model",
        content: normalizeCustomEmojisForLlm(response.text),
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
        context.channel.isThread() ? context.channel.parentId : null,
      );
    }
  } catch (error) {
    log.warn("Failed to store short-term memory, but conversation completed successfully", error);
  }
}

async function emitThoughtLog(context: ChatTurnContext, result: GenerationTurnResult): Promise<void> {
  const thoughtLog = result.thoughtLog;
  const thoughtLogChannelId = context.tomoriState.config.thought_log_channel_disc_id;
  if (!thoughtLogChannelId || context.isDMChannel || isThoughtLogPrivate(context)) {
    return;
  }

  const attributionLine =
    context.textCredentialSource === "personal" && context.personalTextProvider
      ? localizer(context.locale, "genai.thought_log.personal_attribution", {
          user_mention: `<@${context.userDiscId}>`,
          provider: getProviderDisplayName(context.personalTextProvider),
        })
      : undefined;

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
      attributionLine,
    });
  }
}

function isThoughtLogPrivate(context: ChatTurnContext): boolean {
  const privateIds = context.tomoriState.config.private_channel_ids ?? [];
  const parentId = context.channel.isThread() ? context.channel.parentId : null;
  return privateIds.includes(context.channel.id) || (parentId !== null && privateIds.includes(parentId));
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
      suppressNextSelfReply(sourceChannel.id);
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
        shouldSurfaceUserErrors: context.shouldSurfaceUserErrors,
        injectedContextItems: buildBoomerangContext(boomerang),
        manualStreamingContextOverrides: { disableCrossChannelMessage: true },
      });
    } catch (error) {
      log.warn("Failed to check/execute boomerang, but conversation completed successfully", error);
    }
  });
}
