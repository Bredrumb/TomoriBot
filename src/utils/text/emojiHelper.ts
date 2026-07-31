/**
 * Utility functions for detecting and analyzing emoji usage
 */

/**
 * Comprehensive regex to match all emoji types including:
 * - Unicode emojis (standard emoji characters)
 * - Emoji with skin tone modifiers
 * - Emoji with zero-width joiners (e.g., family emojis)
 * - Custom Discord server emojis (after normalization: :emoji_name:)
 * - Emoticons (text-based like :), :D, etc.)
 */
const EMOJI_REGEX =
  /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|[\u{1F1E6}-\u{1F1FF}]{2}|:[a-zA-Z0-9_~]+:|:[)D(POp[\]\\|]|;\)|:'\(|<3)/gu;

/**
 * Count the number of emojis in a given text string
 * @returns The total count of emojis found in the text
 */
export function countEmojis(text: string): number {
  if (!text) return 0;

  const matches = text.match(EMOJI_REGEX);
  return matches ? matches.length : 0;
}

/**
 * Extract all unique emojis from a text string
 */
export function extractEmojis(text: string): string[] {
  if (!text) return [];

  const matches = text.match(EMOJI_REGEX);
  if (!matches) return [];

  return [...new Set(matches)];
}

/**
 * Check if a specific emoji appears multiple times consecutively in text
 * @param emoji - The specific emoji to check for repetition
 * @param threshold - Minimum consecutive appearances to be considered repetitive (default: 2)
 * @returns True if the emoji appears consecutively at or above the threshold
 */
export function hasConsecutiveEmoji(text: string, emoji: string, threshold = 2): boolean {
  if (!text || !emoji) return false;

  const escapedEmoji = emoji.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const consecutiveRegex = new RegExp(`(${escapedEmoji}){${threshold},}`, "g");

  return consecutiveRegex.test(text);
}

/**
 * Count total emojis across multiple text strings
 * @returns Total emoji count across all provided texts
 */
export function countEmojisInMultiple(texts: string[]): number {
  return texts.reduce((total, text) => total + countEmojis(text), 0);
}

/**
 * Regex to match custom Discord server emojis in normalized format (:emoji_name:)
 * Matches patterns like :tomori:, :pepehands:, :custom_emoji_123:
 */
const CUSTOM_EMOJI_REGEX = /:[a-zA-Z0-9_~]+:/g;
const DISCORD_CUSTOM_EMOJI_MENTION_REGEX = /<a?:[a-zA-Z0-9_~]{1,32}:\d{17,20}>/g;
const UNICODE_EMOJI_REGEX =
  /(?:[\d#*]\uFE0F?\u20E3|[\u{1F1E6}-\u{1F1FF}]{2}|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*)/gu;

function normalizeEmojiRemovalWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\s+([,.!?;:。！？、，])/g, "$1")
    .trim();
}

/**
 * Extract all custom Discord server emojis from text (after normalization)
 * @param text - The text to extract custom emojis from (should be normalized: :name: format)
 * @returns Array of unique custom emoji strings (e.g., [":tomori:", ":pepehands:"])
 */
export function extractCustomEmojis(text: string): string[] {
  if (!text) return [];

  const matches = text.match(CUSTOM_EMOJI_REGEX);
  if (!matches) return [];

  return [...new Set(matches)];
}

/**
 * @param emojisToRemove - Set of emoji strings to remove (e.g., ":tomori:", ":pepehands:")
 * @returns Text with specified custom emojis removed
 */
export function filterCustomEmojis(text: string, emojisToRemove: Set<string>): string {
  if (!text || emojisToRemove.size === 0) return text;

  let filtered = text;

  for (const emoji of emojisToRemove) {
    const emojiRegex = new RegExp(emoji.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    filtered = filtered.replace(emojiRegex, "").trim();
  }

  filtered = filtered.replace(/\s{2,}/g, " ").trim();

  return filtered;
}

/**
 * Removes emoji attempts that TTS engines would otherwise speak literally.
 * Discord custom emojis are never valid TTS markup, while Unicode emoji is
 * only useful for emoji-aware engines such as IrodoriTTS.
 */
export function stripTtsUnsupportedEmojiAttempts(text: string, options: { preserveUnicodeEmojis: boolean }): string {
  if (!text) return "";

  let sanitized = text.replace(DISCORD_CUSTOM_EMOJI_MENTION_REGEX, "").replace(CUSTOM_EMOJI_REGEX, "");

  if (!options.preserveUnicodeEmojis) {
    sanitized = sanitized.replace(UNICODE_EMOJI_REGEX, "");
  }

  return normalizeEmojiRemovalWhitespace(sanitized);
}
