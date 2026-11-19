import type { Message } from "discord.js";
import type { MessageProxyInstanceContext } from "@/utils/messageProxy/instances";

// Learned application IDs expire after 1 hour because a stale filter skips messages and could never re-learn a
// changed bot application.
const APPLICATION_ID_TTL_MS = 60 * 60 * 1000;

export interface ApplicationIdFilter {
  canAttest(message: Message, instance: MessageProxyInstanceContext): boolean;
  record(message: Message, instance: MessageProxyInstanceContext): void;
}

// Learned, not configured: each custom instance runs its own bot. Only a service-confirmed message may teach the ID.
export function createApplicationIdFilter(): ApplicationIdFilter {
  const learned = new Map<string, { applicationId: string; verifiedAt: number }>();
  const keyOf = (instance: MessageProxyInstanceContext) => `${instance.instanceId}\0${instance.origin}`;

  return {
    canAttest(message, instance) {
      const known = learned.get(keyOf(instance));
      if (!known || Date.now() - known.verifiedAt > APPLICATION_ID_TTL_MS) return true;
      return message.applicationId === known.applicationId;
    },
    record(message, instance) {
      if (!message.applicationId) return;
      learned.set(keyOf(instance), { applicationId: message.applicationId, verifiedAt: Date.now() });
    },
  };
}
