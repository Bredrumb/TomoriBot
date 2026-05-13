import type { ChatTurn, ChatTurnContext } from "@/utils/chat/types";

export async function buildChatTurnContext(turn: ChatTurn): Promise<ChatTurnContext> {
  const incoming = turn.lockedTurn.admission.incoming;

  return {
    turn,
    client: incoming.client,
    message: incoming.message,
    channel: incoming.message.channel,
    locale: turn.lockedTurn.admission.locale,
    allPersonas: turn.lockedTurn.admission.allPersonas ?? [],
    contextItems: [],
  };
}
