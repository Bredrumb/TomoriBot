import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { StreamConfig, StreamContext } from "@/types/stream/interfaces";
import { getVisibleDeliveryMode, type TextProcessingConfig } from "@/types/stream/types";

export function createStreamTextProcessingConfig(config: StreamConfig, context: StreamContext): TextProcessingConfig {
  const { mentionMap, mentionIdSet } = buildMentionLookup(context.contextItems);
  applyForcedMentions(mentionMap, mentionIdSet, context.forcedMentions);
  const botName = context.prefixStrippingName ?? context.personaUsername ?? context.tomoriState.tomori_nickname;

  return {
    humanizerDegree: config.humanizerDegree,
    visibleDeliveryMode: getVisibleDeliveryMode(config.humanizerDegree),
    emojiUsageEnabled: config.emojiUsageEnabled,
    emojiStrings: context.emojiStrings || [],
    mentionMap,
    mentionIdSet,
    botName,
    registeredSpeakerNamesLower: collectRegisteredSpeakerNames(context.contextItems, botName),
    maxMessageLength: config.maxMessageLength,
    uncensorUnicodeSpacesEnabled: context.tomoriState.config.uncensor_unicode_space_enabled ?? false,
    uncensorSanitizeEnabled: context.tomoriState.config.uncensor_sanitize_enabled ?? false,
  };
}

function collectRegisteredSpeakerNames(contextItems: StructuredContextItem[], activeSpeakerName?: string): Set<string> {
  const registeredSpeakerNamesLower = new Set<string>();
  const activeSpeakerNameLower = activeSpeakerName?.trim().toLowerCase();

  for (const item of contextItems) {
    if (item.role !== "user" && item.role !== "model") {
      continue;
    }

    for (const part of item.parts) {
      if (part.type !== "text") {
        continue;
      }

      for (const line of part.text.split("\n")) {
        const match = line.match(/^\s*([^\n:]{1,64}):\s*/);
        const rawName = match?.[1]?.trim();
        if (!rawName || rawName.startsWith("[") || rawName.startsWith("<")) {
          continue;
        }

        const normalizedName = rawName.toLowerCase();
        if (activeSpeakerNameLower && normalizedName === activeSpeakerNameLower) {
          continue;
        }

        registeredSpeakerNamesLower.add(normalizedName);
      }
    }
  }

  return registeredSpeakerNamesLower;
}

function applyForcedMentions(
  mentionMap: Map<string, string[]>,
  mentionIdSet: Set<string>,
  forcedMentions?: Array<{ handle: string; userId: string }>,
): void {
  if (!forcedMentions || forcedMentions.length === 0) return;

  for (const mention of forcedMentions) {
    const handle = mention.handle?.trim();
    const userId = mention.userId?.trim();
    if (!handle || !userId) continue;

    mentionIdSet.add(userId);
    const normalizedHandle = handle.toLowerCase();
    const existing = mentionMap.get(normalizedHandle) ?? [];
    if (!existing.includes(userId)) {
      existing.push(userId);
      mentionMap.set(normalizedHandle, existing);
    }
  }
}

function buildMentionLookup(contextItems: StructuredContextItem[]): {
  mentionMap: Map<string, string[]>;
  mentionIdSet: Set<string>;
} {
  const mentionMap = new Map<string, string[]>();
  const mentionIdSet = new Set<string>();

  for (const item of contextItems) {
    if (
      item.metadataTag !== ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION ||
      !item.conversationUsers ||
      item.conversationUsers.length === 0
    ) {
      continue;
    }

    for (const conversationUser of item.conversationUsers) {
      if (!conversationUser.mentionable || !/^\d{17,20}$/.test(conversationUser.targetId)) {
        continue;
      }

      mentionIdSet.add(conversationUser.targetId);

      for (const alias of conversationUser.aliases) {
        const normalizedHandle = alias.trim().toLowerCase();
        if (!normalizedHandle) {
          continue;
        }

        const existing = mentionMap.get(normalizedHandle) ?? [];
        if (!existing.includes(conversationUser.targetId)) {
          existing.push(conversationUser.targetId);
        }
        mentionMap.set(normalizedHandle, existing);
      }
    }
  }

  return { mentionMap, mentionIdSet };
}
