/**
 * Emoji repetition penalty system to prevent excessive custom emoji usage
 * Analyzes bot's recent messages and injects guidance when threshold is exceeded
 * NOTE: Only counts custom server emojis (:name:), NOT Unicode emojis (😊, 👍)
 *
 * Configuration via environment variables:
 * - EMOJI_PENALTY_ENABLED: Enable/disable the feature (default: true)
 * - EMOJI_PENALTY_LOOKBACK: Number of recent messages to check (default: 3)
 * - EMOJI_PENALTY_THRESHOLD: Max custom emojis allowed across lookback window (default: 1)
 */

import type { StructuredContextItem } from "../../types/misc/context";
import { ContextItemTag } from "../../types/misc/context";
import { extractCustomEmojis, filterCustomEmojis } from "./emojiHelper";
import { log } from "../misc/logger";

/**
 * Configuration for emoji penalty thresholds
 */
interface EmojiPenaltyConfig {
  /** Whether the emoji penalty system is enabled */
  readonly enabled: boolean;
  /** Number of recent bot messages to analyze */
  readonly lookbackCount: number;
  /** Maximum total emojis allowed across the lookback window */
  readonly maxEmojis: number;
}

/**
 * Load emoji penalty configuration from environment variables
 * @returns Configuration object with enabled status and thresholds
 */
function loadEmojiPenaltyConfig(): EmojiPenaltyConfig {
  const enabled = process.env.EMOJI_PENALTY_ENABLED !== "false";

  const lookbackCount = Number.parseInt(process.env.EMOJI_PENALTY_LOOKBACK || "3", 10);

  const maxEmojis = Number.parseInt(process.env.EMOJI_PENALTY_THRESHOLD || "1", 10);

  return {
    enabled,
    lookbackCount: Number.isNaN(lookbackCount) ? 2 : lookbackCount,
    maxEmojis: Number.isNaN(maxEmojis) ? 1 : maxEmojis,
  };
}

/**
 * Extract text content from a StructuredContextItem's parts
 */
function extractTextFromContextItem(item: StructuredContextItem): string {
  const textParts = item.parts.filter((part) => part.type === "text");

  return textParts.map((part) => part.text).join(" ");
}

/**
 * Analyze recent bot messages for excessive emoji usage
 * @param config - Optional threshold configuration (loads from env if not provided)
 * @returns True if emoji usage exceeds threshold, false otherwise
 */
export function shouldApplyEmojiPenalty(contextItems: StructuredContextItem[], config?: EmojiPenaltyConfig): boolean {
  const penaltyConfig = config ?? loadEmojiPenaltyConfig();

  if (!penaltyConfig.enabled) {
    return false;
  }
  // Filter for bot messages in dialogue history (role: "model")
  //    We only care about actual dialogue, not system prompts or sample dialogues
  const botMessages = contextItems.filter(
    (item) => item.role === "model" && item.metadataTag === ContextItemTag.DIALOGUE_HISTORY,
  );

  if (botMessages.length === 0) {
    return false;
  }

  const messagesToCheck = Math.min(botMessages.length, penaltyConfig.lookbackCount);
  const recentBotMessages = botMessages.slice(-messagesToCheck);

  // Count total CUSTOM emojis across recent messages (ignore Unicode emojis).
  // Normalise Discord emoji mentions to shortcodes first to avoid double-counting :name: inside <:name:id>.
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

/**
 * Generate an emoji penalty message to inject into context
 * This message appears as natural user guidance to reduce emoji usage
 * @param speakerLabel - Optional speaker label for the directive subject
 */
function buildEmojiPenaltyText(speakerLabel?: string | null): string {
  const normalizedLabel = speakerLabel?.trim();
  return normalizedLabel
    ? `${normalizedLabel} has been using emojis too frequently in recent messages. Respond to this message without using any emojis to maintain natural conversation flow.`
    : "You have been using emojis too frequently in recent messages. Respond to this message without using any emojis to maintain natural conversation flow.";
}

export function generateEmojiPenaltyMessage(speakerLabel?: string | null): StructuredContextItem {
  // Create a natural-sounding reminder message
  // It appears as a user message to be close to generation point
  const penaltyText = `[System: ${buildEmojiPenaltyText(speakerLabel)}]`;

  return {
    role: "user",
    parts: [
      {
        type: "text",
        text: penaltyText,
      },
    ],
    metadataTag: ContextItemTag.DIALOGUE_HISTORY, // Tag as dialogue to keep it close to generation
  };
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

/**
 * Main function to check and apply emoji penalty if needed
 * Call this after building context but before sending to LLM
 * @param botName - The bot's current nickname
 * @returns Modified context array with penalty message if threshold exceeded, otherwise unchanged
 */
export function applyEmojiPenaltyIfNeeded(
  contextItems: StructuredContextItem[],
  speakerLabel?: string | null,
): StructuredContextItem[] {
  if (!shouldApplyEmojiPenalty(contextItems)) {
    return contextItems;
  }

  const penaltyMessage = generateEmojiPenaltyMessage(speakerLabel);

  return [...contextItems, penaltyMessage];
}

/**
 * Configuration for unique emoji enforcement
 */
interface UniqueEmojiConfig {
  /** Whether unique emoji enforcement is enabled */
  readonly enabled: boolean;
  /** Number of recent bot messages to track for unique emojis */
  readonly lookbackCount: number;
}

/**
 * Load unique emoji enforcement configuration from environment variables
 * @returns Configuration object with enabled status and lookback count
 */
function loadUniqueEmojiConfig(): UniqueEmojiConfig {
  const enabled = process.env.EMOJI_UNIQUE_ENABLED !== "false";

  const lookbackCount = Number.parseInt(process.env.EMOJI_UNIQUE_LOOKBACK || "5", 10);

  return {
    enabled,
    lookbackCount: Number.isNaN(lookbackCount) ? 5 : lookbackCount,
  };
}

/**
 * Get set of custom emojis used in recent bot messages
 * @param config - Optional configuration (loads from env if not provided)
 * @returns Set of custom emoji strings used in recent messages (e.g., ":tomori:", ":pepehands:")
 */
export function getRecentlyUsedCustomEmojis(
  contextItems: StructuredContextItem[],
  config?: UniqueEmojiConfig,
): Set<string> {
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

  // Extract all custom emojis from recent messages.
  // History text stores already-converted Discord format (<:name:id>), so normalise it to
  // shortcode form first, so otherwise the `:name:` substring inside the mention is double-matched.
  const usedEmojis = new Set<string>();
  for (const message of recentBotMessages) {
    const text = extractTextFromContextItem(message);
    const normalizedText = text.replace(/<a?:([a-zA-Z0-9_~]+):\d+>/g, ":$1:");
    const customEmojis = extractCustomEmojis(normalizedText);
    for (const emoji of customEmojis) {
      usedEmojis.add(emoji.toLowerCase()); // Store lowercase for case-insensitive matching
    }
  }

  log.info(
    `[Unique Emoji] Found ${usedEmojis.size} unique custom emoji(s) in last ${messagesToCheck} message(s): ${Array.from(usedEmojis).join(", ") || "(none)"}`,
  );

  return usedEmojis;
}

/**
 * Filter duplicate custom emojis from generated text
 * Removes any custom emojis that were already used in recent bot messages
 * @returns Filtered text with duplicate custom emojis removed
 */
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

  if (emojisToRemove.size === 0) {
    log.info("[Unique Emoji] No duplicate custom emojis found in generated text");
    return generatedText;
  }

  const filtered = filterCustomEmojis(generatedText, emojisToRemove);

  // If filtering collapses output to punctuation only (e.g. ", that's all!" → ","),
  // keep the original text to avoid sending a lone punctuation character.
  // NOTE: An empty result is intentionally allowed, so it means the segment was purely
  // duplicate emojis, and the orchestrator's empty-segment guard will drop it cleanly.
  const compactFiltered = filtered.replace(/\s+/g, "");
  if (compactFiltered.length > 0 && /^[.,!?;:。！？、，]+$/.test(compactFiltered)) {
    log.info("[Unique Emoji] Skipping duplicate filter because result became punctuation-only");
    return generatedText;
  }

  log.info(
    `[Unique Emoji] Filtered ${emojisToRemove.size} duplicate custom emoji(s): ${Array.from(emojisToRemove).join(", ")}`,
  );
  log.info(`[Unique Emoji] Original: "${generatedText}"`);
  log.info(`[Unique Emoji] Filtered: "${filtered}"`);

  return filtered;
}
