import { localizer } from "@/utils/text/localizer";
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
    restoredText = restoredText.replace(new RegExp(escapeRegExp(placeholder), "g"), urls[i]);
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

/**
 * Humanizes text by lowercasing words and simplifying punctuation while preserving
 * code blocks, acronyms, internet expressions, and sender prefixes.
 *
 * Modifications:
 * - Converts text to lowercase unless it's an acronym or special expression
 * - Preserves sender strings in format "(Name): " or "Name: "
 * - Removes periods and commas while preserving ? and ! marks
 * - Maintains code blocks and inline code unchanged
 * - Preserves standalone "I" pronoun
 *
 */
export function humanizeString(text: string): string {
  // First, protect all URLs from any transformations
  const { protectedText: urlProtectedText, urls } = detectAndProtectURLs(text);

  const codeBlocks: string[] = [];
  const inlineCode: string[] = [];
  const senderStrings: string[] = [];

  let processedText = urlProtectedText.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  processedText = processedText.replace(/`[\w\s()[\]{}.,:;=+\-*/<>!?#$%^&|~\\]+`/g, (match) => {
    inlineCode.push(match);
    return `__INLINE_CODE_${inlineCode.length - 1}__`;
  });

  processedText = processedText.replace(/((?:\([\w\s]+\)|[\w\s]+):)/g, (match) => {
    senderStrings.push(match);
    return `__SENDER_${senderStrings.length - 1}__`;
  });

  // Treat hyphenated forms such as "E-ew" or "D-don't" as one word so the
  // humanizer preserves their internal punctuation.
  processedText = processedText.replace(/\b([A-Za-z][A-Za-z'-]*)\b/g, (word) => {
    const isAcronym = /^[A-Z](?:[A-Z'-]*[A-Z])?$/.test(word);
    const isInternet = INTERNET_EXPRESSIONS.has(word.toLowerCase());
    const isSingleLetter = word.length === 1 && word !== "A";
    // If it's an acronym, internet expression, or single letter, leave it;
    // otherwise lowercase the whole hyphenated or single word.
    return isAcronym || isInternet || isSingleLetter ? word : word.toLowerCase();
  });

  processedText = processedText.replace(/[;,]/g, "");

  for (let i = senderStrings.length - 1; i >= 0; i--) {
    processedText = processedText.replace(`__SENDER_${i}__`, senderStrings[i]);
  }

  for (let i = inlineCode.length - 1; i >= 0; i--) {
    processedText = processedText.replace(`__INLINE_CODE_${i}__`, inlineCode[i]);
  }

  for (let i = codeBlocks.length - 1; i >= 0; i--) {
    processedText = processedText.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
  }

  return restoreURLsFromPlaceholders(processedText, urls);
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
