import type { TomoriState } from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import type { SendableChannel } from "@/utils/discord/resolveSendableChannel";
import {
  type PersonaPostContext,
  type PersonaPostOutcome,
  type PersonaPostPayload,
  sendPersonaPost,
} from "@/utils/discord/webhook/personaPost";

/**
 * Builds the shared delivery context for a tool post.
 *
 * @param destination - Channel to post into when it differs from the tool's context channel, such
 *   as the thread a tool has just created.
 */
export function buildToolPersonaPostContext(
  context: ToolContext,
  persona: TomoriState,
  destination: SendableChannel = context.channel as SendableChannel,
): PersonaPostContext {
  return {
    channel: destination,
    persona,
    deliveryMode:
      context.deliveryMode ??
      context.streamContext?.deliveryMode ??
      (context.isUserImpersonation ? "user_impersonation" : "persona"),
    webhook: context.webhook,
    impersonatedIdentity: context.personaUsername
      ? {
          username: context.personaUsername,
          avatarUrl: context.personaAvatarUrl,
          avatarDataUri: context.personaAvatarUrl?.startsWith("data:image/") ? context.personaAvatarUrl : undefined,
        }
      : undefined,
    locale: context.locale,
    deliveryState: context.streamContext?.deliveryState,
    abortSignal: context.abortSignal ?? context.streamContext?.abortSignal,
    isExecutionCancelled: context.isExecutionCancelled,
    deliveryReceipts: context.streamContext?.deliveryReceipts,
  };
}

/** Delivers a tool payload through the shared persona author, appearance, and receipt path. */
export function sendToolPersonaPost(
  context: ToolContext,
  persona: TomoriState,
  payload: PersonaPostPayload,
  destination?: SendableChannel,
): Promise<PersonaPostOutcome> {
  return sendPersonaPost(buildToolPersonaPostContext(context, persona, destination), payload);
}
