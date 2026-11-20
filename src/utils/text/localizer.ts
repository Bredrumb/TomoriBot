import path from "node:path";
import { readdir } from "node:fs/promises";
import { Glob } from "bun";
import { LOCALE_DISPLAY_ORDER } from "@/constants/docsLocales";
import { isDiscordLocaleCode, LOCALE_ALIASES, type LocaleCode } from "@/constants/locales";
import type { LocaleObject, Locales, LocaleValue, LocalizerVariables } from "../../types/discord/global";
import { log } from "../misc/logger";
import { initializeEmbedProtocol } from "@/utils/discord/embedProtocol";
import { initializeIntentPacks } from "@/utils/text/localeIntentPacks";

interface LocalizerRuntimeState {
  locales: Locales;
  isInitialized: boolean;
  initializationPromise: Promise<void> | null;
  warnedFallbackKeys: Set<string>;
}

const LOCALIZER_RUNTIME_STATE = Symbol.for("tomoribot-localizer-runtime-state");
const localizerState =
  (Reflect.get(globalThis, LOCALIZER_RUNTIME_STATE) as LocalizerRuntimeState | undefined) ??
  ({
    locales: {},
    isInitialized: false,
    initializationPromise: null,
    warnedFallbackKeys: new Set<string>(),
  } satisfies LocalizerRuntimeState);
Reflect.set(globalThis, LOCALIZER_RUNTIME_STATE, localizerState);

const locales = localizerState.locales;

function dedent(str: string): string {
  if (!str?.includes("\n")) return str;

  const lines = str.split("\n");

  const firstNonEmptyLine = lines.find((line) => line.trim().length > 0);
  if (!firstNonEmptyLine) return str;

  const match = firstNonEmptyLine.match(/^[ \t]+/);
  if (!match) return str;

  const indent = match[0];
  const indentRegex = new RegExp(`^${indent}`);

  return lines.map((line) => (line.trim().length > 0 ? line.replace(indentRegex, "") : line)).join("\n");
}

export function initializeLocalizer(): Promise<void> {
  if (localizerState.isInitialized) return Promise.resolve();
  if (localizerState.initializationPromise) return localizerState.initializationPromise;

  localizerState.initializationPromise = initializeLocalizerUncached().catch((error) => {
    localizerState.initializationPromise = null;
    throw error;
  });
  return localizerState.initializationPromise;
}

async function initializeLocalizerUncached(): Promise<void> {
  try {
    const localesDir = path.resolve("src", "locales");
    const entries = await readdir(localesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const locale = entry.name;
      if (!isDiscordLocaleCode(locale) || Object.hasOwn(LOCALE_ALIASES, locale)) {
        log.error(`Skipping unsupported or aliased locale directory: ${locale}`);
        continue;
      }
      const localeDir = path.join(localesDir, locale);
      const merged: Record<string, unknown> = {};

      const glob = new Glob("*.ts");
      for await (const file of glob.scan(localeDir)) {
        try {
          const module = await import(path.join(localeDir, file));
          const slice = module.default as Record<string, unknown>;

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
      localizerState.isInitialized = true;
      try {
        initializeEmbedProtocol();
        initializeIntentPacks();
      } catch (error) {
        localizerState.isInitialized = false;
        throw error;
      }
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

function processLocaleStrings(obj: unknown): LocaleValue {
  if (typeof obj === "string") {
    return dedent(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map((value) => (typeof value === "string" ? dedent(value) : String(value)));
  }

  if (typeof obj === "object" && obj !== null) {
    const result: LocaleObject = {};

    for (const [key, value] of Object.entries(obj)) {
      result[key] = processLocaleStrings(value);
    }

    return result;
  }

  return String(obj);
}

const FALLBACK_LOCALE = "en-US";

export function resolveDescription(
  descriptions: Record<string, string> | null | undefined,
  locale: string,
): string | null {
  if (descriptions) {
    const base = locale.split("-")[0];
    for (const key of [locale, base]) {
      const value = descriptions[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
    const matching = Object.entries(descriptions).find(
      ([key, value]) => key.split("-")[0] === base && typeof value === "string" && value.length > 0,
    );
    if (matching) return matching[1];
    const english = descriptions[FALLBACK_LOCALE];
    if (typeof english === "string" && english.length > 0) return english;
  }
  return null;
}
// English `system_prompt_preset_name` doubles as the stored identity as well as the fallback, so localized labels
// stay in `display_names`.
export function resolvePresetDisplayName(
  preset: { system_prompt_preset_name: string; display_names?: Record<string, string> | null },
  locale: string,
): string {
  return resolveDescription(preset.display_names, locale) ?? preset.system_prompt_preset_name;
}

const DEFAULT_BASE_TRIGGER_WORDS = ["tomori", "tomo"];

function resolveAuthoredLocale(locale: string): LocaleCode | null {
  if (isDiscordLocaleCode(locale) && locales[locale]) return locale;

  const alias = LOCALE_ALIASES[locale as keyof typeof LOCALE_ALIASES];
  if (alias && locales[alias]) return alias;

  const base = locale.split("-")[0];
  const matches = Object.keys(locales).filter((code) => code.split("-")[0] === base);
  return matches.length === 1 ? (matches[0] as LocaleCode) : null;
}

export function resolveSupportedLocale(locale: string): LocaleCode {
  return resolveAuthoredLocale(locale) ?? FALLBACK_LOCALE;
}

// Each `locale:key` warns once per process, so a hot path cannot turn a single missing key into a log flood.
const warnedFallbackKeys = localizerState.warnedFallbackKeys;

// Missing keys and non-leaf paths return `undefined` rather than empty string, so callers can distinguish a real miss
// from a legitimately empty leaf.
function lookupLocaleString(locale: string, key: string): string | undefined {
  const localeTree = locales[locale];
  if (!localeTree) return undefined;

  let value: unknown = localeTree;
  for (const segment of key.split(".")) {
    if (typeof value !== "object" || value === null || !Object.hasOwn(value, segment)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }

  return typeof value === "string" ? value : undefined;
}

// Unknown keys echo the key string back rather than throwing or returning empty, because callers compare against the
// key to detect missing entries.
export const localizer = (locale: string, key: string, variables: LocalizerVariables = {}): string => {
  if (!localizerState.isInitialized) {
    log.warn(`Localization system not initialized when requesting key: ${key}`);
    return key;
  }

  const usedLocale = resolveSupportedLocale(locale);

  if (!locales[usedLocale]) {
    log.warn(`Locale '${usedLocale}' not loaded. Returning key: ${key}`);
    return key;
  }

  let translation = lookupLocaleString(usedLocale, key);

  if (translation === undefined && usedLocale !== FALLBACK_LOCALE) {
    translation = lookupLocaleString(FALLBACK_LOCALE, key);

    if (translation !== undefined) {
      const warnedKey = `${usedLocale}:${key}`;
      if (!warnedFallbackKeys.has(warnedKey)) {
        warnedFallbackKeys.add(warnedKey);
        log.warn(`Locale '${usedLocale}' is missing key '${key}'. Falling back to '${FALLBACK_LOCALE}'.`);
      }
    }
  }

  if (translation === undefined) {
    return key;
  }

  let result: string = translation;
  for (const [placeholder, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{${placeholder}}`, "g"), String(value));
  }

  return result;
};

// Ordering comes from `LOCALE_DISPLAY_ORDER` rather than `readdir`, because filesystem directory order varies across
// hosts and must match the docs switcher.
export function getSupportedLocales(): string[] {
  if (!localizerState.isInitialized) {
    log.warn("Localization system not initialized when requesting supported locales");
    return [];
  }

  const loaded = Object.keys(locales);
  const ordered = LOCALE_DISPLAY_ORDER.filter((code) => loaded.includes(code));
  return [...ordered, ...loaded.filter((code) => !ordered.includes(code)).sort()];
}

export function getRegisterableLocales(): LocaleCode[] {
  const registerable = getSupportedLocales() as LocaleCode[];
  for (const [alias, source] of Object.entries(LOCALE_ALIASES)) {
    if (registerable.includes(source)) registerable.push(alias as LocaleCode);
  }
  return registerable;
}

export function getLocaleEndonym(locale: string): string {
  const authored = resolveAuthoredLocale(locale);
  return (authored && lookupLocaleString(authored, "general.language_name")) || locale;
}

export function getLocaleSubKeys(locale: string, path: string): string[] {
  if (!localizerState.isInitialized || !locales[locale]) return [];

  const keys = path.split(".");
  let obj: unknown = locales[locale];
  for (const k of keys) {
    if (typeof obj !== "object" || obj === null || !Object.hasOwn(obj, k)) {
      return [];
    }
    obj = (obj as Record<string, unknown>)[k];
  }

  if (typeof obj !== "object" || obj === null) return [];

  return Object.entries(obj as Record<string, unknown>)
    .filter(([, v]) => typeof v === "object" && v !== null && !Array.isArray(v))
    .map(([k]) => k);
}

// No `en-US` fallback is applied here, because `localizer()` substitutes English on a miss and cannot tell callers
// whether `locale` itself defines `key`.
export function hasLocaleKey(locale: string, key: string): boolean {
  if (!localizerState.isInitialized) return false;

  return lookupLocaleString(locale, key) !== undefined;
}

// No `en-US` fallback is used here because intent packs union across locales, so substituting English for a missing
// list would duplicate entries.
export function getLocaleStringList(locale: string, key: string): string[] | undefined {
  if (!localizerState.isInitialized) return undefined;

  let value: unknown = locales[locale];
  for (const segment of key.split(".")) {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !Object.hasOwn(value, segment)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }

  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? [...value] : undefined;
}

export function getDefaultBotName(locale: string): string {
  const localizedName = localizer(locale, "general.defaults.bot_name");

  if (localizedName !== "general.defaults.bot_name") {
    return localizedName;
  }

  return process.env.DEFAULT_BOTNAME || "Tomori";
}

export function getBaseTriggerWords(locale: string): string[] {
  if (!localizerState.isInitialized) {
    log.warn("Localization system not initialized when requesting base trigger words");
    return [...DEFAULT_BASE_TRIGGER_WORDS];
  }

  const readWords = (code: string): string[] | null => {
    const general = locales[code]?.general;
    if (!general || typeof general !== "object" || Array.isArray(general)) return null;
    const defaults = general.defaults;
    if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) return null;
    const words = defaults.base_trigger_words;
    return Array.isArray(words) && words.every((word) => typeof word === "string") ? [...words] : null;
  };

  return readWords(resolveSupportedLocale(locale)) ?? readWords(FALLBACK_LOCALE) ?? [...DEFAULT_BASE_TRIGGER_WORDS];
}

// Number formatting uses `resolveSupportedLocale(locale)` rather than raw `locale`, so digit grouping matches the
// surrounding sentence's locale.
export function formatLocaleInteger(value: number, locale: string): string {
  return Math.round(value).toLocaleString(resolveSupportedLocale(locale));
}

// All authored locales are unioned because members can address the bot in any shipped language and an alter must
// never claim its localized name.
export function getAllBaseTriggerWords(localeCodes: readonly string[] = getSupportedLocales()): string[] {
  const codes = localeCodes.length > 0 ? localeCodes : [FALLBACK_LOCALE];
  return [...new Set(codes.flatMap((code) => getBaseTriggerWords(code)))];
}
