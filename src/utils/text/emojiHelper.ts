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

export function extractCustomEmojis(text: string): string[] {
  if (!text) return [];

  const matches = text.match(CUSTOM_EMOJI_REGEX);
  if (!matches) return [];

  return [...new Set(matches)];
}

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

// Discord custom emojis are always stripped because no TTS engine handles them as markup, while Unicode emojis stay
// only for engines such as IrodoriTTS.
export function stripTtsUnsupportedEmojiAttempts(text: string, options: { preserveUnicodeEmojis: boolean }): string {
  if (!text) return "";

  let sanitized = text.replace(DISCORD_CUSTOM_EMOJI_MENTION_REGEX, "").replace(CUSTOM_EMOJI_REGEX, "");

  if (!options.preserveUnicodeEmojis) {
    sanitized = sanitized.replace(UNICODE_EMOJI_REGEX, "");
  }

  return normalizeEmojiRemovalWhitespace(sanitized);
}
