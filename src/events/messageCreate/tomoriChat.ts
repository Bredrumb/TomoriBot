import type { Client, Message } from "discord.js";
import type { ForcedMention } from "@/types/discord/mentions";
import type { StructuredContextItem } from "@/types/misc/context";
import type { StreamingContext } from "@/types/tool/interfaces";
import { evaluateChatAdmission, handleChatDisposition, shouldBotReply } from "@/utils/chat/admission";
import {
  clearChannelProcessingQueue,
  isChannelProcessingLocked,
  runWithChannelLock,
  suppressNextSelfReply,
} from "@/utils/chat/channelQueue";
import { buildChatTurnContext } from "@/utils/chat/contextPipeline";
import { runGenerationTurn } from "@/utils/chat/generationTurn";
import { normalizeChatInvocation, type ManualTriggerInvoker, type TextQuotaSource } from "@/utils/chat/invocation";
import { runPostTurnEffects } from "@/utils/chat/postTurnEffects";
import { createChatResponseSink, handleStopResponse } from "@/utils/chat/responseEmitter";
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
export default async function tomoriChat(
  client: Client,
  message: Message,
  isFromQueue: boolean,
  isManuallyTriggered?: boolean,
  forceReason?: boolean,
  reasoningQuery?: string,
  llmOverrideCodename?: string,
  isStopResponse?: boolean,
  retryCount = 0,
  skipLock = false,
  reminderRecipientID?: string,
  reminderData?: {
    reminder_purpose: string;
    reminder_lateness?: string | null;
    self_reminder?: boolean;
  },
  selectedPersonaId?: number,
  isPersonaJob = false,
  isUserImpersonation = false,
  impersonatedUserId?: string,
  textQuotaSource: TextQuotaSource = "user",
  textQuotaTriggerKey?: string,
  textQuotaUserDiscId?: string,
  manualSystemPrompt?: string,
  manualPrefill?: string,
  naiContinuationPrefill?: string,
  emptyResponseFinishReason?: string,
  injectedContextItems?: StructuredContextItem[],
  forcedMentions?: ForcedMention[],
  manualTriggerInvoker?: ManualTriggerInvoker,
  manualStreamingContextOverrides?: Partial<StreamingContext>,
): Promise<void> {
  const incoming = normalizeChatInvocation(
    client,
    message,
    isFromQueue,
    isManuallyTriggered,
    forceReason,
    reasoningQuery,
    llmOverrideCodename,
    isStopResponse,
    retryCount,
    skipLock,
    reminderRecipientID,
    reminderData,
    selectedPersonaId,
    isPersonaJob,
    isUserImpersonation,
    impersonatedUserId,
    textQuotaSource,
    textQuotaTriggerKey,
    textQuotaUserDiscId,
    manualSystemPrompt,
    manualPrefill,
    naiContinuationPrefill,
    emptyResponseFinishReason,
    injectedContextItems,
    forcedMentions,
    manualTriggerInvoker,
    manualStreamingContextOverrides,
  );

  const admission = await evaluateChatAdmission(incoming);
  if (admission.disposition !== "run") {
    await handleChatDisposition(admission);
    return;
  }

  await runWithChannelLock(admission, async (lockedTurn) => {
    const turnPlan = await planChatTurns(lockedTurn);

    for (const turn of turnPlan.turns) {
      const context = await buildChatTurnContext(turn);
      const responseSink = createChatResponseSink(context);
      const result = await runGenerationTurn(context, responseSink);

      await runPostTurnEffects(context, result);
    }
  });
}
