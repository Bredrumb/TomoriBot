/**
 * Centralized construction of the runtime {@link StreamContext} handed to
 * {@link StreamOrchestrator} by every streaming provider.
 *
 * Historically each provider hand-built a near-identical `StreamContext` literal before
 * delegating to the orchestrator. That duplication meant any new cross-cutting stream field
 * had to be copy-pasted into every provider, and a single missed backend would silently drop
 * the new behavior. This helper owns all the common copy-through fields so provider files only
 * pass the values they already have in scope plus their provider name.
 *
 * @see plans/12-stream-context-construction-refactor.md
 */

import type { Client, CommandInteraction, Message, Webhook } from "discord.js";
import type { StreamContext } from "../../types/stream/interfaces";
import type { StreamingContext } from "../../types/tool/interfaces";
import type { TomoriState } from "../../types/db/schema";
import type { StructuredContextItem } from "../../types/misc/context";

/**
 * Inputs a provider supplies when asking the shared helper to assemble a {@link StreamContext}.
 *
 * The parameter types intentionally reuse the corresponding `StreamContext` field types
 * (`StreamContext["channel"]`, `StreamContext["functionInteractionHistory"]`) so a provider's
 * narrower channel/history unions remain structurally assignable without extra casts.
 */
export interface BuildStreamContextParams {
  /** Canonical provider identifier (e.g. "google", "novelai") copied verbatim into the context. */
  provider: string;

  // 1. Discord context
  channel: StreamContext["channel"];
  client: Client;
  initialInteraction?: CommandInteraction;
  replyToMessage?: Message;

  // 2. Application context
  tomoriState: TomoriState;
  contextItems: StructuredContextItem[];
  currentTurnModelParts: Array<Record<string, unknown>>;
  emojiStrings?: string[];
  functionInteractionHistory?: StreamContext["functionInteractionHistory"];

  // 3. Locale — the helper applies the shared `en-US` fallback.
  userLocale?: string;

  // 4. Turn/tool metadata that carries the shared copy-through fields (suppress flags, prefill,
  //    forced mentions, abort signal, message ID map, NAI continuation, etc.).
  streamingContext?: StreamingContext;

  // 5. Multi-persona webhook identity
  webhook?: Webhook;
  personaAvatarUrl?: string;
  personaUsername?: string;
  prefixStrippingName?: string;
}

/**
 * Build the fully assembled {@link StreamContext} passed to `StreamOrchestrator.streamToDiscord`.
 *
 * All fields derived from {@link StreamingContext} are copied here so every provider propagates
 * the same shared stream behavior. Optional fields left unset by the caller (or absent from the
 * streaming context) remain `undefined`, matching the previous per-provider literals.
 *
 * @param params - Provider-supplied inputs, see {@link BuildStreamContextParams}.
 * @returns The runtime streaming context consumed by the orchestrator.
 */
export function buildStreamContext(params: BuildStreamContextParams): StreamContext {
  const { streamingContext } = params;

  return {
    // 1. Discord context
    channel: params.channel,
    client: params.client,
    initialInteraction: params.initialInteraction,
    replyToMessage: params.replyToMessage,

    // 2. Application context
    tomoriState: params.tomoriState,
    contextItems: params.contextItems,
    currentTurnModelParts: params.currentTurnModelParts,
    emojiStrings: params.emojiStrings,
    functionInteractionHistory: params.functionInteractionHistory,

    // 3. Provider context
    provider: params.provider,
    locale: params.userLocale ?? "en-US", // Use user's preferred locale, fallback to en-US
    suppressUserErrors: streamingContext?.suppressUserErrors,
    suppressTextOutput: streamingContext?.suppressTextOutput,
    rotationKeyRetriesUsed: streamingContext?.rotationKeyRetriesUsed,
    outputPrefill: streamingContext?.outputPrefill,
    outputPrefillState: streamingContext?.outputPrefillState,
    replyNoticeState: streamingContext?.replyNoticeState,

    // 4. Multi-persona webhook support
    webhook: params.webhook,
    personaAvatarUrl: params.personaAvatarUrl,
    personaUsername: params.personaUsername,
    prefixStrippingName: params.prefixStrippingName,

    // 5. Forced mentions (e.g., reminder recipients)
    forcedMentions: streamingContext?.forcedMentions,

    // 6. NAI GLM-4.6 prompt continuation — trailing fragment from a previous truncated stream.
    //    Only ever populated for NovelAI streams; a no-op copy-through for other providers.
    naiContinuationPrefill: streamingContext?.naiContinuationPrefill,

    // 7. External abort signal for SDK call timeout cancellation
    abortSignal: streamingContext?.abortSignal,

    // 7b. Empty-response retry count for the opening-label leak guard's budget decision
    emptyResponseRetryCount: streamingContext?.emptyResponseRetryCount,

    // 8. Opaque message ID map for snowflake ID abstraction in LLM-visible text
    messageIdMap: streamingContext?.messageIdMap,
  };
}
