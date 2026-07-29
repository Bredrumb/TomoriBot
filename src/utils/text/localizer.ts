import path from "node:path";
import { readdir } from "node:fs/promises";
import { Glob } from "bun";
import type { LocaleObject, Locales, LocaleValue, LocalizerVariables } from "../../types/discord/global";
import { log } from "../misc/logger";

// Initialize locales object
const locales: Locales = {};
let isInitialized = false; // Track initialization state

/**
 * Removes common indentation from multi-line strings.
 * Allows for proper indentation in locale files without affecting output.
 * @param str - The string to dedent
 * @returns The dedented string with common leading whitespace removed
 */
function dedent(str: string): string {
  // If string is empty or has only one line, return it as is
  if (!str?.includes("\n")) return str;

  // Split into lines
  const lines = str.split("\n");

  // Find first non-empty line to determine indent pattern
  const firstNonEmptyLine = lines.find((line) => line.trim().length > 0);
  if (!firstNonEmptyLine) return str; // All lines are empty

  // Calculate common indent by counting leading spaces/tabs in first non-empty line
  const match = firstNonEmptyLine.match(/^[ \t]+/);
  if (!match) return str; // No common indent

  const indent = match[0];
  const indentRegex = new RegExp(`^${indent}`);

  // Remove indent from all lines (except completely empty lines)
  return lines.map((line) => (line.trim().length > 0 ? line.replace(indentRegex, "") : line)).join("\n");
}

/**
 * Initialize the localization system by loading all locale files.
 * This must be called and awaited before using the localizer.
 * @returns A promise that resolves when all locale files are loaded
 */
export async function initializeLocalizer(): Promise<void> {
  if (isInitialized) {
    return;
  }

  try {
    const localesDir = path.resolve("src", "locales");
    const entries = await readdir(localesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const locale = entry.name; // e.g., "en-US", "ja"
      const localeDir = path.join(localesDir, locale);
      const merged: Record<string, unknown> = {};

      const glob = new Glob("*.ts");
      for await (const file of glob.scan(localeDir)) {
        try {
          const module = await import(path.join(localeDir, file));
          const slice = module.default as Record<string, unknown>;

          // Guard against accidental top-level key collisions between category slices.
          for (const key of Object.keys(slice)) {
            if (key in merged) {
              log.warn(`Locale "${locale}": duplicate top-level key "${key}" in ${file} — overwriting`);
            }
          }

          Object.assign(merged, slice);
        } catch (importError) {
          log.error(`Failed to import locale slice: ${file}`, importError, {
            errorType: "LocaleLoadError",
            metadata: { locale, file },
          });
        }
      }

      if (Object.keys(merged).length > 0) {
        locales[locale] = processLocaleStrings(merged) as LocaleObject;
        log.info(`Loaded locale: ${locale}`);
      }
    }

    if (Object.keys(locales).length > 0) {
      log.success(`Successfully loaded locales: [${Object.keys(locales).join(", ")}]`);
      isInitialized = true;
    } else {
      log.warn("No locale files were loaded. Check the src/locales directory.");
      throw new Error("No locale files were loaded");
    }
  } catch (error) {
    log.error("Error scanning for locale files", error, {
      errorType: "LocaleLoadError",
    });
    throw error;
  }
}

/**
 * Recursively processes an object, applying dedent to all string values
 * @param obj - The object containing locale strings
 * @returns A new object with all strings dedented
 */
function processLocaleStrings(obj: unknown): LocaleValue {
  // If it's a string, dedent it
  if (typeof obj === "string") {
    return dedent(obj);
  }

  // If it's an object, process each value recursively
  if (typeof obj === "object" && obj !== null) {
    // Use LocaleObject type to match our type definition
    const result: LocaleObject = {};

    for (const [key, value] of Object.entries(obj)) {
      result[key] = processLocaleStrings(value);
    }

    return result;
  }

  // For any other type (unlikely in locale files), convert to string
  return String(obj);
}

/**
 * Get a localized string for a specific key.
 * @param locale - The locale code (e.g., 'en-US', 'ja').
 * @param key - The key path from the locale object (e.g., 'commands.help.features.title').
 * @param variables - Key-value pairs to replace placeholders in the localized string.
 * @returns The localized string, or the key itself if not found.
 */
export const localizer = (locale: string, key: string, variables: LocalizerVariables = {}): string => {
  // Check if localization system is initialized
  if (!isInitialized) {
    log.warn(`Localization system not initialized when requesting key: ${key}`);
    return key;
  }

  // Determine the locale to use, falling back to 'en-US'
  const fallbackLocale = "en-US";
  // Check if the specific locale exists, otherwise use the fallback
  const usedLocale = locales[locale] ? locale : fallbackLocale;

  // If even the fallback locale isn't loaded, return the key immediately
  if (!locales[usedLocale]) {
    // Log a warning if this happens, as it indicates a loading issue
    log.warn(`Locale '${usedLocale}' not loaded. Returning key: ${key}`);
    return key;
  }

  // Split the key into parts
  const keys: string[] = key.split(".");
  // Start with the top-level object for the used locale
  let translation: unknown = locales[usedLocale];

  // Traverse the locale object using the key parts
  for (const k of keys) {
    if (typeof translation !== "object" || translation === null || !Object.hasOwn(translation, k)) {
      // If path is invalid, return the key
      return key;
    }
    translation = (translation as Record<string, unknown>)[k];
  }

  // Check if the final value is a string
  if (typeof translation !== "string") {
    return key;
  }

  // Replace placeholders
  let result: string = translation as string;
  for (const [placeholder, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{${placeholder}}`, "g"), String(value));
  }

  // Return the final string
  return result;
};

/**
 * Get the list of currently supported/loaded locale codes.
 * This is dynamically determined from the locale files loaded during initialization.
 * @returns Array of supported locale codes (e.g., ['en-US', 'ja'])
 */
export function getSupportedLocales(): string[] {
  // Return empty array if not initialized to avoid errors
  if (!isInitialized) {
    log.warn("Localization system not initialized when requesting supported locales");
    return [];
  }

  // Return the dynamic list of loaded locale keys
  return Object.keys(locales);
}

/**
 * Get the child keys of a locale path that resolve to objects (i.e., sub-namespaces).
 * Useful for dynamically discovering all entries under a locale group (e.g., all reward types).
 * @param locale - The locale code (e.g., 'en-US')
 * @param path - Dot-notation path to the parent object (e.g., 'commands.reward')
 * @returns Array of child key names, excluding keys that resolve to strings (like 'description')
 */
export function getLocaleSubKeys(locale: string, path: string): string[] {
  if (!isInitialized || !locales[locale]) return [];

  const keys = path.split(".");
  let obj: unknown = locales[locale];
  for (const k of keys) {
    if (typeof obj !== "object" || obj === null || !Object.hasOwn(obj, k)) {
      return [];
    }
    obj = (obj as Record<string, unknown>)[k];
  }

  if (typeof obj !== "object" || obj === null) return [];

  // Return only keys whose values are objects (sub-namespaces), not leaf strings
  return Object.entries(obj as Record<string, unknown>)
    .filter(([, v]) => typeof v === "object" && v !== null)
    .map(([k]) => k);
}

/**
 * Get the default bot name for a specific locale.
 * Uses the localization system to fetch the appropriate bot name based on the server's locale.
 * Falls back to environment variables and hardcoded defaults if locale keys are not found.
 * @param locale - The locale code (e.g., 'en-US', 'ja')
 * @returns The default bot name for the specified locale
 */
export function getDefaultBotName(locale: string): string {
  // Try to get the bot name from the locale files first
  const localizedName = localizer(locale, "general.defaults.bot_name");

  // If we got a valid localized name (not the key itself), return it
  if (localizedName !== "general.defaults.bot_name") {
    return localizedName;
  }

  // Fallback to environment variables with hardcoded defaults
  // This ensures backward compatibility with existing environment variable configuration
  if (locale === "ja") {
    return process.env.DEFAULT_BOTNAME_JP || "ともり";
  }

  return process.env.DEFAULT_BOTNAME || "Tomori";
}

/**
 * Get the base trigger words for a specific locale.
 * Uses the localization system to fetch locale-appropriate trigger words.
 * Falls back to environment variables and hardcoded defaults if locale keys are not found.
 * @param locale - The locale code (e.g., 'en-US', 'ja')
 * @returns Array of base trigger words for the specified locale
 */
export function getBaseTriggerWords(locale: string): string[] {
  // Check if localization system is initialized
  if (!isInitialized) {
    log.warn("Localization system not initialized when requesting base trigger words");
    // Fallback to environment variable or hardcoded defaults
    return (
      process.env.BASE_TRIGGER_WORDS?.split(",").map((word) => word.trim()) || ["tomori", "tomo", "トモリ", "ともり"]
    );
  }

  // Determine the locale to use, falling back to 'en-US'
  const fallbackLocale = "en-US";
  const usedLocale = locales[locale] ? locale : fallbackLocale;

  // Navigate to the base_trigger_words in the locale object
  const localeData = locales[usedLocale];
  if (
    localeData &&
    typeof localeData === "object" &&
    "general" in localeData &&
    typeof localeData.general === "object" &&
    localeData.general !== null &&
    "defaults" in localeData.general &&
    typeof localeData.general.defaults === "object" &&
    localeData.general.defaults !== null &&
    "base_trigger_words" in localeData.general.defaults
  ) {
    const triggerWords = (localeData.general.defaults as Record<string, unknown>).base_trigger_words;

    // Validate it's an array of strings
    if (Array.isArray(triggerWords) && triggerWords.every((word) => typeof word === "string")) {
      return triggerWords as string[];
    }
  }

  // Fallback to environment variables with hardcoded defaults
  // This ensures backward compatibility with existing environment variable configuration
  return (
    process.env.BASE_TRIGGER_WORDS?.split(",").map((word) => word.trim()) || ["tomori", "tomo", "トモリ", "ともり"]
  );
}
