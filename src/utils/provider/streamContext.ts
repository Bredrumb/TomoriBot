import type { Client, CommandInteraction, Message, Webhook } from "discord.js";
import type { StreamContext } from "@/types/stream/interfaces";
import type { StreamingContext } from "@/types/tool/interfaces";
import type { TomoriState } from "@/types/db/schema";
import type { StructuredContextItem } from "@/types/misc/context";

export interface BuildStreamContextParams {
  provider: string;

  channel: StreamContext["channel"];
  client: Client;
  initialInteraction?: CommandInteraction;
  replyToMessage?: Message;

  tomoriState: TomoriState;
  contextItems: StructuredContextItem[];
  currentTurnModelParts: Array<Record<string, unknown>>;
  emojiStrings?: string[];
  functionInteractionHistory?: StreamContext["functionInteractionHistory"];

  userLocale?: string;

  streamingContext?: StreamingContext;

  webhook?: Webhook;
  personaAvatarUrl?: string;
  personaUsername?: string;
  prefixStrippingName?: string;
}

export function buildStreamContext(params: BuildStreamContextParams): StreamContext {
  const { streamingContext } = params;

  return {
    deliveryMode: streamingContext?.deliveryMode ?? "persona",
    deliveryReceipts: streamingContext?.deliveryReceipts,
    deliveryState: streamingContext?.deliveryState,
    channel: params.channel,
    client: params.client,
    initialInteraction: params.initialInteraction,
    replyToMessage: params.replyToMessage,

    tomoriState: params.tomoriState,
    contextItems: params.contextItems,
    currentTurnModelParts: params.currentTurnModelParts,
    emojiStrings: params.emojiStrings,
    functionInteractionHistory: params.functionInteractionHistory,

    provider: params.provider,
    locale: params.userLocale ?? "en-US",
    suppressUserErrors: streamingContext?.suppressUserErrors,
    textCredentialSource: streamingContext?.textCredentialSource,
    usageContext: streamingContext?.usageContext,
    suppressTextOutput: streamingContext?.suppressTextOutput,
    holdResponseText: streamingContext?.holdResponseText,
    pendingResponseLimit: streamingContext?.pendingResponseLimit,
    rotationKeyRetriesUsed: streamingContext?.rotationKeyRetriesUsed,
    retryStreamInterruption: streamingContext?.retryStreamInterruption,
    outputPrefill: streamingContext?.outputPrefill,
    triggerMessageId: streamingContext?.triggerMessageId,
    replyNoticeState: streamingContext?.replyNoticeState,

    webhook: params.webhook,
    personaAvatarUrl: params.personaAvatarUrl,
    personaUsername: params.personaUsername,
    prefixStrippingName: params.prefixStrippingName,

    forcedMentions: streamingContext?.forcedMentions,
    mentionableUserIds: streamingContext?.mentionableUserIds,
    impersonatedSpeakerLabel: streamingContext?.impersonatedSpeakerLabel,

    abortSignal: streamingContext?.abortSignal,
    onStreamProgress: streamingContext?.onStreamProgress,

    emptyResponseRetryCount: streamingContext?.emptyResponseRetryCount,

    messageIdMap: streamingContext?.messageIdMap,

    triggererUserId: streamingContext?.triggererUserId,
    triggererDiscId: streamingContext?.triggererDiscId,

    // Share the array reference rather than cloning so successful-send appends reach StreamingContext even after a
    // timeout race abandons this StreamContext.
    deliveredMessageRefs: streamingContext?.deliveredMessageRefs,
  };
}
