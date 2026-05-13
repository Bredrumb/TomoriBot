import type { Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { isMatrixBridgeWebhookUsername } from "@/utils/bridges";

export interface PersonaTurnBlockResult {
  blockMessages: Message[];
  resolvedPersona: TomoriState | null;
  targetPersonaKey: string | null;
}

/**
 * Walks chronological channel history from newest to oldest and finds the last
 * contiguous message block sent by a known Tomori persona.
 */
export function findLastPersonaTurnBlock(options: {
  messages: Message[];
  allPersonas: TomoriState[];
  clientUserId?: string;
  targetPersonaId?: number;
}): PersonaTurnBlockResult {
  const { messages, allPersonas, clientUserId, targetPersonaId } = options;
  const personaByNickname = new Map<string, TomoriState>(
    allPersonas.map((persona) => [persona.tomori_nickname.toLowerCase(), persona]),
  );
  const mainPersona = allPersonas.find((persona) => !persona.is_alter) ?? null;
  const requestedPersona = targetPersonaId
    ? (allPersonas.find((persona) => persona.tomori_id === targetPersonaId) ?? null)
    : null;

  let targetPersonaKey = requestedPersona?.tomori_nickname.toLowerCase() ?? null;
  let resolvedPersona = requestedPersona;
  const blockMessages: Message[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;

    if (!msg.webhookId) {
      if (clientUserId && msg.author.id === clientUserId && !msg.content.trim() && msg.embeds.length > 0) {
        continue;
      }

      if (clientUserId && msg.author.id === clientUserId && mainPersona) {
        const mainKey = mainPersona.tomori_nickname.toLowerCase();
        if (targetPersonaKey === null) {
          targetPersonaKey = mainKey;
          resolvedPersona = mainPersona;
          blockMessages.push(msg);
          continue;
        }

        if (targetPersonaKey === mainKey) {
          blockMessages.push(msg);
          continue;
        }
      }

      if (blockMessages.length > 0) break;
      continue;
    }

    if (isMatrixBridgeWebhookUsername(msg.author.username)) {
      if (blockMessages.length > 0) break;
      continue;
    }

    const lookupKey = msg.author.username.toLowerCase();
    const matchedPersona = personaByNickname.get(lookupKey);

    if (!matchedPersona) {
      if (blockMessages.length > 0) break;
      continue;
    }

    if (targetPersonaKey === null) {
      targetPersonaKey = lookupKey;
      resolvedPersona = matchedPersona;
      blockMessages.push(msg);
    } else if (lookupKey === targetPersonaKey) {
      blockMessages.push(msg);
    } else if (blockMessages.length > 0) {
      break;
    }
  }

  return {
    blockMessages,
    resolvedPersona,
    targetPersonaKey,
  };
}

export function findLastActivePersona(options: {
  messages: Message[];
  allPersonas: TomoriState[];
  clientUserId?: string;
}): TomoriState | null {
  return findLastPersonaTurnBlock(options).resolvedPersona;
}
