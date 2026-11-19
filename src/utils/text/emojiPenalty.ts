import type { StructuredContextItem } from "../../types/misc/context";
import { ContextItemTag } from "../../types/misc/context";
import { extractCustomEmojis, filterCustomEmojis } from "./emojiHelper";
import { log } from "../misc/logger";

const EMOJI_PENALTY_LOOKBACK_MESSAGES = 3;
// More than one custom emoji across the lookback window triggers the penalty directive.
const EMOJI_PENALTY_MAX_EMOJIS = 1;
const EMOJI_UNIQUE_LOOKBACK_MESSAGES = 5;

interface EmojiPenaltyConfig {
  readonly enabled: boolean;
  readonly lookbackCount: number;
  readonly maxEmojis: number;
}

function loadEmojiPenaltyConfig(): EmojiPenaltyConfig {
  return {
    enabled: process.env.EMOJI_PENALTY_ENABLED !== "false",
    lookbackCount: EMOJI_PENALTY_LOOKBACK_MESSAGES,
    maxEmojis: EMOJI_PENALTY_MAX_EMOJIS,
  };
}

function extractTextFromContextItem(item: StructuredContextItem): string {
  const textParts = item.parts.filter((part) => part.type === "text");

  return textParts.map((part) => part.text).join(" ");
}

function shouldApplyEmojiPenalty(contextItems: StructuredContextItem[], config?: EmojiPenaltyConfig): boolean {
  const penaltyConfig = config ?? loadEmojiPenaltyConfig();

  if (!penaltyConfig.enabled) {
    return false;
  }
  // Count only delivered dialogue turns so sample dialogues do not trigger emoji penalties.
  const botMessages = contextItems.filter(
    (item) => item.role === "model" && item.metadataTag === ContextItemTag.DIALOGUE_HISTORY,
  );

  if (botMessages.length === 0) {
    return false;
  }

  const messagesToCheck = Math.min(botMessages.length, penaltyConfig.lookbackCount);
  const recentBotMessages = botMessages.slice(-messagesToCheck);

  // Normalize <:name:id> mentions to :name: first so extractCustomEmojis does not double-count the inner shortcode.
  let totalCustomEmojis = 0;
  for (const message of recentBotMessages) {
    const text = extractTextFromContextItem(message);
    const normalizedText = text.replace(/<a?:([a-zA-Z0-9_~]+):\d+>/g, ":$1:");
    totalCustomEmojis += extractCustomEmojis(normalizedText).length;
  }

  const shouldTrigger = totalCustomEmojis > penaltyConfig.maxEmojis;
  if (shouldTrigger) {
    log.info(
      `[Emoji Penalty] Triggering penalty (${totalCustomEmojis} custom emojis, threshold: ${penaltyConfig.maxEmojis})`,
    );
  }

  return shouldTrigger;
}

function buildEmojiPenaltyText(speakerLabel?: string | null): string {
  const normalizedLabel = speakerLabel?.trim();
  return normalizedLabel
    ? `${normalizedLabel} has been using emojis too frequently in recent messages. Respond to this message without using any emojis to maintain natural conversation flow.`
    : "You have been using emojis too frequently in recent messages. Respond to this message without using any emojis to maintain natural conversation flow.";
}

export function getEmojiPenaltyDirective(
  contextItems: StructuredContextItem[],
  speakerLabel?: string | null,
): string | null {
  if (!shouldApplyEmojiPenalty(contextItems)) {
    return null;
  }

  return buildEmojiPenaltyText(speakerLabel);
}

interface UniqueEmojiConfig {
  readonly enabled: boolean;
  readonly lookbackCount: number;
}

function loadUniqueEmojiConfig(): UniqueEmojiConfig {
  return {
    enabled: process.env.EMOJI_UNIQUE_ENABLED !== "false",
    lookbackCount: EMOJI_UNIQUE_LOOKBACK_MESSAGES,
  };
}

function getRecentlyUsedCustomEmojis(contextItems: StructuredContextItem[], config?: UniqueEmojiConfig): Set<string> {
  const uniqueConfig = config ?? loadUniqueEmojiConfig();

  if (!uniqueConfig.enabled) {
    return new Set();
  }

  const botMessages = contextItems.filter(
    (item) => item.role === "model" && item.metadataTag === ContextItemTag.DIALOGUE_HISTORY,
  );

  if (botMessages.length === 0) {
    return new Set();
  }

  const messagesToCheck = Math.min(botMessages.length, uniqueConfig.lookbackCount);
  const recentBotMessages = botMessages.slice(-messagesToCheck);

  // Normalize history <:name:id> mentions to :name: first so the inner shortcode is not matched twice.
  const usedEmojis = new Set<string>();
  for (const message of recentBotMessages) {
    const text = extractTextFromContextItem(message);
    const normalizedText = text.replace(/<a?:([a-zA-Z0-9_~]+):\d+>/g, ":$1:");
    const customEmojis = extractCustomEmojis(normalizedText);
    for (const emoji of customEmojis) {
      usedEmojis.add(emoji.toLowerCase());
    }
  }

  return usedEmojis;
}

export function filterDuplicateCustomEmojis(generatedText: string, contextItems: StructuredContextItem[]): string {
  const recentlyUsed = getRecentlyUsedCustomEmojis(contextItems);

  if (recentlyUsed.size === 0) {
    return generatedText;
  }

  const emojisInGenerated = extractCustomEmojis(generatedText);

  const emojisToRemove = new Set<string>();
  for (const emoji of emojisInGenerated) {
    if (recentlyUsed.has(emoji.toLowerCase())) {
      emojisToRemove.add(emoji);
    }
  }

  if (emojisToRemove.size === 0) return generatedText;

  const filtered = filterCustomEmojis(generatedText, emojisToRemove);

  // Revert only when stripping leaves bare punctuation, since empty strings are dropped cleanly downstream.
  const compactFiltered = filtered.replace(/\s+/g, "");
  if (compactFiltered.length > 0 && /^[.,!?;:。！？、，]+$/.test(compactFiltered)) {
    log.info("[Unique Emoji] Skipping duplicate filter because result became punctuation-only");
    return generatedText;
  }

  log.info(`[Unique Emoji] Filtered ${emojisToRemove.size} duplicate custom emoji(s)`);

  return filtered;
}
