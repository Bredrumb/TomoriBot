import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Glob } from "bun";
import { type LocaleCode, isDiscordLocaleCode } from "@/constants/locales";

/**
 * Lightweight logger (no DB dependency)
 */
const log = {
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  warn: (msg: string) => console.warn(`⚠️  ${msg}`),
  success: (msg: string) => console.log(`✅ ${msg}`),
};

export type ExpectedScript =
  | "latin"
  | "cjk"
  | "cyrillic"
  | "hangul"
  | "greek"
  | "devanagari"
  | "thai";

/**
 * Script a locale's strings are expected to be written in. Locales on Latin script cannot use
 * the "contains no non-Latin characters" staleness signal at all, so they fall back to
 * exact-match-with-English only.
 */
export const EXPECTED_SCRIPT: Record<LocaleCode, ExpectedScript> = {
  id: "latin",
  da: "latin",
  de: "latin",
  "en-GB": "latin",
  "en-US": "latin",
  "es-ES": "latin",
  "es-419": "latin",
  fr: "latin",
  hr: "latin",
  it: "latin",
  lt: "latin",
  hu: "latin",
  nl: "latin",
  no: "latin",
  pl: "latin",
  "pt-BR": "latin",
  ro: "latin",
  fi: "latin",
  "sv-SE": "latin",
  vi: "latin",
  tr: "latin",
  cs: "latin",
  el: "greek",
  bg: "cyrillic",
  ru: "cyrillic",
  uk: "cyrillic",
  hi: "devanagari",
  th: "thai",
  "zh-CN": "cjk",
  ja: "cjk",
  "zh-TW": "cjk",
  ko: "hangul",
};

/**
 * Recursively flattens a nested locale object into dot-notation key → value pairs.
 * Skips array values (e.g. base_trigger_words) as they are locale-specific by design.
 */
export function flatten(obj: unknown, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};

  if (typeof obj === "string") {
    if (prefix) result[prefix] = obj;
    return result;
  }

  if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      Object.assign(result, flatten(v, path));
    }
  }

  return result;
}

/**
 * Counts target-script and Latin letters in a string after stripping placeholders, URLs, and emoji.
 */
export function countScriptLetters(
  value: string,
  script: ExpectedScript,
): { latinCount: number; targetCount: number } {
  const stripped = value
    .replace(/\{[^}]+\}/g, "") // remove {placeholders}
    .replace(/https?:\/\/\S+/g, "") // remove URLs
    .replace(/[\p{Extended_Pictographic}\u{1F000}-\u{1FFFF}]/gu, "") // remove emoji
    .trim();

  const latinCount = (stripped.match(/\p{Script=Latin}/gu) ?? []).length;
  let targetCount = 0;

  switch (script) {
    case "cjk":
      targetCount = (stripped.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []).length;
      break;
    case "cyrillic":
      targetCount = (stripped.match(/\p{Script=Cyrillic}/gu) ?? []).length;
      break;
    case "hangul":
      targetCount = (stripped.match(/\p{Script=Hangul}/gu) ?? []).length;
      break;
    case "greek":
      targetCount = (stripped.match(/\p{Script=Greek}/gu) ?? []).length;
      break;
    case "devanagari":
      targetCount = (stripped.match(/\p{Script=Devanagari}/gu) ?? []).length;
      break;
    case "thai":
      targetCount = (stripped.match(/\p{Script=Thai}/gu) ?? []).length;
      break;
    case "latin":
      targetCount = latinCount;
      break;
  }

  return { latinCount, targetCount };
}

/**
 * Checks if a string in a non-Latin locale contains Latin characters but zero characters of the
 * expected script, indicating the value was never translated from English. Latin-script locales
 * (including Vietnamese) cannot use this signal because their translated strings are naturally Latin.
 */
export function looksLikeEnglish(value: string, expectedScript: ExpectedScript): boolean {
  if (expectedScript === "latin") return false;

  const { latinCount, targetCount } = countScriptLetters(value, expectedScript);
  return latinCount > 0 && targetCount === 0;
}

/**
 * Identifies values that are intentionally shared across languages:
 * brand names, emojis/placeholders-only templates, technical option IDs, and
 * sample placeholders such as URLs, model IDs, or prompt tag examples.
 *
 * Strips only non-letter characters (`[^\p{L}]`) so that non-Latin scripts (Cyrillic, Hangul,
 * CJK, Greek, etc.) retain their letters and are not falsely classified as empty/shared.
 */
export function isIntentionallySharedTranslation(key: string, value: string): boolean {
  const stripped = value
    .replace(/\{[^}]+\}/g, "") // remove {placeholders}
    .replace(/https?:\/\/\S+/g, "") // remove URLs
    .replace(/[\p{Extended_Pictographic}\u{1F000}-\u{1FFFF}]/gu, "") // remove emoji
    .replace(/[^\p{L}]/gu, "") // keep only letters across any Unicode script
    .trim();

  if (stripped.length === 0) {
    return true;
  }

  if (
    /^commands\.help\.api-key\.provider_choice_/.test(key) &&
    key !== "commands.help.api-key.provider_choice_custom"
  ) {
    return true;
  }

  if (key === "commands.tool.visualize.modal.backend_novelai_label") {
    return true;
  }

  if (
    /^commands\.novelai\.image\.params\.sampler_option_/.test(key) ||
    key === "commands.novelai.image.params.noise_schedule_option_karras"
  ) {
    return true;
  }

  if (key.endsWith("_placeholder")) {
    const placeholderPatterns = [
      /^https?:\/\/\S+$/i,
      /^[a-z0-9][a-z0-9._/-]*$/i,
      /^[0-9]+(?:\s*-\s*[0-9]+)?$/,
      /^[a-z0-9_:-]+(?:,\s*[a-z0-9_:-]+)+$/i,
      /^[a-z0-9_][a-z0-9_-]*(?:\s+[a-z0-9_][a-z0-9_-]*)*(?:,\s*[a-z0-9_][a-z0-9_-]*(?:\s+[a-z0-9_][a-z0-9_-]*)*)+$/i,
    ];

    if (placeholderPatterns.some((pattern) => pattern.test(value))) {
      return true;
    }
  }

  return false;
}

export interface StaleEntry {
  key: string;
  en: string;
  target: string;
  locale: LocaleCode;
  reason: "identical" | "likely_english";
}

/**
 * Loads and merges all category slice files for a locale into a single flat object.
 */
export async function loadMergedLocale(localeName: string): Promise<Record<string, unknown>> {
  const localeDir = join(process.cwd(), "src", "locales", localeName);
  const merged: Record<string, unknown> = {};
  const glob = new Glob("*.ts");
  for await (const file of glob.scan(localeDir)) {
    const module = await import(join(localeDir, file));
    Object.assign(merged, module.default);
  }
  return merged;
}

/**
 * Finds keys where a translation is either identical to the English value (never translated)
 * or contains Latin letters with zero characters of the expected script (for non-Latin locales).
 */
export async function findStaleTranslations(targetLocale?: string): Promise<StaleEntry[]> {
  const enLocale = await loadMergedLocale("en-US");
  const enFlat = flatten(enLocale);

  const localesToCheck: LocaleCode[] = [];
  if (targetLocale) {
    if (!isDiscordLocaleCode(targetLocale)) {
      throw new Error(`Invalid Discord locale code: ${targetLocale}`);
    }
    if (targetLocale === "en-US") {
      throw new Error(`"en-US" is the English source and cannot be scanned as a translation target.`);
    }
    const targetDir = join(process.cwd(), "src", "locales", targetLocale);
    if (!existsSync(targetDir)) {
      throw new Error(`Locale "${targetLocale}" does not exist in src/locales/`);
    }
    localesToCheck.push(targetLocale);
  } else {
    const localesDir = join(process.cwd(), "src", "locales");
    const glob = new Glob("*");
    for await (const entry of glob.scan({ cwd: localesDir, onlyFiles: false })) {
      if (entry !== "en-US" && isDiscordLocaleCode(entry)) {
        localesToCheck.push(entry);
      }
    }
  }

  const stale: StaleEntry[] = [];

  for (const locale of localesToCheck) {
    const script = EXPECTED_SCRIPT[locale] ?? "latin";
    let targetLocaleObj: Record<string, unknown>;
    try {
      targetLocaleObj = await loadMergedLocale(locale);
    } catch (error) {
      if (targetLocale) {
        throw new Error(
          `Failed to load locale "${locale}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      continue;
    }
    const targetFlat = flatten(targetLocaleObj);

    for (const [key, enValue] of Object.entries(enFlat)) {
      const targetValue = targetFlat[key];
      if (!targetValue) continue; // missing keys are a parity issue, not a staleness issue

      // Intentionally shared strings bypass both identical and likely-English checks
      if (isIntentionallySharedTranslation(key, targetValue)) {
        continue;
      }

      if (targetValue === enValue) {
        stale.push({ key, en: enValue, target: targetValue, locale, reason: "identical" });
      } else if (looksLikeEnglish(targetValue, script)) {
        stale.push({ key, en: enValue, target: targetValue, locale, reason: "likely_english" });
      }
    }
  }

  return stale.sort((a, b) => a.locale.localeCompare(b.locale) || a.key.localeCompare(b.key));
}

/**
 * Main entry:
 *   (default)     Print a compact human-readable review list to the console
 *   --export      Write a JSON file for batch translation
 *   --locale=<code> Filter scan to a specific locale
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const doExport = args.includes("--export");
  const localeArg = args.find((arg) => arg.startsWith("--locale="))?.split("=")[1] ??
    (args.includes("--locale") ? args[args.indexOf("--locale") + 1] : undefined);

  log.info(`Scanning for stale translations${localeArg ? ` in ${localeArg}` : ""}…`);
  const stale = await findStaleTranslations(localeArg);

  const identical = stale.filter((e) => e.reason === "identical");
  const likelyEnglish = stale.filter((e) => e.reason === "likely_english");

  log.info(`Found ${stale.length} potentially stale entries:`);
  log.info(`  • ${identical.length} keys with value identical to English (never translated)`);
  log.info(`  • ${likelyEnglish.length} keys with value that appears to be English text`);

  if (!doExport) {
    const grouped = new Map<string, StaleEntry[]>();
    for (const entry of stale) {
      const prefix = `${entry.locale}::${entry.key.split(".").slice(0, 3).join(".")}`;
      const group = grouped.get(prefix) ?? [];
      group.push(entry);
      grouped.set(prefix, group);
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log("🔍 STALE TRANSLATION REVIEW");
    console.log("=".repeat(80));

    for (const [prefix, entries] of [...grouped.entries()].sort()) {
      const [loc, keyPrefix] = prefix.split("::");
      console.log(`\n## [${loc}] ${keyPrefix} (${entries.length})`);
      for (const { key, en, target, reason } of entries) {
        const leaf = key.split(".").slice(3).join(".");
        const tag = reason === "identical" ? "[IDENTICAL]" : "[ENGLISH?]";
        console.log(`  ${tag} .${leaf || key}`);
        console.log(`    EN: ${en.slice(0, 80)}${en.length > 80 ? "…" : ""}`);
        console.log(`    ${loc.toUpperCase()}: ${target.slice(0, 80)}${target.length > 80 ? "…" : ""}`);
      }
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log("Run with --export to write stale-translations.json for batch translation.");
  } else {
    const outputPath = join(process.cwd(), "scripts", "maintenance", "stale-translations.json");
    await mkdir(join(process.cwd(), "scripts", "maintenance"), { recursive: true });
    await writeFile(outputPath, JSON.stringify(stale, null, 2), "utf-8");
    log.success(`Exported ${stale.length} entries to ${outputPath}`);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
