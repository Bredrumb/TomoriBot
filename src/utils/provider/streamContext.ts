import type { Client, CommandInteraction, Message, Webhook } from "discord.js";
import type { StreamContext } from "@/types/stream/interfaces";
import type { StreamingContext } from "@/types/tool/interfaces";
import type { TomoriState } from "@/types/db/schema";
import type { StructuredContextItem } from "@/types/misc/context";

export interface BuildStreamContextParams {
  provider: string;

  // Discord context
  channel: StreamContext["channel"];
  client: Client;
  initialInteraction?: CommandInteraction;
  replyToMessage?: Message;

  tomoriState: TomoriState;
  contextItems: StructuredContextItem[];
  currentTurnModelParts: Array<Record<string, unknown>>;
  emojiStrings?: string[];
  functionInteractionHistory?: StreamContext["functionInteractionHistory"];

  // Locale: the helper applies the shared `en-US` fallback.
  userLocale?: string;

  // Turn/tool metadata that carries the shared copy-through fields (suppress flags, prefill,
  //    forced mentions, abort signal, message ID map, NAI continuation, etc.).
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
    // Discord context
    channel: params.channel,
    client: params.client,
    initialInteraction: params.initialInteraction,
    replyToMessage: params.replyToMessage,

    tomoriState: params.tomoriState,
    contextItems: params.contextItems,
    currentTurnModelParts: params.currentTurnModelParts,
    emojiStrings: params.emojiStrings,
    functionInteractionHistory: params.functionInteractionHistory,

    // Provider context
    provider: params.provider,
    locale: params.userLocale ?? "en-US", // Use user's preferred locale, fallback to en-US
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

    // NAI GLM-4.6 prompt continuation: trailing fragment from a previous truncated stream.
    //    Only ever populated for NovelAI streams; a no-op copy-through for other providers.

    abortSignal: streamingContext?.abortSignal,
    onStreamProgress: streamingContext?.onStreamProgress,

    emptyResponseRetryCount: streamingContext?.emptyResponseRetryCount,

    // Opaque message ID map for snowflake ID abstraction in LLM-visible text
    messageIdMap: streamingContext?.messageIdMap,

    triggererUserId: streamingContext?.triggererUserId,
    triggererDiscId: streamingContext?.triggererDiscId,

    // Copy the ARRAY REFERENCE (not a clone) so the orchestrator's successful-send appends reach
    //    the turn's StreamingContext even after the SDK-call-timeout race abandons this
    //    StreamContext's owning promise.
    deliveredMessageRefs: streamingContext?.deliveredMessageRefs,
  };
}
