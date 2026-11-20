import type { HumanizerSettings } from "@/constants/humanizer";
import { localizer, resolveSupportedLocale } from "@/utils/text/localizer";
import {
  findMarkdownBold,
  findMarkdownItalic,
  findMarkdownLink,
  findMarkdownSpoiler,
  findMarkdownStrikethrough,
  findNextBalancedParentheses,
  findPairedQuotedString,
  findQuotedString,
} from "./chunkProcessor";
import { escapeRegExp } from "./regexUtils";

function detectAndProtectURLs(text: string): {
  protectedText: string;
  urls: string[];
} {
  const urls: string[] = [];

  const urlRegex = /(https?|ftps?):\/\/[^\s<>[\](){}'"]+/g;

  const protectedText = text.replace(urlRegex, (match) => {
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

function restoreURLsFromPlaceholders(text: string, urls: string[]): string {
  let restoredText = text;

  for (let i = urls.length - 1; i >= 0; i--) {
    const placeholder = `__URL_${i}__`;
    // Function replacer prevents String.replace from interpreting "$&"/"$$"/"$'" sequences inside URLs.
    restoredText = restoredText.replace(new RegExp(escapeRegExp(placeholder), "g"), () => urls[i]);
  }

  return restoredText;
}

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

// Flush and remove share one roll (sum <= 1) weighted so flushes stay rare rather than splitting every comma.
const COMMA_REMOVE_PROBABILITY = 0.4;
const COMMA_FLUSH_PROBABILITY = 0.2;
// "!"/"?" never get removed (that would blunt the tone they carry), so this is a single
// flush-or-not roll instead of a three-way split.
const EMPHASIS_FLUSH_PROBABILITY = 0.5;

// ASCII punctuation requires trailing whitespace or EOF to ignore tokens like "<@!123>", whereas CJK marks need
// none.
const COMMA_ROLL_REGEX = /(,(?=\s|$)|[、，､](?!\d))(\s*)/g;
const EMPHASIS_ROLL_REGEX = /([!?]+(?=\s|$)|[!?]*[！？][!?！？]*)(\s*)/g;

// Picks an unused Private Use Area code point so a single-character split marker cannot be forged or collide with
// text.
function pickFlushMarker(text: string): string {
  for (let codePoint = 0xe000; codePoint <= 0xf8ff; codePoint++) {
    const candidate = String.fromCharCode(codePoint);
    if (!text.includes(candidate)) return candidate;
  }
  return "";
}

// Mirrors chunkMessage()'s span protection so flushes never sever paired markdown or quotes across Discord
// messages.
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

// Callers building sample dialogues or history must set suppressPunctuationNoise because re-rolling punctuation
// across rebuilds breaks prompt-prefix caching.
export function humanizeString(
  text: string,
  options: { lowercase: boolean; punctuation: boolean; suppressPunctuationNoise?: boolean },
): string[] {
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

  // Unicode-aware sender labels prevent lowercasing below from mutating non-ASCII speaker prefixes.
  processedText = processedText.replace(/((?:\([\p{L}\p{N}\p{M}_\s]+\)|[\p{L}\p{N}\p{M}_\s]+):)/gu, (match) => {
    senderStrings.push(match);
    return `__SENDER_${senderStrings.length - 1}__`;
  });

  // Match hyphenated words like "D-don't" with Unicode classes so all cased scripts preserve internal punctuation.
  if (options.lowercase) {
    processedText = processedText.replace(
      /(?<![\p{L}\p{N}\p{M}_])(\p{L}[\p{L}\p{M}'-]*)(?![\p{L}\p{N}\p{M}_])/gu,
      (word) => {
        const isAcronym = /^\p{Lu}(?:[\p{Lu}'-]*\p{Lu})?$/u.test(word);
        const isInternet = INTERNET_EXPRESSIONS.has(word.toLowerCase());
        const isSingleLetter = word.length === 1 && word !== "A";
        return isAcronym || isInternet || isSingleLetter ? word : word.toLowerCase();
      },
    );
  }

  // Before span protection, so a semicolon inside a span is stripped the same way regardless of
  // suppressPunctuationNoise, matching semicolon-stripping's original (span-unaware) global behavior.
  if (options.punctuation) {
    processedText = processedText.replace(/[;；]/g, "");
  }

  const spans: string[] = [];
  let flushMarker: string | null = null;
  if (options.punctuation && !options.suppressPunctuationNoise) {
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

  // Split before restoring placeholders because only processedText is guaranteed not to contain flushMarker.
  const segments = (flushMarker === null ? [processedText] : processedText.split(flushMarker))
    .map((segment) => {
      let restored = segment;
      // Function replacers prevent "$&"/"$$"/"$'" sequences inside restored spans or code from corrupting output.
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

export function applyStableHumanizer(text: string, humanizer: HumanizerSettings): string {
  if (!humanizer.humanizer_lowercase_enabled && !humanizer.humanizer_punctuation_split_enabled) return text;
  return humanizeString(text, {
    lowercase: humanizer.humanizer_lowercase_enabled,
    punctuation: humanizer.humanizer_punctuation_split_enabled,
    suppressPunctuationNoise: true,
  })[0];
}

export function formatBooleanLocalized(value: boolean, locale: string): string {
  return value
    ? `\`${localizer(locale, "commands.choices.enabled")}\``
    : `\`${localizer(locale, "commands.choices.disabled")}\``;
}

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

// Authored-locale resolution is required so unauthored preferences render English duration words matching the English
// fallback sentence.
export function formatLocalizedDuration(milliseconds: number, locale: string): string {
  const resolvedLocale = resolveSupportedLocale(locale);
  if (milliseconds <= 0) return localizer(resolvedLocale, "general.duration.now");
  return (
    formatDurationUnits(milliseconds, resolvedLocale) ?? localizer(resolvedLocale, "general.duration.under_a_minute")
  );
}

// Duration units format via Intl rather than locale keys because singular/plural key pairs cannot represent languages
// with three or more plural forms.
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
