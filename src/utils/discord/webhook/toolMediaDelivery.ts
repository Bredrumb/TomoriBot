import { buildToolPersonaPostContext } from "@/utils/discord/webhook/toolPersonaDelivery";
import type { Message } from "discord.js";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { DiscordDeliveryError, type DiscordDeliveryFailureKind } from "@/utils/discord/webhook/deliveryOutcome";
import { type PersonaPostPayload, sendPersonaPost } from "@/utils/discord/webhook/personaPost";
import { localizer } from "@/utils/text/localizer";

function isComponentRefusal(error: unknown): boolean {
  const cause = error instanceof DiscordDeliveryError ? error.cause : error;
  if (!cause || typeof cause !== "object" || !("code" in cause) || Number(cause.code) !== 50035) return false;
  const raw = "rawError" in cause ? cause.rawError : undefined;
  if (!raw || typeof raw !== "object" || !("errors" in raw)) return false;
  const errors = raw.errors;
  return Boolean(errors && typeof errors === "object" && ("components" in errors || "flags" in errors));
}

export async function sendToolMediaPost(
  context: ToolContext,
  payload: () => PersonaPostPayload,
  componentFreePayload?: () => PersonaPostPayload,
): Promise<Message> {
  const postContext = buildToolPersonaPostContext(context, context.tomoriState);
  let outcome = await sendPersonaPost(postContext, payload());
  if (outcome.status === "definite_refusal" && componentFreePayload && isComponentRefusal(outcome.error)) {
    outcome = await sendPersonaPost(postContext, componentFreePayload());
  }
  if (outcome.status !== "sent") throw new DiscordDeliveryError(outcome.status, outcome.error);
  return outcome.message;
}

export function mediaDeliveryFailure(context: ToolContext, status: DiscordDeliveryFailureKind): ToolResult {
  if (status === "unconfirmed" && context.streamContext?.deliveryState)
    context.streamContext.deliveryState.unconfirmed = true;
  return {
    success: false,
    error: localizer(
      context.locale,
      status === "unconfirmed" ? "tools.media.delivery_unconfirmed" : "tools.media.delivery_failed",
    ),
    endTurn: status === "unconfirmed",
    data: { deliveryStatus: status },
  };
}
