import { PrivacyLevel } from "@/types/db/schema";
import { incrementStmTurnCounter, storeShortTermMemory } from "@/utils/cache/shortTermMemoryCache";
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
import type { ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";

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
      // Advance the cadence counter on the live scope row (server-shared in guild, user in DM).
      // This fires once per bot-participation cycle — not per raw inbound message.
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
