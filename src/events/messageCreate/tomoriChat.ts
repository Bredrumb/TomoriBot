import { MessageType, type Client, type Message } from "discord.js";
import { evaluateChatAdmission, handleChatDisposition, normalizeChatInvocation } from "@/utils/chat/admission";
import {
  clearChannelProcessingQueue,
  clearQueuedNudgeWork,
  isChannelProcessingLocked,
  type QueuedMessage,
  runWithChannelLock,
  suppressNextSelfReply,
} from "@/utils/chat/channelQueue";
import { buildChatTurnContext } from "@/utils/chat/contextPipeline";
import {
  recordChatDiagnostic,
  runWithChatDiagnostic,
  runWithChatDiagnosticStage,
  sourceOf,
} from "@/utils/chat/diagnosticTimeline";
import { createChatLatencyInvocation, measureChatTurnStage, runWithChatTurnLatency } from "@/utils/chat/turnLatency";
import { runGenerationTurn } from "@/utils/chat/generationTurn";
import type { ChatAdmissionDisposition, ChatIncoming, TomoriChatInput } from "@/utils/chat/types";
import { installUserImpersonationCompletion } from "@/utils/chat/userImpersonationCompletion";
import { enrichErrorContext, runWithErrorContext } from "@/utils/misc/errorContextStore";
import { isDeliveredTurnResult, runPostTurnEffects, shouldRetryEmptyResponse } from "@/utils/chat/postTurnEffects";
import { createChatResponseSink, handleStopResponse } from "@/utils/chat/responseEmitter";
import { shouldBotReply } from "@/utils/chat/replyDecision";
import { releaseTextQuotaForTrigger } from "@/utils/chat/textQuotaState";
import {
  observeReplyControlMessage,
  offerFastRegeneration,
  prepareFastRegeneration,
} from "@/utils/discord/fastRegeneration";
import { isReplyControlMessage } from "@/utils/discord/replyControlMessage";
import { planChatTurns } from "@/utils/chat/turnPlanner";

export {
  clearChannelProcessingQueue,
  handleStopResponse,
  isChannelProcessingLocked,
  shouldBotReply,
  suppressNextSelfReply,
};

// Only event registration belongs in this directory because the shallow event dispatcher auto-registers every file
// here as a messageCreate handler.
export async function tomoriChat(input: TomoriChatInput): Promise<ChatAdmissionDisposition> {
  const startedAt = performance.now();
  const receivedAt = Date.now();
  const incoming = normalizeChatInvocation(input);
  const latencyInvocation = createChatLatencyInvocation(
    incoming.message.createdTimestamp,
    sourceOf(incoming).source,
    startedAt,
    receivedAt,
  );
  const userImpersonationCompletion = installUserImpersonationCompletion(incoming);

  const disposition = await runWithErrorContext(
    {
      source: "chat",
      userDiscId: incoming.message.author.id,
      serverDiscId: incoming.message.guildId,
      channelDiscId: incoming.message.channelId,
    },
    () => runWithChatDiagnostic(incoming, () => runAdmittedChatTurn(incoming, latencyInvocation)),
  );

  // Wait for impersonation completion so non-throwing error/timeout dispositions and queued turns remain attached to
  // the slash interaction.
  if (userImpersonationCompletion) {
    await userImpersonationCompletion;
  }

  return disposition;
}

async function runAdmittedChatTurn(
  incoming: ChatIncoming,
  latencyInvocation: ReturnType<typeof createChatLatencyInvocation>,
): Promise<ChatAdmissionDisposition> {
  const admissionStartedAt = performance.now();
  const admission = await evaluateChatAdmission(incoming);
  const admissionMs = performance.now() - admissionStartedAt;
  recordChatDiagnostic({ kind: "admission", disposition: admission.disposition });

  const isNudgeTurn = Boolean(incoming.naturalNudge);
  if (admission.disposition !== "run") {
    // The queue only advances when a lock is released, so a rejected nudge turn would strand the rest.
    if (isNudgeTurn) clearQueuedNudgeWork(incoming.message.channelId);
    await handleChatDisposition(admission);
    // Queued turns copy callbacks into QueuedMessage and settle later, so only non-queued rejections fire
    // onQueueDiscard.
    if (admission.disposition !== "queued") {
      await incoming.onQueueDiscard?.("admission_rejected");
    }
    recordChatDiagnostic({ kind: "invocation_finished", disposition: admission.disposition });
    return admission.disposition;
  }

  // Admission is where the Discord snowflakes become database rows, so upgrade the ambient
  // identity here: everything downstream (providers, tools, humanizer) logs with real IDs.
  enrichErrorContext({
    serverId: admission.tomoriState?.server_id,
    personaId: admission.tomoriState?.persona_id,
    userId: admission.userRow?.user_id,
    userDiscId: admission.userDiscId,
  });

  const replyControls = await runWithChannelLock(
    admission,
    async (lockedTurn, startTyping) => {
      const planStartedAt = performance.now();
      const turnPlan = await planChatTurns(lockedTurn);
      const planMs = performance.now() - planStartedAt;
      recordChatDiagnostic({ kind: "turns_planned", count: turnPlan.turns.length });
      let generationResultCount = 0;
      let nudgeContinues = false;
      let offerLatestReplyControls: (() => Promise<void>) | undefined;

      if (turnPlan.turns.length > 0) {
        try {
          for (const turn of turnPlan.turns) {
            if (incoming.fastRegeneration) {
              const preparation = await prepareFastRegeneration(turn, incoming.fastRegeneration);
              if (preparation !== "ready") {
                await releaseTextQuotaForTrigger(turn.textQuotaTriggerKey);
                incoming.fastRegeneration.onDecline?.(preparation);
                continue;
              }
            }
            await runWithChatTurnLatency(latencyInvocation, admissionMs, planMs, async () => {
              const typingPromise =
                turn === turnPlan.turns[0]
                  ? startTyping().then(() => recordChatDiagnostic({ kind: "typing_started" }))
                  : Promise.resolve();
              recordChatDiagnostic({ kind: "turn_started", ordinal: turn.personaIndex + 1, total: turn.totalPersonas });
              const [context] = await Promise.all([
                measureChatTurnStage("context_ms", () => buildChatTurnContext(turn)),
                typingPromise,
              ]);
              const responseSink = createChatResponseSink(context);
              const result = await runWithChatDiagnosticStage({ turn: turn.personaIndex + 1 }, () =>
                runGenerationTurn(context, responseSink),
              );
              recordChatDiagnostic({
                kind: "turn_finished",
                status: result.status,
                responseCount: result.personaResponses.length,
              });
              const willRetryEmptyResponse = shouldRetryEmptyResponse(
                context.turn.lockedTurn.admission.incoming,
                result,
              );

              await runPostTurnEffects(context, result);
              if (context.streamingContext?.deliveredMessageRefs?.length) {
                offerLatestReplyControls = () => offerFastRegeneration(context, result);
              }
              generationResultCount++;
              // A pending retry decides for itself, because clearing here would drop nudge turns the retry could still save.
              nudgeContinues ||= willRetryEmptyResponse || isDeliveredTurnResult(result);

              if (!willRetryEmptyResponse) {
                await incoming.onGenerationResult?.(result, context.streamingContext.deliveryReceipts);
              }
            });
          }
        } catch (error) {
          // A throw between planning and settlement must not leave a reserved text unit held.
          for (const turn of turnPlan.turns) {
            await releaseTextQuotaForTrigger(turn.textQuotaTriggerKey);
          }
          throw error;
        }
      }

      // Before the lock releases, so the next speaker never answers a turn that posted nothing.
      if (isNudgeTurn && !nudgeContinues) {
        clearQueuedNudgeWork(lockedTurn.channelId);
      }

      if (generationResultCount === 0) {
        await incoming.onGenerationResult?.({
          status: "skipped",
          streamResults: [],
          personaResponses: [],
        });
      }
      return { publication: offerLatestReplyControls?.() };
    },
    {
      handleStopResponse,
      processQueuedMessage: (queued: QueuedMessage) =>
        tomoriChat({
          client: incoming.client,
          message: queued.message,
          isFromQueue: true,
          isManuallyTriggered: queued.isManuallyTriggered,
          forceReason: queued.forceReason,
          reasoningQuery: queued.reasoningQuery,
          llmOverrideCodename: queued.llmOverrideCodename,
          isStopResponse: queued.isStopResponse,
          reminderRecipientID: queued.reminderRecipientID,
          reminderData: queued.reminderData,
          selectedPersonaId: queued.selectedPersonaId,
          triggeredPersonaIds: queued.triggeredPersonaIds,
          isPersonaJob: queued.isPersonaJob,
          isUserImpersonation: queued.isUserImpersonation,
          impersonatedUserId: queued.impersonatedUserId,
          textQuotaSource: queued.textQuotaSource,
          textQuotaTriggerKey: queued.textQuotaTriggerKey,
          textQuotaUserDiscId: queued.textQuotaUserDiscId,
          manualSystemPrompt: queued.manualSystemPrompt,
          manualPrefill: queued.manualPrefill,
          shouldSurfaceUserErrors: queued.shouldSurfaceUserErrors,
          injectedContextItems: queued.injectedContextItems,
          forcedMentions: queued.forcedMentions,
          manualTriggerInvoker: queued.manualTriggerInvoker,
          systemTriggerIdentity: queued.systemTriggerIdentity,
          borrowsTriggerMessage: queued.borrowsTriggerMessage,
          suppressSelfReply: queued.suppressSelfReply,
          manualStreamingContextOverrides: queued.manualStreamingContextOverrides,
          sceneTurn: queued.sceneTurn,
          naturalNudge: queued.naturalNudge,
          conditioningInteraction: queued.conditioningInteraction,
          nudgeSceneCatcherPersonaId: queued.nudgeSceneCatcherPersonaId,
          onGenerationResult: queued.onGenerationResult,
          onQueueDiscard: queued.onQueueDiscard,
        }).then(() => {}),
    },
  );

  await replyControls?.publication;
  recordChatDiagnostic({ kind: "invocation_finished", disposition: "run" });
  return "run";
}

export default async function messageCreateHandler(client: Client, message: Message): Promise<void> {
  if (isReplyControlMessage(message, client.user?.id)) return;
  observeReplyControlMessage(message);
  // Discord's ChannelPinnedMessage carries a context messageReference rather than a conversational reply, so skip it
  // before triggering.
  if (message.type === MessageType.ChannelPinnedMessage) {
    return;
  }

  await tomoriChat({ client, message, isFromQueue: false });
}
