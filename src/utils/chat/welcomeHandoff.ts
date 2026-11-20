import type { StructuredContextItem } from "@/types/misc/context";
import type { ChatIncoming } from "@/utils/chat/types";

type WelcomeClaim = { by: "member"; messageId: string } | { by: "welcome"; anchorMessageId: string };

interface PendingWelcome {
  contextItem: StructuredContextItem;
  claim: WelcomeClaim | null;
}

// Handoff state for a pending welcome greeting so the member's own trigger can absorb it into one reply instead of
// two racing turns.
export interface WelcomeHandoff {
  isTakenByMember(): boolean;
  // False when the member's turn already took the greeting; otherwise drops any member turn for anchorMessageId so
  // only the welcome replies.
  claimForWelcome(anchorMessageId: string): boolean;
  release(): void;
}

const pendingWelcomes = new Map<string, PendingWelcome>();

function handoffKey(channelId: string, userDiscId: string): string {
  return `${channelId}:${userDiscId}`;
}

export function openWelcomeHandoff(
  channelId: string,
  userDiscId: string,
  contextItem: StructuredContextItem,
): WelcomeHandoff {
  const key = handoffKey(channelId, userDiscId);
  const pending: PendingWelcome = { contextItem, claim: null };
  pendingWelcomes.set(key, pending);

  return {
    isTakenByMember: () => pending.claim?.by === "member",
    claimForWelcome: (anchorMessageId) => {
      if (pending.claim) return false;
      pending.claim = { by: "welcome", anchorMessageId };
      return true;
    },
    release: () => {
      if (pendingWelcomes.get(key) === pending) pendingWelcomes.delete(key);
    },
  };
}

// Must run only once the turn is certain to execute or queue because taking the greeting cancels the standalone
// welcome; false means abort this turn.
export function applyWelcomeHandoff(incoming: ChatIncoming, userDiscId: string): boolean {
  if (incoming.isManuallyTriggered || incoming.isPersonaJob || incoming.isStopResponse) return true;

  const { message } = incoming;
  const pending = pendingWelcomes.get(handoffKey(message.channelId, userDiscId));
  if (!pending) return true;

  if (!pending.claim) {
    pending.claim = { by: "member", messageId: message.id };
    incoming.injectedContextItems = [...(incoming.injectedContextItems ?? []), pending.contextItem];
    return true;
  }

  return !(pending.claim.by === "welcome" && pending.claim.anchorMessageId === message.id);
}
