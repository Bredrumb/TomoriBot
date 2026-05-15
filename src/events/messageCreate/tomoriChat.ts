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
import type { TomoriChatInput } from "@/utils/chat/types";
import { runPostTurnEffects } from "@/utils/chat/postTurnEffects";
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
export async function tomoriChat(input: TomoriChatInput): Promise<void> {
  const incoming = normalizeChatInvocation(input);

  const admission = await evaluateChatAdmission(incoming);
  if (admission.disposition !== "run") {
    await handleChatDisposition(admission);
    return;
  }

  await runWithChannelLock(
    admission,
    async (lockedTurn, startTyping) => {
      const turnPlan = await planChatTurns(lockedTurn);

      if (turnPlan.turns.length > 0) {
        await startTyping();

        for (const turn of turnPlan.turns) {
          const context = await buildChatTurnContext(turn);
          const responseSink = createChatResponseSink(context);
          const result = await runGenerationTurn(context, responseSink);

          await runPostTurnEffects(context, result);
        }
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
          selectedPersonaId: queued.selectedPersonaId,
          isPersonaJob: queued.isPersonaJob,
          isUserImpersonation: queued.isUserImpersonation,
          impersonatedUserId: queued.impersonatedUserId,
          textQuotaSource: queued.textQuotaSource,
          textQuotaTriggerKey: queued.textQuotaTriggerKey,
          textQuotaUserDiscId: queued.textQuotaUserDiscId,
          manualSystemPrompt: queued.manualSystemPrompt,
          manualPrefill: queued.manualPrefill,
          injectedContextItems: queued.injectedContextItems,
          forcedMentions: queued.forcedMentions,
          manualTriggerInvoker: queued.manualTriggerInvoker,
          manualStreamingContextOverrides: queued.manualStreamingContextOverrides,
        }),
    },
  );
}

/** Thin event-dispatch adapter — satisfies EventFunction(client, ...args) called by the event loader. */
export default async function messageCreateHandler(client: Client, message: Message): Promise<void> {
  return tomoriChat({ client, message, isFromQueue: false });
}
