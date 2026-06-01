import { localizer } from "@/utils/text/localizer";
import { escapeRegExp } from "./regexUtils";

/**
 * Gets the day name for a given date
 * @param date - Date object to get day name from
 * @returns The name of the day (e.g., "Monday")
 */
function getDayOfWeek(date: Date): string {
  const dayOfWeek = new Date(date).getDay();
  return Number.isNaN(dayOfWeek)
    ? ""
    : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayOfWeek];
}

/**
 * Gets the current time in a formatted string
 * @returns Current time in format "Month Day, Year | Hour:Minutes AM/PM | Weekday"
 */
export function getCurrentTime(): string {
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const date = new Date();
  const weekday = getDayOfWeek(date);
  const day = date.getDate();
  const year = date.getFullYear();
  let hour = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  let mid = "AM";

  if (hour === 0) {
    // Midnight case
    hour = 12;
  } else if (hour === 12) {
    // Noon case
    mid = "PM";
  } else if (hour > 12) {
    // Afternoon/Evening case
    hour = hour % 12;
    mid = "PM";
  }

  const month = monthNames[date.getMonth()];
  return `${month} ${day}, ${year} | ${hour}:${minutes} ${mid} | ${weekday}`;
}

/**
 * Helper to format basic input text to be more "AI"
 * @param text - Raw input text
 * @param options - Text formatting options
 * @param options.capitalizeFirst - Capitalize the first letter.
 * @param options.addPeriod - Add a period if one isn't present at the end.
 * @returns Formatted text with requested transformations
 */
export function formatText(
  text: string,
  options: {
    capitalizeFirst?: boolean;
    addPeriod?: boolean;
  } = {},
): string {
  let result = text.trim();

  if (options.capitalizeFirst && result.length > 0) {
    const firstChar = result.charAt(0);
    if (/[a-zA-Z]/.test(firstChar)) {
      result = firstChar.toUpperCase() + result.slice(1);
    }
  }

  if (options.addPeriod && result.length > 0) {
    if (!/[.,:!?]$/.test(result)) {
      result = `${result}.`;
    }
  }

  return result;
}

/**
 * Universal URL detection and protection function
 * Detects all URLs regardless of surrounding context (angle brackets, markdown, raw)
 * and replaces them with placeholders to protect from chunking and humanization
 * @param text - Text that may contain URLs
 * @returns Object with text containing placeholders and array of original URLs
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
    // Handle trailing punctuation that's likely not part of the URL
    // Common sentence endings: period, comma, semicolon at the very end
    let url = match;
    let trailingPunct = "";

    // Check if URL ends with punctuation that should be excluded
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
 * @returns Text with URLs restored
 */
function restoreURLsFromPlaceholders(text: string, urls: string[]): string {
  let restoredText = text;

  // Restore in reverse order to avoid index issues
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
 * @param text - Full text that may include code blocks
 * @returns Humanized text with simplified punctuation and preserved code blocks
 */
export function humanizeString(text: string): string {
  // 1. First, protect all URLs from any transformations
  const { protectedText: urlProtectedText, urls } = detectAndProtectURLs(text);

  // 2. Store code blocks and replace with placeholders
  const codeBlocks: string[] = [];
  const inlineCode: string[] = [];
  const senderStrings: string[] = [];

  // 3. Replace code blocks (```) with placeholders
  let processedText = urlProtectedText.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // 3. Replace inline code (`) with placeholders
  // Look for inline code that contains alphanumeric characters or common code symbols
  processedText = processedText.replace(/`[\w\s()[\]{}.,:;=+\-*/<>!?#$%^&|~\\]+`/g, (match) => {
    inlineCode.push(match);
    return `__INLINE_CODE_${inlineCode.length - 1}__`;
  });

  // 4. Replace sender strings with placeholders
  processedText = processedText.replace(/((?:\([\w\s]+\)|[\w\s]+):)/g, (match) => {
    senderStrings.push(match);
    return `__SENDER_${senderStrings.length - 1}__`;
  });

  // 5. Apply lowercase transformation to text outside code blocks,
  //    now including hyphenated words like "E-ew" or "D-don't" as single words
  processedText = processedText.replace(/\b([A-Za-z][A-Za-z'-]*)\b/g, (word) => {
    // 5.1 Check for all-uppercase acronyms (allow hyphens in acronyms if needed)
    const isAcronym = /^[A-Z](?:[A-Z'-]*[A-Z])?$/.test(word);
    // 5.2 Check for known internet expressions (lowercased set)
    const isInternet = INTERNET_EXPRESSIONS.has(word.toLowerCase());
    // 5.3 Preserve standalone single letters (e.g., "I", "B", "F" except "A" eg. "A book")
    const isSingleLetter = word.length === 1 && word !== "A";
    // If it's an acronym, internet expression, or single letter, leave it;
    // otherwise lowercase the whole hyphenated or single word.
    return isAcronym || isInternet || isSingleLetter ? word : word.toLowerCase();
  });

  // 6. Remove commas and semicolons but keep question marks and exclamation points
  processedText = processedText.replace(/[;,]/g, "");

  // 7. Restore placeholders in reverse order to avoid index issues
  for (let i = senderStrings.length - 1; i >= 0; i--) {
    processedText = processedText.replace(`__SENDER_${i}__`, senderStrings[i]);
  }

  for (let i = inlineCode.length - 1; i >= 0; i--) {
    processedText = processedText.replace(`__INLINE_CODE_${i}__`, inlineCode[i]);
  }

  for (let i = codeBlocks.length - 1; i >= 0; i--) {
    processedText = processedText.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
  }

  // Last step: restore all protected URLs
  return restoreURLsFromPlaceholders(processedText, urls);
}

/**
 * Formats a boolean value into a user-friendly string ("Enabled" or "Disabled").
 * @param value - The boolean value to format.
 * @returns "Enabled" if true, "Disabled" if false.
 */
export function formatBoolean(value: boolean): string {
  return value ? "`Enabled`" : "`Disabled`";
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
 * Formats time remaining in a human-readable format
 * @param milliseconds - Time remaining in milliseconds
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
