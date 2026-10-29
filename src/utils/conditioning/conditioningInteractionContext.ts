import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import {
  CONDITIONING_ACTION_TYPES,
  getConditioningContextPastParticiple,
  normalizeConditioningReason,
  type ConditioningActionKey,
} from "@/utils/conditioning/conditioning";

export const CONDITIONING_INTERACTION_RESPONSE_TEMPLATE =
  "{{if tool:interact_with_target}}You may use {conditioning_interaction_tool} to return the gesture.{{/if}}";

export function buildConditioningInteractionEvent(params: {
  actorName: string;
  targetName: string;
  action: ConditioningActionKey;
  reason: string;
  food?: string;
  messageId: string;
}): StructuredContextItem {
  const action = getConditioningContextPastParticiple(CONDITIONING_ACTION_TYPES[params.action], params.action);
  const food = params.action === "feed" && params.food ? ` with ${normalizeConditioningReason(params.food)}` : "";
  const reason = params.reason ? `: ${params.reason}` : "";
  return {
    role: "user",
    metadataTag: ContextItemTag.DIALOGUE_HISTORY,
    messageId: params.messageId,
    parts: [
      {
        type: "text",
        text: `[System: ${params.actorName} just ${action} ${params.targetName}${food}${reason}.]`,
      },
    ],
  };
}
