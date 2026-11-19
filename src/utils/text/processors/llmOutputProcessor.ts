import { applyUncensorOutputTransforms } from "@/utils/text/uncensor";
import { REASONING_TAG_GLOBAL_RE } from "@/providers/utils/reasoningTags";
import { escapeRegExp } from "./regexUtils";
import { replaceMentionHandles } from "./mentionProcessor";

const PRESERVE_UNRESOLVED_EMOJI_SHORTCODES_ENV = "EMOJI_PRESERVE_UNRESOLVED_SHORTCODES";

// Must agree with RENDER_MODIFIER_LIMIT in renderModifierParser.ts: a modifier the parser accepts
// but this strip rejects would ship the label verbatim, which is the leak this net exists to catch.
const RENDER_MODIFIER_LABEL_LIMIT = 64;

function findMatchingBacktickRun(text: string, startIndex: number, delimiter: string): number {
  return text.indexOf(delimiter, startIndex);
}

function parseBooleanEnvFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (typeof value !== "string") return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
  return defaultValue;
}

function shouldPreserveUnresolvedEmojiShortcodes(): boolean {
  return parseBooleanEnvFlag(process.env[PRESERVE_UNRESOLVED_EMOJI_SHORTCODES_ENV], false);
}

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

export function isGenericSpeakerStopLabel(rawLabel: string): boolean {
  const label = rawLabel.trim();
  if (!label) return false;
  if (label.length > 64) return false;
  if (label.startsWith("[") || label.startsWith("<")) return false;
  return /[\p{L}\p{N}_]/u.test(label);
}

export function truncateBeforeGenericSpeakerLine(
  text: string,
  options: { includeStart?: boolean; isAllowedSpeakerLabel?: (label: string) => boolean } = {},
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
    if (options.isAllowedSpeakerLabel?.(trimmedLabel)) continue;

    return { text: text.slice(0, match.index), stopTriggered: true, matchedSpeaker: trimmedLabel };
  }

  return { text, stopTriggered: false };
}

// Names sort longest-first because regex alternation matches leftmost-first, so a shorter substring name would
// otherwise shadow a longer one.
function buildNameLabelAlternation(names: string[]): string | null {
  const escapedForms: string[] = [];
  const seen = new Set<string>();
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const trimmed = name?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const escaped = escapeRegExp(trimmed);
    escapedForms.push(`\\*\\*${escaped}:\\*\\*`, `\\*\\*${escaped}\\*\\*:`, `${escaped}:`);
  }
  return escapedForms.length > 0 ? `(?:${escapedForms.join("|")})` : null;
}

function buildDecoratedNameLabelAlternation(names: string[]): string | null {
  const escapedForms: string[] = [];
  const seen = new Set<string>();
  const modifier = `\\([^()\\n\\r:：]{1,${RENDER_MODIFIER_LABEL_LIMIT}}\\)`;

  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    const decorated = `${escapeRegExp(trimmed)}[ \\t]*${modifier}`;
    escapedForms.push(
      `\\*\\*${decorated}[ \\t]*[:：]\\*\\*`,
      `\\*\\*${decorated}\\*\\*[ \\t]*[:：]`,
      `${decorated}[ \\t]*[:：]`,
    );
  }

  return escapedForms.length > 0 ? `(?:${escapedForms.join("|")})` : null;
}

const IDENTITY_MACRO_SOURCE = "(?:\\{\\{\\s*(?:bot|char|user)\\s*\\}\\}|\\{\\s*(?:bot|char|user)\\s*\\})";

// Applied only at response start because mid-text macros are legitimate content when the persona drafts presets or
// system-prompt sample dialogue.
const IDENTITY_MACRO_LABEL_ALTERNATION = `(?:\\*\\*${IDENTITY_MACRO_SOURCE}:\\*\\*|\\*\\*${IDENTITY_MACRO_SOURCE}\\*\\*:|${IDENTITY_MACRO_SOURCE}:)`;

// Callers must not pre-strip leading labels because branch-A/B leak detection relies on them; plain aliases widen
// only the opening chain to prevent over-stripping.
export function stripLeakedOwnNameLabels(text: string, botName: string, aliasNames: string[] = []): string {
  if (!text || !botName.trim()) return text;

  const escapedName = escapeRegExp(botName);
  // Scoped to active botName only so preamble and boundary passes never strip non-active aliases from prose.
  const labelAlternation = `(?:\\*\\*${escapedName}:\\*\\*|\\*\\*${escapedName}\\*\\*:|${escapedName}:)`;
  // Kept out of leaked-preamble stripping so a mid-body render modifier like "Tomori (silly):" does not discard
  // preceding reply text.
  const decoratedLabelAlternation =
    buildDecoratedNameLabelAlternation([botName, ...aliasNames]) ??
    `(?:${escapedName}[ \\t]*\\([^()\\n\\r:：]{1,${RENDER_MODIFIER_LABEL_LIMIT}}\\)[ \\t]*[:：])`;
  const boundaryLabelAlternation = `(?:${decoratedLabelAlternation}|${labelAlternation})`;
  // Aliases and identity macros widen only the opening-chain match so mid-text macros in drafted presets stay
  // intact.
  const nameAlternation = buildNameLabelAlternation([botName, ...aliasNames]) ?? labelAlternation;
  // The decorated form joins the opening chain too: matching here sets openedWithLabel, which keeps
  // a response that opens decorated on branch A instead of branch B's destructive preamble strip.
  const leadingAlternation = `(?:${decoratedLabelAlternation}|${nameAlternation}|${IDENTITY_MACRO_LABEL_ALTERNATION})`;

  // Peel chained opening labels (like "Tomori: Lilya: hi") to separate a real turn from a leaked preamble.
  const leadingChainPattern = new RegExp(`^\\s*${leadingAlternation}[ \\t]*`, "i");
  let working = text;
  let openedWithLabel = false;
  while (leadingChainPattern.test(working)) {
    working = working.replace(leadingChainPattern, "");
    openedWithLabel = true;
  }

  const deleaked = openedWithLabel ? working : stripLeakedPreamble(text, labelAlternation);

  return stripBoundaryOwnNameLabels(deleaked, boundaryLabelAlternation);
}

// Shortcode conversion in cleanLLMOutput wraps emoji tags in spaces, so emoji tags must count as leak-preceding
// boundaries to catch glued self-labels.
const CUSTOM_EMOJI_TAG_SOURCE = "<a?:[^\\s:>]+:\\d+>";

function stripLeakedPreamble(text: string, labelAlternation: string): string {
  const codeRanges = findMarkdownCodeRanges(text);
  // Exclude ":" from glued prefixes so custom emojis named like the persona ("<:Tomori:id>") are not treated as
  // leaked labels.
  const leakLabelPattern = new RegExp(
    `(?:[^\\s.!?。！？:]${labelAlternation}` +
      `|${CUSTOM_EMOJI_TAG_SOURCE}[ \\t]*${labelAlternation}` +
      `|(?:\\n|(?<!(?:^|\\n)[ \\t]*\\d{1,9})[.!?。！？])[ \\t]*${labelAlternation})[ \\t]*`,
    "gi",
  );
  let match: RegExpExecArray | null = null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
  while ((match = leakLabelPattern.exec(text)) !== null) {
    if (isIndexInsideRanges(match.index, codeRanges)) continue;
    // Drop preamble only when non-empty text follows so a trailing label leaves the preceding reply intact.
    const rest = text.slice(match.index + match[0].length);
    return rest.trim() ? rest : text;
  }
  return text;
}

function stripBoundaryOwnNameLabels(text: string, labelAlternation: string): string {
  const codeRanges = findMarkdownCodeRanges(text);
  // Digit lookbehind and space exclusion preserve numbered lists and inline prose, while excluding ":" prevents
  // matching "<:Tomori:id>".
  const labelPattern = new RegExp(
    `(?:(^|\\n|(?<!(?:^|\\n)[ \\t]*\\d{1,9})[.!?。！？])([ \\t]*)` +
      `|(${CUSTOM_EMOJI_TAG_SOURCE})[ \\t]*` +
      `|([^\\s.!?。！？:]))${labelAlternation}[ \\t]*`,
    "gi",
  );

  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
  while ((match = labelPattern.exec(text)) !== null) {
    const kept = match[1] ?? match[3] ?? match[4] ?? "";
    // Skip code ranges without advancing lastIndex because match.index starts right at the kept prefix.
    if (isIndexInsideRanges(match.index, codeRanges)) continue;

    result += text.slice(lastIndex, match.index);
    result += kept === "" || kept === "\n" ? "\n" : `${kept}\n`;
    lastIndex = labelPattern.lastIndex;
  }

  if (lastIndex === 0) return text;
  result += text.slice(lastIndex);
  return result;
}

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
  botNameAliases: string[] = [],
  personaMentionMap?: ReadonlyMap<string, string>,
): string {
  const preserveUnresolvedEmojiShortcodes = shouldPreserveUnresolvedEmojiShortcodes();
  let cleanedText = applyUncensorOutputTransforms(text, uncensorOptions)
    .replace(/\[system:[\s\S]*?\]/gi, "")
    .replace(/\[system:[\s\S]*$/gi, "");

  if (cleanedText.startsWith("```") || cleanedText.endsWith("```")) return cleanedText;

  cleanedText = cleanedText
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(^|\n)-#[ \t]*\n+/g, "$1-# ")
    .replace(/<\|im_end\|>(\s*)$/, "")
    .replace(/<\|file_separator\|>(\s*)$/, "")
    .replace(REASONING_TAG_GLOBAL_RE, "")
    .replace(/\*\*<(.*?)>\*\*/g, "<$1>")
    .replace(/\*<(.*?)>\*/g, "<$1>")
    .replace(/<([a-zA-Z0-9_]+)>[\s\S]*?<\/\1>/g, "")
    .trim();

  if (emojiUsageEnabled === false) {
    cleanedText = cleanedText.replace(/<(a?):[^:]+:[^>]+>/g, "");
    cleanedText = cleanedText.replace(/\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier}|️|‍/gu, "");
    cleanedText = cleanedText.replace(/:(?=[^:]*[a-zA-Z_])[\w-]+:/g, "");
  } else if (emojiStrings && emojiStrings.length > 0) {
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
      (match, _animated, name) =>
        emojiNameMap.get(name.toLowerCase()) ?? (preserveUnresolvedEmojiShortcodes ? match : ""),
    );

    cleanedText = cleanedText.replace(/<(a?):([^:>]+):([^>]+)>/g, (match, animated, name, id) => {
      const full = `<${animated}:${name}:${id}>`;
      if (validEmojiSet.has(full)) return full;
      const canonical = emojiNameMap.get(name.toLowerCase());
      if (canonical) return canonical;
      return preserveUnresolvedEmojiShortcodes ? match : "";
    });

    for (const [key, emoji] of preserved.entries()) {
      cleanedText = cleanedText.replace(new RegExp(escapeRegExp(key), "g"), emoji);
    }
  } else {
    // Without an emoji list (empty server or RP channel), still strip unresolved shortcodes unless opted out.
    if (!preserveUnresolvedEmojiShortcodes) {
      cleanedText = cleanedText.replace(/:(?=[^:]*[a-zA-Z_])[\w-]+:/g, "");
    }
  }

  if (botName) {
    // Must run before any prefix strip because branch detection relies on the leading label remaining intact.
    cleanedText = stripLeakedOwnNameLabels(cleanedText, botName, botNameAliases);
  }

  if (!preserveUnresolvedEmojiShortcodes) {
    cleanedText = cleanedText.replace(/(?:^|\s):[a-zA-Z0-9_~]+:(?=\s|$)/gm, " ").trim();
  } else {
    cleanedText = cleanedText.trim();
  }

  cleanedText = replaceMentionHandles(cleanedText, mentionMap, mentionIdSet, personaMentionMap);

  return cleanedText.replace(/\n([^:]+):$/, "");
}
