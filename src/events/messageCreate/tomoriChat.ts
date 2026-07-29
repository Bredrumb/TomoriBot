import type { Client, Message } from "discord.js";
import { evaluateChatAdmission, handleChatDisposition, normalizeChatInvocation } from "@/utils/chat/admission";
import {
  clearChannelProcessingQueue,
  isChannelProcessingLocked,
  type QueuedMessage,
  runWithChannelLock,
  suppressNextSelfReply,
} from "@/utils/chat/channelQueue";
import { buildChatTurnContext } from "@/utils/chat/contextPipeline";
import { runGenerationTurn } from "@/utils/chat/generationTurn";
import type { ChatAdmissionDisposition, TomoriChatInput } from "@/utils/chat/types";
import { runPostTurnEffects, shouldRetryEmptyResponse } from "@/utils/chat/postTurnEffects";
import { createChatResponseSink, handleStopResponse } from "@/utils/chat/responseEmitter";
import { shouldBotReply } from "@/utils/chat/replyDecision";
import { planChatTurns } from "@/utils/chat/turnPlanner";

export {
  clearChannelProcessingQueue,
  handleStopResponse,
  isChannelProcessingLocked,
  shouldBotReply,
  suppressNextSelfReply,
};

/**
 * Readable messageCreate chat coordinator.
 *
 * Keep Discord event registration here. Put implementation modules under
 * `src/utils/chat/` so helper files are not auto-registered as messageCreate
 * handlers by the shallow event dispatcher.
 */
export async function tomoriChat(input: TomoriChatInput): Promise<ChatAdmissionDisposition> {
  const incoming = normalizeChatInvocation(input);

  const admission = await evaluateChatAdmission(incoming);
  if (admission.disposition !== "run") {
    await handleChatDisposition(admission);
    await incoming.onQueueDiscard?.("admission_rejected");
    return admission.disposition;
  }

  await runWithChannelLock(
    admission,
    async (lockedTurn, startTyping) => {
      const turnPlan = await planChatTurns(lockedTurn);
      let generationResultCount = 0;

      if (turnPlan.turns.length > 0) {
        await startTyping();

        for (const turn of turnPlan.turns) {
          const context = await buildChatTurnContext(turn);
          const responseSink = createChatResponseSink(context);
          const result = await runGenerationTurn(context, responseSink);
          const willRetryEmptyResponse = shouldRetryEmptyResponse(context.turn.lockedTurn.admission.incoming, result);

          await runPostTurnEffects(context, result);
          generationResultCount++;

          if (!willRetryEmptyResponse) {
            await incoming.onGenerationResult?.(result);
          }
        }
      }

      if (generationResultCount === 0) {
        await incoming.onGenerationResult?.({
          status: "skipped",
          streamResults: [],
          personaResponses: [],
        });
      }
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
          manualStreamingContextOverrides: queued.manualStreamingContextOverrides,
          sceneTurn: queued.sceneTurn,
          onGenerationResult: queued.onGenerationResult,
          onQueueDiscard: queued.onQueueDiscard,
        }).then(() => {}),
    },
  );

  return "run";
}

/** Thin event-dispatch adapter: satisfies EventFunction(client, ...args) called by the event loader. */
export default async function messageCreateHandler(client: Client, message: Message): Promise<void> {
  await tomoriChat({ client, message, isFromQueue: false });
}
