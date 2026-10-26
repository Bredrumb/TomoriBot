import type { TomoriState } from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import type { SendableChannel } from "@/utils/discord/resolveSendableChannel";
import {
  type PersonaDeliveryMode,
  type PersonaPostContext,
  type PersonaPostOutcome,
  type PersonaPostPayload,
  sendPersonaPost,
} from "@/utils/discord/webhook/personaPost";

/**
 * Delivery mode for a tool post. The chat turn records the mode on both the direct field and the
 * shared streaming context, and the legacy impersonation flag is the only remaining source for a
 * caller that predates both.
 */
export function resolveToolPersonaDeliveryMode(context: ToolContext): PersonaDeliveryMode {
  return (
    context.deliveryMode ??
    context.streamContext?.deliveryMode ??
    (context.isUserImpersonation ? "user_impersonation" : "persona")
  );
}

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
    deliveryMode: resolveToolPersonaDeliveryMode(context),
    webhook: context.webhook,
    abortSignal: context.abortSignal,
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
