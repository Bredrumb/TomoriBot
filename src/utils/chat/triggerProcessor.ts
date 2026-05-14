import type { Client, Message } from "discord.js";
import { DMChannel } from "discord.js";
import type { TomoriConfigRow, TomoriState } from "@/types/db/schema";
import { isMatrixBridgeWebhookUsername } from "@/utils/bridges";
import { escapeRegExp } from "@/utils/text/processors/regexUtils";

/**
 * Creates a regex that matches a trigger word with "screaming" support.
 * Allows repeated letters, e.g. "Lilja" matches "Liiiljaaaa".
 */
export function createScreamingRegex(trigger: string): RegExp {
  let pattern = "";

  for (const char of trigger) {
    if (/[a-zA-Z]/.test(char)) {
      pattern += `${char}+`;
    } else {
      pattern += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }

  return new RegExp(`\\b${pattern}\\b`, "i");
}

function createDeliberateTriggerRegex(trigger: string): RegExp {
  let pattern = "";

  for (const char of trigger) {
    if (/[a-zA-Z]/.test(char)) {
      pattern += `${char}+`;
    } else if (/\s/.test(char)) {
      pattern += "\\s+";
    } else {
      pattern += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }

  return new RegExp(`@${pattern}`, "i");
}

export function getDeliberateTriggerMatch(content: string, trigger: string): RegExpMatchArray | null {
  const fullTriggerMatch = content.match(createDeliberateTriggerRegex(trigger));
  if (fullTriggerMatch) {
    return fullTriggerMatch;
  }

  const firstTriggerWord = trigger.split(/\s+/)[0]?.trim() ?? trigger;
  if (!firstTriggerWord || firstTriggerWord === trigger) {
    return null;
  }

  const isJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(trigger);
  const hasFullTriggerMatch = isJapanese ? content.includes(trigger) : createScreamingRegex(trigger).test(content);
  if (!hasFullTriggerMatch) {
    return null;
  }

  return content.match(createDeliberateTriggerRegex(firstTriggerWord));
}

export function getTriggerFirstMatchIndex(message: Message, trigger: string, deliberateOnly = false): number {
  if (trigger.startsWith("<@")) {
    const userId = trigger.replace(/[<@!>]/g, "");
    if (!message.mentions.users.has(userId)) {
      return Number.POSITIVE_INFINITY;
    }

    const mentionPattern = new RegExp(`<@!?${escapeRegExp(userId)}>`);
    const mentionMatch = message.content.match(mentionPattern);
    return mentionMatch?.index ?? Number.MAX_SAFE_INTEGER;
  }

  if (deliberateOnly) {
    const deliberateMatch = getDeliberateTriggerMatch(message.content, trigger);
    return deliberateMatch?.index ?? Number.POSITIVE_INFINITY;
  }

  const isJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(trigger);
  if (isJapanese) {
    const index = message.content.indexOf(trigger);
    return index >= 0 ? index : Number.POSITIVE_INFINITY;
  }

  const match = message.content.match(createScreamingRegex(trigger));
  return match?.index ?? Number.POSITIVE_INFINITY;
}

export function isMatrixRelayMessage(message: Pick<Message, "webhookId" | "author">): boolean {
  return Boolean(message.webhookId) && isMatrixBridgeWebhookUsername(message.author.username);
}

export function isRealUserLikeMessage(message: Message): boolean {
  return (!message.author.bot && !message.webhookId) || isMatrixRelayMessage(message);
}

export function isSelfTriggerMessage(message: Message, allPersonas: TomoriState[]): boolean {
  if (message.interaction) return false;

  const clientUserId = message.client.user?.id;
  if (clientUserId && message.author.id === clientUserId) {
    return true;
  }

  if (!message.webhookId) {
    return false;
  }

  const authorName = message.author.username?.toLowerCase();
  if (!authorName) return false;

  return allPersonas.some((persona) => persona.tomori_nickname?.toLowerCase() === authorName);
}

export function getAutochatRange(config: TomoriConfigRow): {
  minThreshold: number;
  maxThreshold: number;
} {
  const minThreshold = Math.max(config.autoch_threshold ?? 0, 0);
  if (minThreshold === 0) {
    return { minThreshold: 0, maxThreshold: 0 };
  }

  const rawMaxThreshold = Math.max(config.autoch_threshold_max ?? 0, 0);
  return {
    minThreshold,
    maxThreshold: rawMaxThreshold > 0 ? Math.max(rawMaxThreshold, minThreshold) : minThreshold,
  };
}

export function isAutochatConfiguredChannel(config: TomoriConfigRow, channelId: string): boolean {
  return config.autoch_disc_ids.length > 0 && config.autoch_disc_ids.includes(channelId);
}

export function getAutochatAssignedPersonaId(config: TomoriConfigRow, channelId: string): number | null {
  const assignedPersona = config.autoch_persona_overrides.find((entry) => entry.channel_disc_id === channelId);
  return assignedPersona?.tomori_id ?? null;
}

export function isAutochatQualifyingMessage(message: Message, isSelfMessage: boolean): boolean {
  return !isSelfMessage && isRealUserLikeMessage(message) && !(message.channel instanceof DMChannel);
}

export function isAutochatCounterChannelActive(config: TomoriConfigRow, channelId: string): boolean {
  const { minThreshold, maxThreshold } = getAutochatRange(config);
  return minThreshold > 0 && maxThreshold > 0 && isAutochatConfiguredChannel(config, channelId);
}

export function isAutochatAlwaysReplyChannelActive(config: TomoriConfigRow, channelId: string): boolean {
  const { minThreshold, maxThreshold } = getAutochatRange(config);
  return minThreshold === 0 && maxThreshold === 0 && isAutochatConfiguredChannel(config, channelId);
}

export function isAutochatOverrideChannel(config: TomoriConfigRow, channelId: string): boolean {
  return (config.always_reply_enabled ?? false) || isAutochatConfiguredChannel(config, channelId);
}

export function isAutochatCounterHit(tomoriState: TomoriState, channelId: string): boolean {
  if (!isAutochatCounterChannelActive(tomoriState.config, channelId)) {
    return false;
  }

  return (
    tomoriState.autoch_counter > 0 &&
    tomoriState.autoch_next_target > 0 &&
    tomoriState.autoch_counter >= tomoriState.autoch_next_target
  );
}

export function determineMatchingPersonas(
  message: Message,
  allPersonas: TomoriState[],
  client: Client,
  isReplyToBot: boolean,
  replyPersona: TomoriState | null,
  isBotMentioned: boolean,
  isAutoMsgHit: boolean,
  isAlwaysReply = false,
  autoTriggerPersonaId?: number | null,
  alwaysReplyFallbackPersonaId?: number | null,
  deliberateTriggerMode = false,
  isAutochatDtmExemptChannel = false,
  allowedPersonaIds?: ReadonlySet<number> | null,
): TomoriState[] {
  const mainPersona = allPersonas.find((persona) => !persona.is_alter);
  const resolveFallbackPersona = (personaId?: number | null): TomoriState | undefined =>
    (personaId ? allPersonas.find((persona) => persona.tomori_id === personaId) : undefined) ?? mainPersona;
  const isPersonaAllowed = (persona?: TomoriState | null): persona is TomoriState =>
    Boolean(
      persona &&
        (!allowedPersonaIds || (typeof persona.tomori_id === "number" && allowedPersonaIds.has(persona.tomori_id))),
    );

  const forcedPersonas: TomoriState[] = [];
  const forcedPersonaIds = new Set<number>();
  const addForcedPersona = (persona?: TomoriState | null): void => {
    if (!isPersonaAllowed(persona)) {
      return;
    }
    if (typeof persona.tomori_id === "number" && forcedPersonaIds.has(persona.tomori_id)) {
      return;
    }
    if (typeof persona.tomori_id !== "number" && forcedPersonas.includes(persona)) {
      return;
    }
    forcedPersonas.push(persona);
    if (typeof persona.tomori_id === "number") {
      forcedPersonaIds.add(persona.tomori_id);
    }
  };

  addForcedPersona(replyPersona);
  if (isReplyToBot || isBotMentioned) {
    addForcedPersona(mainPersona);
  }

  if (isAutoMsgHit && forcedPersonas.length === 0) {
    const autoTriggerPersona = resolveFallbackPersona(autoTriggerPersonaId);
    return isPersonaAllowed(autoTriggerPersona) ? [autoTriggerPersona] : [];
  }

  let senderPersona: TomoriState | undefined;
  const personaByNickname = new Map<string, TomoriState>();
  for (const persona of allPersonas) {
    const nicknameKey = persona.tomori_nickname?.toLowerCase();
    if (!nicknameKey || personaByNickname.has(nicknameKey)) continue;
    personaByNickname.set(nicknameKey, persona);
  }
  if (message.webhookId) {
    const webhookName = message.author.username.toLowerCase();
    senderPersona = personaByNickname.get(webhookName);
  } else if (message.author.id === client.user?.id) {
    senderPersona = allPersonas.find((persona) => !persona.is_alter);
  }

  let repliedToPersona: TomoriState | undefined;
  if (message.reference?.messageId) {
    const referenceMessage = message.channel.messages.cache.get(message.reference.messageId);
    if (referenceMessage) {
      if (referenceMessage.author.id === client.user?.id) {
        repliedToPersona = allPersonas.find((persona) => !persona.is_alter);
      } else if (referenceMessage.webhookId) {
        const webhookName = referenceMessage.author.username.toLowerCase();
        repliedToPersona = personaByNickname.get(webhookName);
      }
    }
  }

  const matchingPersonas: Array<{
    persona: TomoriState;
    firstMatchIndex: number;
    insertionOrder: number;
  }> = [];

  for (const [insertionOrder, persona] of allPersonas.entries()) {
    if (!isPersonaAllowed(persona)) {
      continue;
    }

    if (senderPersona && persona.tomori_id === senderPersona.tomori_id) {
      continue;
    }
    if (repliedToPersona && persona.tomori_id === repliedToPersona.tomori_id) {
      continue;
    }
    if (typeof persona.tomori_id === "number" && forcedPersonaIds.has(persona.tomori_id)) {
      continue;
    }

    const config = persona.config;
    if (!config) continue;

    const triggers =
      persona.trigger_words ?? (persona.is_alter ? (persona.alter_triggers ?? []) : (config.trigger_words ?? []));

    let hasMatch = false;
    let firstMatchIndex = Number.MAX_SAFE_INTEGER;

    for (const trigger of triggers) {
      const isPersonaDtmExempt =
        isAutochatDtmExemptChannel &&
        (autoTriggerPersonaId === null ? !persona.is_alter : autoTriggerPersonaId === persona.tomori_id);
      const matchIndex = getTriggerFirstMatchIndex(message, trigger, deliberateTriggerMode && !isPersonaDtmExempt);
      if (matchIndex !== Number.POSITIVE_INFINITY) {
        hasMatch = true;
        if (matchIndex < firstMatchIndex) {
          firstMatchIndex = matchIndex;
        }
      }
    }

    if (hasMatch) {
      matchingPersonas.push({
        persona,
        firstMatchIndex,
        insertionOrder,
      });
    }
  }

  matchingPersonas.sort((a, b) => {
    if (a.firstMatchIndex !== b.firstMatchIndex) {
      return a.firstMatchIndex - b.firstMatchIndex;
    }
    return a.insertionOrder - b.insertionOrder;
  });

  const result = [...forcedPersonas, ...matchingPersonas.map((entry) => entry.persona)];

  if (isAlwaysReply && result.length === 0) {
    const fallbackPersona = resolveFallbackPersona(alwaysReplyFallbackPersonaId);
    if (isPersonaAllowed(fallbackPersona)) {
      return [fallbackPersona];
    }
  }

  return result;
}
