import type { ChatTurnPlan, LockedChatTurn } from "@/utils/chat/types";

export async function planChatTurns(lockedTurn: LockedChatTurn): Promise<ChatTurnPlan> {
  return {
    lockedTurn,
    turns: [
      {
        lockedTurn,
        personaIndex: 0,
        totalPersonas: 1,
        isUserImpersonation: lockedTurn.admission.incoming.isUserImpersonation,
        impersonatedUserId: lockedTurn.admission.incoming.impersonatedUserId,
      },
    ],
  };
}
