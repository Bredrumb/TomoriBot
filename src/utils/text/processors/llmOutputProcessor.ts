import { log } from "@/utils/misc/logger";
import { applyUncensorOutputTransforms } from "@/utils/text/uncensor";
import { escapeRegExp } from "./regexUtils";
import { replaceMentionHandles } from "./mentionProcessor";

function findMatchingBacktickRun(text: string, startIndex: number, delimiter: string): number {
  return text.indexOf(delimiter, startIndex);
}

/**
 * Returns all code-span and code-block ranges in `text` as [{start, end}] pairs.
 * Used to skip over code regions when scanning for speaker-stop labels.
 * @param text - Text to scan for markdown code ranges
 * @returns Array of {start, end} index pairs covering each code span/block
 */
export function findMarkdownCodeRanges(text: string): Array<{ start: number; end: number }> {
  if (!text.includes("`")) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  let index = 0;

  while (index < text.length) {
    if (text[index] !== "`") {
      index++;
      continue;
    }

    let delimiterLength = 1;
    while (index + delimiterLength < text.length && text[index + delimiterLength] === "`") {
      delimiterLength++;
    }

    const delimiter = "`".repeat(delimiterLength);
    const closingIndex = findMatchingBacktickRun(text, index + delimiterLength, delimiter);
    const end = closingIndex === -1 ? text.length : closingIndex + delimiterLength;

    ranges.push({ start: index, end });
    index = end;
  }

  return ranges;
}

function isIndexInsideRanges(index: number, ranges: ReadonlyArray<{ start: number; end: number }>): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

/**
 * Returns true if `rawLabel` looks like a generic speaker turn label (e.g. "User:", "Assistant:").
 * Used by `truncateBeforeGenericSpeakerLine` to detect roleplay-style script turns.
 * @param rawLabel - The candidate label text (without the trailing colon)
 */
export function isGenericSpeakerStopLabel(rawLabel: string): boolean {
  const label = rawLabel.trim();
  if (!label) return false;
  if (label.length > 64) return false;
  if (label.startsWith("[") || label.startsWith("<")) return false;
  return /[\p{L}\p{N}_]/u.test(label);
}

/**
 * Truncates text at the first generic speaker-turn line (e.g. "User:\n..."), optionally
 * including the very first line if it matches.
 * @param text - LLM output to scan
 * @param options.includeStart - Also check the very first line for a speaker label
 * @returns Object with `text` (possibly truncated), `stopTriggered`, and `matchedSpeaker`
 */
export function truncateBeforeGenericSpeakerLine(
  text: string,
  options: { includeStart?: boolean } = {},
): {
  text: string;
  stopTriggered: boolean;
  matchedSpeaker?: string;
} {
  if (!text) return { text, stopTriggered: false };

  const markdownCodeRanges = findMarkdownCodeRanges(text);
  const speakerLinePattern = options.includeStart ? /(^|\n+)\s*([^\n:]{1,64}):\s*/g : /(\n+)\s*([^\n:]{1,64}):\s*/g;
  let match: RegExpExecArray | null = null;

  // biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
  while ((match = speakerLinePattern.exec(text)) !== null) {
    const rawLabel = match[2];
    if (!rawLabel) continue;

    const labelIndex = match.index + match[0].indexOf(rawLabel);
    if (isIndexInsideRanges(labelIndex, markdownCodeRanges)) continue;

    const trimmedLabel = rawLabel.trim();
    if (!isGenericSpeakerStopLabel(trimmedLabel)) continue;

    return { text: text.slice(0, match.index), stopTriggered: true, matchedSpeaker: trimmedLabel };
  }

  return { text, stopTriggered: false };
}

/**
 * Cleans raw LLM output for Discord display: removes leaked system blocks, normalises
 * whitespace, resolves Discord emoji shortcodes, strips bot-name prefixes, and resolves
 * @mention handles.
 * @param text - Raw text from LLM
 * @param botName - Optional bot name to remove from response prefix
 * @param emojiStrings - Array of valid Discord emoji strings for the server
 * @param emojiUsageEnabled - When false, strips all emoji from the output
 * @param mentionMap - Map of mention handles to user IDs
 * @param mentionIdSet - Set of known user IDs for disambiguation
 * @param uncensorOptions - Optional uncensor cleanup flags (output side)
 * @returns Cleaned text suitable for Discord messages
 */
export function cleanLLMOutput(
  text: string,
  botName?: string,
  emojiStrings?: string[],
  emojiUsageEnabled = true,
  mentionMap?: Map<string, string[]>,
  mentionIdSet?: Set<string>,
  uncensorOptions?: {
    unicodeSpacesEnabled?: boolean;
    sanitizeEnabled?: boolean;
  },
): string {
  let cleanedText = applyUncensorOutputTransforms(text, uncensorOptions)
    .replace(/\[system:[\s\S]*?\]/gi, "")
    .replace(/\[system:[\s\S]*$/gi, "");

  if (cleanedText.startsWith("```") || cleanedText.endsWith("```")) return cleanedText;

  cleanedText = cleanedText
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(^|\n)-#[ \t]*\n+/g, "$1-# ")
    .replace(/<\|im_end\|>(\s*)$/, "")
    .replace(/<\|file_separator\|>(\s*)$/, "")
    .replace(/<\/?think>/g, "")
    .replace(/\*\*<(.*?)>\*\*/g, "<$1>")
    .replace(/\*<(.*?)>\*/g, "<$1>")
    .replace(/<([a-zA-Z0-9_]+)>[\s\S]*?<\/\1>/g, "")
    .replace(
      new RegExp(
        `^(\\*\\*${escapeRegExp(botName || "Tomori")}:\\*\\*|\\*\\*${escapeRegExp(botName || "Tomori")}\\*\\*:|${escapeRegExp(botName || "Tomori")}:)\\s*`,
        "i",
      ),
      "",
    )
    .trim();

  if (emojiUsageEnabled === false) {
    cleanedText = cleanedText.replace(/<(a?):[^:]+:[^>]+>/g, "");
    cleanedText = cleanedText.replace(/\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier}|️|‍/gu, "");
    cleanedText = cleanedText.replace(/:(?=[^:]*[a-zA-Z_])[\w-]+:/g, "");
  } else if (emojiStrings && emojiStrings.length > 0) {
    log.info(
      `[cleanLLMOutput] Processing text with ${emojiStrings.length} emojis. Text: "${text.substring(0, 100)}..."`,
    );
    const validEmojiSet = new Set(emojiStrings);

    cleanedText = cleanedText.replace(/<[^:>\s]*:([A-Za-z0-9_~]+):(\d+)>/g, "<:$1:$2>");

    const emojiNameMap = new Map<string, string>();
    for (const emoji of emojiStrings) {
      const m = emoji.match(/<(a?):([^:]+):([^>]+)>/);
      if (m) emojiNameMap.set(m[2].toLowerCase(), emoji);
    }

    for (const [name] of emojiNameMap.entries()) {
      const malformedPattern = new RegExp(`(:${escapeRegExp(name)})(?!:)(?=\\s|$|[^a-zA-Z0-9_~])`, "gi");
      cleanedText = cleanedText.replace(malformedPattern, "$1:");
    }

    const preserved = new Map<string, string>();
    let placeholderCount = 0;
    for (const emoji of validEmojiSet) {
      const key = `__EMOJI_PLACEHOLDER_${placeholderCount++}__`;
      cleanedText = cleanedText.replace(new RegExp(escapeRegExp(emoji), "g"), key);
      preserved.set(key, emoji);
    }

    for (const [name, full] of emojiNameMap.entries()) {
      const pattern = new RegExp(`(?<!<[^>]*)\\s*:${escapeRegExp(name)}:\\s*`, "gi");
      cleanedText = cleanedText.replace(pattern, ` ${full} `);
    }

    cleanedText = cleanedText.replace(
      /<(a?):([^:>]+):?>/g,
      (_match, _animated, name) => emojiNameMap.get(name.toLowerCase()) ?? "",
    );

    cleanedText = cleanedText.replace(/<(a?):([^:>]+):([^>]+)>/g, (_match, animated, name, id) => {
      const full = `<${animated}:${name}:${id}>`;
      if (validEmojiSet.has(full)) return full;
      const canonical = emojiNameMap.get(name.toLowerCase());
      if (canonical) return canonical;
      return "";
    });

    for (const [key, emoji] of preserved.entries()) {
      cleanedText = cleanedText.replace(new RegExp(escapeRegExp(key), "g"), emoji);
    }
  } else {
    log.info(
      `[cleanLLMOutput] Emoji conversion skipped. emojiUsageEnabled: ${emojiUsageEnabled}, emojiStrings length: ${emojiStrings?.length || 0}`,
    );
  }

  if (botName) {
    const escapedName = escapeRegExp(botName);
    const prefixPattern = new RegExp(
      `^(\\*\\*${escapedName}:\\*\\*|\\*\\*${escapedName}\\*\\*:|${escapedName}:)\\s*`,
      "i",
    );
    cleanedText = cleanedText.replace(prefixPattern, "");
  }

  cleanedText = cleanedText.replace(/\s+:[a-zA-Z0-9_~]+:\s+/g, " ");
  cleanedText = replaceMentionHandles(cleanedText, mentionMap, mentionIdSet);

  return cleanedText.replace(/\n([^:]+):$/, "");
}
