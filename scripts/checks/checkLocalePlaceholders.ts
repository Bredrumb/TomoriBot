import { existsSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { type LocaleCode, isDiscordLocaleCode } from "@/constants/locales";

/**
 * Lightweight logger
 */
const log = {
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  warn: (msg: string) => console.warn(`⚠️  ${msg}`),
  error: (msg: string) => console.error(`❌ ${msg}`),
  success: (msg: string) => console.log(`✅ ${msg}`),
};

/**
 * Recursively flattens a nested locale object into dot-notation key → value pairs.
 * Skips array values as they are locale-specific configurations.
 */
export function flattenLocale(obj: unknown, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};

  if (typeof obj === "string") {
    if (prefix) result[prefix] = obj;
    return result;
  }

  if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      Object.assign(result, flattenLocale(v, path));
    }
  }

  return result;
}

/**
 * Extracts unique placeholder names in appearance order from a localized string.
 * Placeholders follow the `{name}` format interpolated by localizer().
 */
export function extractPlaceholders(text: string): string[] {
  const matches = text.matchAll(/\{([a-zA-Z0-9_]+)\}/g);
  const seen = new Set<string>();
  const placeholders: string[] = [];
  for (const match of matches) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      placeholders.push(match[1]);
    }
  }
  return placeholders;
}

export interface PlaceholderParityIssue {
  key: string;
  locale: string;
  missingInTarget: string[];
  extraInTarget: string[];
}

export interface PlaceholderCheckSummary {
  localesChecked: string[];
  totalKeysExamined: number;
  errors: PlaceholderParityIssue[];
  warnings: PlaceholderParityIssue[];
}

/**
 * Compares placeholder signatures between an English source string and a translated target string.
 *
 * Missing English placeholders in the translation are ERRORS (user loses runtime data).
 * Extra placeholders in the translation are WARNINGS (may be supplied by callers, but not in en-US).
 */
export function checkKeyPlaceholderParity(
  key: string,
  enText: string,
  targetText: string,
  locale: string,
): PlaceholderParityIssue | null {
  const enPlaceholders = extractPlaceholders(enText);
  const targetPlaceholders = extractPlaceholders(targetText);

  if (enPlaceholders.length === 0 && targetPlaceholders.length === 0) {
    return null;
  }

  const enSet = new Set(enPlaceholders);
  const targetSet = new Set(targetPlaceholders);

  const missingInTarget = enPlaceholders.filter((p) => !targetSet.has(p));
  const extraInTarget = targetPlaceholders.filter((p) => !enSet.has(p));

  if (missingInTarget.length === 0 && extraInTarget.length === 0) {
    return null;
  }

  return {
    key,
    locale,
    missingInTarget,
    extraInTarget,
  };
}

/**
 * Loads and merges all category slice files for a locale into one flat record.
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
 * Runs placeholder parity analysis between en-US and target locales.
 */
export async function analyzePlaceholderParity(targetLocale?: string): Promise<PlaceholderCheckSummary> {
  const enLocale = await loadMergedLocale("en-US");
  const enFlat = flattenLocale(enLocale);

  const localesToCheck: LocaleCode[] = [];
  if (targetLocale) {
    if (!isDiscordLocaleCode(targetLocale)) {
      throw new Error(`Invalid Discord locale code: ${targetLocale}`);
    }
    if (targetLocale === "en-US") {
      throw new Error(
        `"en-US" is the English source template and cannot be checked as a target translation.`,
      );
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

  const errors: PlaceholderParityIssue[] = [];
  const warnings: PlaceholderParityIssue[] = [];
  let totalKeysExamined = 0;

  for (const locale of localesToCheck) {
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
    const targetFlat = flattenLocale(targetLocaleObj);

    for (const [key, enValue] of Object.entries(enFlat)) {
      const targetValue = targetFlat[key];
      if (typeof targetValue !== "string") continue; // missing keys are a parity gate concern

      totalKeysExamined++;
      const issue = checkKeyPlaceholderParity(key, enValue, targetValue, locale);
      if (issue) {
        if (issue.missingInTarget.length > 0) {
          errors.push(issue);
        } else if (issue.extraInTarget.length > 0) {
          warnings.push(issue);
        }
      }
    }
  }

  if (totalKeysExamined === 0 && localesToCheck.length > 0) {
    throw new Error(`No translation keys found to examine for ${localesToCheck.join(", ")}`);
  }

  return {
    localesChecked: localesToCheck,
    totalKeysExamined,
    errors,
    warnings,
  };
}

/** Prints the placeholder section of `check-locales` and returns whether no placeholder was lost. */
export async function reportPlaceholderParity(): Promise<boolean> {
  log.info("Checking locale placeholder parity…");
  const summary = await analyzePlaceholderParity();

  if (summary.warnings.length > 0) {
    console.log(`\n${"-".repeat(80)}`);
    console.log(`⚠️  PLACEHOLDER WARNINGS: Extra placeholders in translation (${summary.warnings.length})`);
    console.log("   (Call sites may supply these variables, but en-US does not reference them)");
    console.log(`${"-".repeat(80)}`);
    for (const w of summary.warnings) {
      console.log(`  • [${w.locale}] ${w.key}: extra {${w.extraInTarget.join("}, {")}}`);
    }
  }

  if (summary.errors.length > 0) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`❌ PLACEHOLDER ERRORS: Missing English placeholders (${summary.errors.length})`);
    console.log("   (User will miss runtime data or see broken placeholders in embeds)");
    console.log(`${"=".repeat(80)}`);
    for (const e of summary.errors) {
      console.log(`  • [${e.locale}] ${e.key}`);
      console.log(`    Missing from translation: {${e.missingInTarget.join("}, {")}}`);
      if (e.extraInTarget.length > 0) {
        console.log(`    Renamed/extra in translation: {${e.extraInTarget.join("}, {")}}`);
      }
    }
  }

  console.log(`\n${"=".repeat(80)}`);
  if (summary.errors.length === 0) {
    log.success(
      `Placeholder parity check PASSED across ${summary.localesChecked.join(", ")}: 0 errors, ${summary.warnings.length} warning(s)`,
    );
    return true;
  }
  log.error(`Placeholder parity check FAILED: ${summary.errors.length} error(s), ${summary.warnings.length} warning(s)`);
  return false;
}
