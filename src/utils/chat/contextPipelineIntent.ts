import {
  buildChatTurnContext as buildBaseChatTurnContext,
  resolveTurnDeliberateToolMode,
} from "@/utils/chat/contextPipeline";
import type { ChatTurn, ChatTurnContext } from "@/utils/chat/types";
import { hasExplicitLongTermMemoryIntent } from "@/utils/memory/explicitLongTermMemoryIntent";
import { isShortTermMemoryMaintenanceDue } from "@/utils/memory/shortTermMemoryMaintenance";

const SHORT_TERM_MEMORY_TOOL_NAME = "update_short_term_memory";

// STM rides temporarily on endTurnAfterTools because contextPipeline admits those names past the DTM fail-closed gate
// without keyword matching.
export async function buildChatTurnContext(turn: ChatTurn): Promise<ChatTurnContext> {
  const incoming = turn.lockedTurn.admission.incoming;
  const deliberateToolModeActive = resolveTurnDeliberateToolMode(turn);

  const manualOverrides = incoming.manualStreamingContextOverrides;
  const toolsExplicitlyDisabled = manualOverrides?.disableAllTools === true || turn.isUserImpersonation;

  if (!deliberateToolModeActive || toolsExplicitlyDisabled) {
    return buildBaseChatTurnContext(turn);
  }

  const maintenanceDue = await isShortTermMemoryMaintenanceDue({
    triggeringUserId: turn.userDiscId,
    currentChannelId: turn.lockedTurn.channelId,
    currentServerId: turn.isDMChannel ? "DM" : turn.serverDiscId,
    tomoriState: turn.persona,
    explicitLongTermMemoryIntent: hasExplicitLongTermMemoryIntent(incoming.message.content),
    disableShortTermMemoryUpdate: manualOverrides?.disableShortTermMemoryUpdate,
  });

  if (!maintenanceDue) {
    return buildBaseChatTurnContext(turn);
  }

  const originalEndTurnAfterTools = manualOverrides?.endTurnAfterTools ?? [];
  const carriedEndTurnAfterTools = Array.from(new Set([...originalEndTurnAfterTools, SHORT_TERM_MEMORY_TOOL_NAME]));
  const carriedIncoming = {
    ...incoming,
    manualStreamingContextOverrides: {
      ...manualOverrides,
      endTurnAfterTools: carriedEndTurnAfterTools,
    },
  };
  const carriedTurn: ChatTurn = {
    ...turn,
    lockedTurn: {
      ...turn.lockedTurn,
      admission: {
        ...turn.lockedTurn.admission,
        incoming: carriedIncoming,
      },
    },
  };

  const context = await buildBaseChatTurnContext(carriedTurn);

  // `endTurnAfterTools` is only a pre-context carrier here, so strip our temporary marker before tool execution
  // unless the caller supplied it.
  if (!originalEndTurnAfterTools.includes(SHORT_TERM_MEMORY_TOOL_NAME)) {
    const remainingEndTurnAfterTools = context.streamingContext.endTurnAfterTools?.filter(
      (toolName) => toolName !== SHORT_TERM_MEMORY_TOOL_NAME,
    );
    if (remainingEndTurnAfterTools?.length) {
      context.streamingContext.endTurnAfterTools = remainingEndTurnAfterTools;
    } else {
      delete context.streamingContext.endTurnAfterTools;
    }
  }

  // Do not leak the temporary cloned incoming overrides to post-turn effects.
  context.turn = turn;
  return context;
}
