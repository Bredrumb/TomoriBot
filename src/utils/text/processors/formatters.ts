import { localizer, resolveSupportedLocale } from "@/utils/text/localizer";
import {
  findBalancedParentheses,
  findMarkdownBold,
  findMarkdownItalic,
  findMarkdownLink,
  findMarkdownSpoiler,
  findMarkdownStrikethrough,
  findPairedQuotedString,
  findQuotedString,
} from "./chunkProcessor";
import { escapeRegExp } from "./regexUtils";

/**
 * Universal URL detection and protection function
 * Detects all URLs regardless of surrounding context (angle brackets, markdown, raw)
 * and replaces them with placeholders to protect from chunking and humanization
 * @param text - Text that may contain URLs
 */
function detectAndProtectURLs(text: string): {
  protectedText: string;
  urls: string[];
} {
  const urls: string[] = [];

  // Universal URL regex: matches http(s), ftp(s) protocols
  // Stops at whitespace and common delimiters: <>[](){} and quotes
  // Handles trailing punctuation that's likely not part of the URL
  const urlRegex = /(https?|ftps?):\/\/[^\s<>[\](){}'"]+/g;

  const protectedText = text.replace(urlRegex, (match) => {
    // Common sentence endings: period, comma, semicolon at the very end
    let url = match;
    let trailingPunct = "";

    const trailingPunctRegex = /[.,;]$/;
    if (trailingPunctRegex.test(url)) {
      trailingPunct = url.slice(-1);
      url = url.slice(0, -1);
    }

    urls.push(url);
    return `__URL_${urls.length - 1}__${trailingPunct}`;
  });

  return { protectedText, urls };
}

/**
 * Restore URLs from placeholders back to their original form
 * @param text - Text containing URL placeholders
 * @param urls - Array of original URLs
 */
function restoreURLsFromPlaceholders(text: string, urls: string[]): string {
  let restoredText = text;

  for (let i = urls.length - 1; i >= 0; i--) {
    const placeholder = `__URL_${i}__`;
    // A function replacer, not a string one: a string second argument to .replace() interprets
    // "$&"/"$$"/"$'" patterns, so a URL that happens to contain one of those sequences would
    // otherwise corrupt the restored text instead of being reinserted verbatim.
    restoredText = restoredText.replace(new RegExp(escapeRegExp(placeholder), "g"), () => urls[i]);
  }

  return restoredText;
}

/** List of common internet expressions that should be lowercased even when all-caps */
const INTERNET_EXPRESSIONS = new Set([
  "lol",
  "rofl",
  "lmao",
  "lmfao",
  "wtf",
  "btw",
  "omg",
  "iirc",
  "afaik",
  "tbh",
  "imo",
  "imho",
  "fyi",
  "idk",
  "brb",
  "afk",
  "ttyl",
  "rn",
  "smh",
  "tysm",
]);

// Weighted rather than an even three-way split: a sentence with several commas would otherwise
// have a good chance of picking up multiple flushes, which reads as more erratic typing than
// the feature is meant to simulate. Flush stays the rare outcome. Remove and flush share one
// roll, so their sum must stay at or below 1 or "keep" disappears.
const COMMA_REMOVE_PROBABILITY = 0.4;
const COMMA_FLUSH_PROBABILITY = 0.2;
// "!"/"?" never get removed (that would blunt the tone they carry), so this is a single
// flush-or-not roll instead of a three-way split.
const EMPHASIS_FLUSH_PROBABILITY = 0.5;

// ASCII "," "!" "?" only count as prose punctuation when whitespace or the end follows; otherwise
// they are part of a token ("<@!123>", "!help", "a,b", "1,000", "?..."). Full-width 、，､！？ are
// exempt because CJK prose has no spaces to require.
const COMMA_ROLL_REGEX = /(,(?=\s|$)|[、，､](?!\d))(\s*)/g;
const EMPHASIS_ROLL_REGEX = /([!?]+(?=\s|$)|[!?]*[！？][!?！？]*)(\s*)/g;

// A split point must be a single character absent from the text: a multi-character marker can
// be forged by input, or formed by adjacency with text ending in a prefix of it, and any escape
// scheme for it has to be bijective. A Private Use Area code point the text lacks has neither
// problem, and the area has far more code points than any Discord message has characters.
function pickFlushMarker(text: string): string {
  for (let codePoint = 0xe000; codePoint <= 0xf8ff; codePoint++) {
    const candidate = String.fromCharCode(codePoint);
    if (!text.includes(candidate)) return candidate;
  }
  return "";
}

// findBalancedParentheses() only examines the first "(" at or after startIndex, so an unclosed
// "(" or an emoticon like ":(" would hide every balanced aside after it and let a flush sever one.
function findNextBalancedParentheses(
  text: string,
  startIndex: number,
): { start: number; end: number; content: string } | null {
  let openIndex = text.indexOf("(", startIndex);
  while (openIndex !== -1) {
    const match = findBalancedParentheses(text, openIndex);
    if (match) return match;
    openIndex = text.indexOf("(", openIndex + 1);
  }
  return null;
}

// A flush landing inside a semantic unit like **bold**, a "quoted string", or a [markdown
// link](url) would sever it into an unclosed fragment plus a trailing-delimiter fragment, both
// rendered as broken syntax once split across two Discord messages. Protecting these spans
// mirrors chunkMessage()'s own sentence-splitter, which already treats them as unsplittable for
// the same reason, so a flush here behaves consistently with how periods are already handled.
function protectSemanticSpans(text: string): { protectedText: string; spans: string[] } {
  const spans: string[] = [];
  let result = "";
  let searchIndex = 0;

  while (searchIndex < text.length) {
    const candidates = [
      findQuotedString(text, searchIndex),
      findNextBalancedParentheses(text, searchIndex),
      findPairedQuotedString(text, searchIndex),
      findMarkdownBold(text, searchIndex),
      findMarkdownItalic(text, searchIndex),
      findMarkdownStrikethrough(text, searchIndex),
      findMarkdownSpoiler(text, searchIndex),
      findMarkdownLink(text, searchIndex),
    ].filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

    if (candidates.length === 0) break;
    const earliest = candidates.reduce((a, b) => (a.start <= b.start ? a : b));

    result += text.slice(searchIndex, earliest.start);
    spans.push(earliest.content);
    result += `__SPAN_${spans.length - 1}__`;
    searchIndex = earliest.end;
  }

  result += text.slice(searchIndex);
  return { protectedText: result, spans };
}

/**
 * Humanizes text by lowercasing words and simplifying punctuation while preserving
 * code blocks, acronyms, internet expressions, and sender prefixes.
 *
 * Modifications:
 * - Converts text to lowercase unless it's an acronym or special expression
 * - Preserves sender strings in format "(Name): " or "Name: "
 * - Removes semicolons (`;` and full-width `；`)
 * - Each comma (`,`, `、`, `，`, or `､`) independently rolls remove / flush / keep. An ASCII comma
 *   only rolls when whitespace or the end follows it, so "1,000" and "a,b" are left untouched; a
 *   full-width comma only skips the roll before a digit
 * - Each run of "!"/"?"/"！"/"？" independently rolls a flush chance, keeping the marks either way.
 *   An ASCII run only rolls when whitespace or the end follows it, so "<@!id>", "!help", and
 *   "?..." are never split
 * - Never flushes inside **bold**, *italic*, ~~strikethrough~~, ||spoiler||, a "quoted" span or
 *   any paired quotation («», “”, 「」, and the rest of PAIRED_QUOTE_MARKS), a (parenthesized) aside, or a [markdown link](url); flushing there would
 *   leave one side of the pair as broken syntax in a separate Discord message
 * - Maintains code blocks and inline code unchanged
 * - Preserves standalone "I" pronoun
 * @param options.suppressPunctuationNoise - Skip every comma/emphasis roll above (still lowercases
 *   and strips semicolons). Used for sample dialogues and dialogue-history reconstruction, since
 *   both already represent real authored/delivered text where re-randomizing the same message on
 *   every context build adds no fidelity and only costs prompt-prefix cache stability.
 * @returns One or more text segments; length > 1 means a flush was rolled somewhere in the text,
 *   and each piece is meant to be sent as its own Discord message. Always a single segment when
 *   `suppressPunctuationNoise` is set. Never empty, even for empty or fully-stripped input.
 */
export function humanizeString(text: string, options?: { suppressPunctuationNoise?: boolean }): string[] {
  // First, protect all URLs from any transformations
  const { protectedText: urlProtectedText, urls } = detectAndProtectURLs(text);

  const codeBlocks: string[] = [];
  const inlineCode: string[] = [];
  const senderStrings: string[] = [];

  let processedText = urlProtectedText.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  processedText = processedText.replace(/`[\p{L}\p{N}\p{M}_\s()[\]{}.,:;=+\-*/<>!?#$%^&|~\\"']+`/gu, (match) => {
    inlineCode.push(match);
    return `__INLINE_CODE_${inlineCode.length - 1}__`;
  });

  // Unicode-aware in step with the lowercasing below, which would otherwise lowercase a non-ASCII
  // sender name that this protection used to leave alone only because the old rule was ASCII-only.
  processedText = processedText.replace(/((?:\([\p{L}\p{N}\p{M}_\s]+\)|[\p{L}\p{N}\p{M}_\s]+):)/gu, (match) => {
    senderStrings.push(match);
    return `__SENDER_${senderStrings.length - 1}__`;
  });

  // Treat hyphenated forms such as "E-ew" or "D-don't" as one word so the
  // humanizer preserves their internal punctuation. Unicode classes apply the rule to every cased
  // script (accented Latin, Cyrillic, Greek); uncased scripts match but lowercase to themselves.
  processedText = processedText.replace(
    /(?<![\p{L}\p{N}\p{M}_])(\p{L}[\p{L}\p{M}'-]*)(?![\p{L}\p{N}\p{M}_])/gu,
    (word) => {
      const isAcronym = /^\p{Lu}(?:[\p{Lu}'-]*\p{Lu})?$/u.test(word);
      const isInternet = INTERNET_EXPRESSIONS.has(word.toLowerCase());
      const isSingleLetter = word.length === 1 && word !== "A";
      // If it's an acronym, internet expression, or single letter, leave it;
      // otherwise lowercase the whole hyphenated or single word.
      return isAcronym || isInternet || isSingleLetter ? word : word.toLowerCase();
    },
  );

  // Unconditional and before span protection, so a semicolon inside a span is stripped the same
  // way regardless of suppressPunctuationNoise, matching semicolon-stripping's original
  // (span-unaware) global behavior.
  processedText = processedText.replace(/[;；]/g, "");

  const spans: string[] = [];
  let flushMarker: string | null = null;
  if (!options?.suppressPunctuationNoise) {
    const protectedSpans = protectSemanticSpans(processedText);
    processedText = protectedSpans.protectedText;
    spans.push(...protectedSpans.spans);

    const marker = pickFlushMarker(processedText);
    flushMarker = marker;

    processedText = processedText.replace(COMMA_ROLL_REGEX, (_match, mark: string, trailingSpace: string) => {
      const roll = Math.random();
      if (roll < COMMA_REMOVE_PROBABILITY) return trailingSpace;
      if (roll < COMMA_REMOVE_PROBABILITY + COMMA_FLUSH_PROBABILITY) return marker;
      return `${mark}${trailingSpace}`;
    });

    processedText = processedText.replace(EMPHASIS_ROLL_REGEX, (_match, marks: string, trailingSpace: string) => {
      return Math.random() < EMPHASIS_FLUSH_PROBABILITY ? `${marks}${marker}` : marks + trailingSpace;
    });
  }

  // Split on the marker BEFORE restoring any placeholder, then restore per segment. The marker is
  // only guaranteed absent from processedText, not from the URLs, code, and spans held aside, so
  // splitting restored text could sever that content instead of the sentence.
  const segments = (flushMarker === null ? [processedText] : processedText.split(flushMarker))
    .map((segment) => {
      let restored = segment;
      // Function replacers throughout: a string replacer interprets "$&"/"$$"/"$'" patterns in
      // the replacement, so restored content containing one of those sequences (a code snippet,
      // a financial amount, a regex example) would otherwise corrupt the output instead of being
      // reinserted verbatim.
      for (let i = spans.length - 1; i >= 0; i--) {
        restored = restored.replace(`__SPAN_${i}__`, () => spans[i]);
      }
      for (let i = senderStrings.length - 1; i >= 0; i--) {
        restored = restored.replace(`__SENDER_${i}__`, () => senderStrings[i]);
      }
      for (let i = inlineCode.length - 1; i >= 0; i--) {
        restored = restored.replace(`__INLINE_CODE_${i}__`, () => inlineCode[i]);
      }
      for (let i = codeBlocks.length - 1; i >= 0; i--) {
        restored = restored.replace(`__CODE_BLOCK_${i}__`, () => codeBlocks[i]);
      }
      return restoreURLsFromPlaceholders(restored, urls);
    })
    .filter((segment) => segment.length > 0);

  return segments.length > 0 ? segments : [""];
}

/**
 * Formats a boolean value into a localized user-friendly string ("Enabled" or "Disabled").
 * Uses locale keys from commands.choices.enabled and commands.choices.disabled.
 * @param value - The boolean value to format.
 * @param locale - The user's locale for localization.
 * @returns Localized "Enabled" if true, "Disabled" if false, wrapped in backticks.
 */
export function formatBooleanLocalized(value: boolean, locale: string): string {
  return value
    ? `\`${localizer(locale, "commands.choices.enabled")}\``
    : `\`${localizer(locale, "commands.choices.disabled")}\``;
}

/**
 * @returns Formatted string like "2 days, 3 hours, 15 minutes" or "45 minutes"
 */
export function formatTimeRemaining(milliseconds: number): string {
  if (milliseconds <= 0) return "now";

  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days} day${days !== 1 ? "s" : ""}`);
  }
  if (hours % 24 > 0) {
    parts.push(`${hours % 24} hour${hours % 24 !== 1 ? "s" : ""}`);
  }
  if (minutes % 60 > 0) {
    parts.push(`${minutes % 60} minute${minutes % 60 !== 1 ? "s" : ""}`);
  }

  if (parts.length === 0) {
    return "less than a minute";
  }

  if (parts.length === 1) {
    return parts[0];
  } else if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`;
  } else {
    return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  }
}

/**
 * Renders a duration for a user-facing sentence in the resolved authored locale, so an unauthored
 * preference gets English words to match the English sentence it falls back to. Model-facing text
 * keeps using {@link formatTimeRemaining}.
 */
export function formatLocalizedDuration(milliseconds: number, locale: string): string {
  const resolvedLocale = resolveSupportedLocale(locale);
  if (milliseconds <= 0) return localizer(resolvedLocale, "general.duration.now");
  return (
    formatDurationUnits(milliseconds, resolvedLocale) ?? localizer(resolvedLocale, "general.duration.under_a_minute")
  );
}

/**
 * Joins day, hour, and minute phrases through Intl rather than locale keys, because a key pair such
 * as "day/days" cannot express languages with several plural forms (Russian has three).
 *
 * @returns The joined phrase, or null when the duration is under one minute.
 */
export function formatDurationUnits(milliseconds: number, intlLocale: string): string | null {
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const units = [
    ["day", Math.floor(totalMinutes / 1440)],
    ["hour", Math.floor(totalMinutes / 60) % 24],
    ["minute", totalMinutes % 60],
  ] as const;
  const parts = units
    .filter(([, value]) => value > 0)
    .map(([unit, value]) =>
      new Intl.NumberFormat(intlLocale, { style: "unit", unit, unitDisplay: "long" }).format(value),
    );
  if (parts.length === 0) return null;
  return new Intl.ListFormat(intlLocale, { type: "unit", style: "long" }).format(parts);
}
