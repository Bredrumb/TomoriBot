import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Glob } from "bun";
import { type LocaleCode, isDiscordLocaleCode } from "@/constants/locales";
import {
  GitUnavailableError,
  LocaleParseError,
  MissingBaseRefError,
  type StalenessReport,
  checkLocaleStaleness,
  renderStalenessReport,
} from "../checks/checkLocaleStaleness";
import {
  type DriftReport,
  type DriftedEntry,
  DriftHistoryError,
  analyzeLocaleDrift,
  createGitDriftSource,
  formatDriftReport,
} from "./localeDrift";

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
 * A drifted finding with the discriminant the export needs.
 *
 * The analysis in {@link ./localeDrift} already reports the shape a batch translator needs, so this
 * only adds the reason tag rather than restating every field.
 */
export interface DriftedStaleEntry extends DriftedEntry {
  reason: "drifted";
}

/** A translation this branch did not touch after changing its English source. */
export interface UnfollowedStaleEntry {
  key: string;
  en: string;
  previousEn?: string;
  target?: string;
  locale: LocaleCode;
  reason: "unfollowed";
  change: "added" | "changed";
}

export type AnyStaleEntry = StaleEntry | DriftedStaleEntry | UnfollowedStaleEntry;

/** Reasons the CLI accepts, in report order. */
export const STALE_REASONS = ["identical", "likely_english", "drifted", "unfollowed"] as const;
export type StaleReason = (typeof STALE_REASONS)[number];
const DEFAULT_STALE_REASONS: readonly StaleReason[] = ["identical", "likely_english", "drifted"];

export function isStaleReason(value: string): value is StaleReason {
  return (STALE_REASONS as readonly string[]).includes(value);
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
 * Validates a caller-supplied locale and returns the locales to scan.
 *
 * Shared by both scan kinds so `--locale` rejects `en-US` and unknown trees identically whether the
 * caller asked for a value comparison, a drift comparison, or both.
 */
async function resolveTargetLocales(targetLocale?: string, repoRoot = process.cwd()): Promise<LocaleCode[]> {
  if (!targetLocale) {
    const localesToCheck: LocaleCode[] = [];
    const localesDir = join(repoRoot, "src", "locales");
    const glob = new Glob("*");
    for await (const entry of glob.scan({ cwd: localesDir, onlyFiles: false })) {
      if (entry !== "en-US" && isDiscordLocaleCode(entry)) {
        localesToCheck.push(entry);
      }
    }
    return localesToCheck;
  }

  if (!isDiscordLocaleCode(targetLocale)) {
    throw new Error(`Invalid Discord locale code: ${targetLocale}`);
  }
  if (targetLocale === "en-US") {
    throw new Error(`"en-US" is the English source and cannot be scanned as a translation target.`);
  }
  const targetDir = join(repoRoot, "src", "locales", targetLocale);
  if (!existsSync(targetDir)) {
    throw new Error(`Locale "${targetLocale}" does not exist in src/locales/`);
  }

  return [targetLocale];
}

/**
 * Collects translations whose English source moved after the key was translated.
 *
 * Reads history through {@link createGitDriftSource}, so this needs a checkout with the commits the
 * blame reaches. `DriftHistoryError` carries the git failure the caller should report verbatim,
 * which is what a shallow clone produces.
 */
export async function findDriftedTranslations(targetLocale?: string, repoRoot = process.cwd()): Promise<DriftReport> {
  const source = createGitDriftSource(repoRoot);
  const authoredLocales = source.listTranslationLocales();
  let locales: LocaleCode[];

  if (targetLocale) {
    if (!isDiscordLocaleCode(targetLocale)) {
      throw new Error(`Invalid Discord locale code: ${targetLocale}`);
    }
    if (targetLocale === "en-US") {
      throw new Error(`"en-US" is the English source and cannot be scanned as a translation target.`);
    }
    if (!authoredLocales.includes(targetLocale)) {
      throw new Error(`Locale "${targetLocale}" does not exist in committed HEAD under src/locales/`);
    }
    locales = [targetLocale];
  } else {
    locales = authoredLocales.filter((locale): locale is LocaleCode => isDiscordLocaleCode(locale));
  }

  // A shallow checkout cannot answer this question, and it fails in the worst possible direction.
  // `git blame` attributes every line to the grafted root, whose English file is the newest one the
  // clone holds, so the comparison finds nothing and the report reads as clean. Refuse instead.
  if (source.isShallow()) {
    throw new DriftHistoryError("this checkout is shallow, so translation baselines are missing");
  }

  const englishFiles = source.listLocaleFiles("en-US");

  const entries: DriftedEntry[] = [];
  const files: DriftReport["files"] = [];

  for (const locale of locales) {
    const report = analyzeLocaleDrift({ locale, source, englishFiles });
    files.push(...report.files);
    for (const entry of report.entries) {
      entries.push(entry);
    }
  }

  entries.sort((a, b) => a.locale.localeCompare(b.locale) || a.key.localeCompare(b.key));
  files.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));

  return { entries, files, scannedLocales: locales };
}

/**
 * Finds branch-local translation follow-up without granting it a separate command surface.
 *
 * Unlike the historical `drifted` reason, this only asks whether a translation moved in the same
 * branch as its English source. It remains opt-in because a no-argument stale scan must not need a
 * merge base.
 */
export async function findUnfollowedTranslations(base?: string, repoRoot = process.cwd()): Promise<StalenessReport> {
  return checkLocaleStaleness({ repoRoot, base });
}

/** Turns branch follow-up into the batch-export shape used by the other stale reasons. */
export function unfollowedEntries(report: StalenessReport, locale?: string): UnfollowedStaleEntry[] {
  const entries: UnfollowedStaleEntry[] = [];
  const addEntries = (change: "added" | "changed", reports: typeof report.added): void => {
    for (const reportEntry of reports) {
      for (const status of [...reportEntry.review, ...reportEntry.missing]) {
        if (locale && status.locale !== locale) continue;
        entries.push({
          key: reportEntry.key,
          en: reportEntry.english,
          previousEn: reportEntry.previousEnglish,
          target: status.value,
          locale: status.locale as LocaleCode,
          reason: "unfollowed",
          change,
        });
      }
    }
  };

  addEntries("added", report.added);
  addEntries("changed", report.changed);
  return entries.sort((left, right) => left.locale.localeCompare(right.locale) || left.key.localeCompare(right.key));
}

/** Keeps the human branch report aligned with the locale filter used by its export. */
export function filterUnfollowedReport(report: StalenessReport, locale?: string): StalenessReport {
  if (!locale) return report;

  const filterEntries = (entries: typeof report.added): typeof report.added =>
    entries
      .map((entry) => ({
        ...entry,
        review: entry.review.filter((status) => status.locale === locale),
        missing: entry.missing.filter((status) => status.locale === locale),
      }))
      .filter((entry) => entry.review.length > 0 || entry.missing.length > 0);

  return {
    ...report,
    translationLocales: report.translationLocales.filter((candidate) => candidate === locale),
    added: filterEntries(report.added),
    changed: filterEntries(report.changed),
    removed: report.removed,
    localeEditCounts: new Map([...report.localeEditCounts].filter(([candidate]) => candidate === locale || candidate === "en-US")),
  };
}

/**
 * Finds keys where a translation is either identical to the English value (never translated)
 * or contains Latin letters with zero characters of the expected script (for non-Latin locales).
 */
export async function findStaleTranslations(targetLocale?: string): Promise<StaleEntry[]> {
  const enLocale = await loadMergedLocale("en-US");
  const enFlat = flatten(enLocale);

  const localesToCheck = await resolveTargetLocales(targetLocale);

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
 *   (default)            Print a compact human-readable review list to the console
 *   --export             Write a JSON file for batch translation
 *   --locale=<code>      Filter scan to a specific locale
 *   --reason=<reason>    Limit the scan to one reason, repeatable
 *   --base=<ref>         Compare against a branch base for --reason=unfollowed
 *
 * Exit codes: 0 with findings, 1 for a script error, 2 when the drift scan cannot reach the history
 * it needs. A git failure is reported rather than swallowed, because a shallow clone otherwise
 * reports every tree as clean.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const doExport = args.includes("--export");
  const localeArg = args.find((arg) => arg.startsWith("--locale="))?.split("=")[1] ??
    (args.includes("--locale") ? args[args.indexOf("--locale") + 1] : undefined);
  const baseFlagIndex = args.findIndex((arg) => arg === "--base");
  const baseEquals = args.find((arg) => arg.startsWith("--base="));
  const base = baseEquals
    ? baseEquals.slice("--base=".length)
    : baseFlagIndex >= 0
      ? args[baseFlagIndex + 1]
      : undefined;
  if (baseFlagIndex >= 0 && !base) {
    throw new Error("--base requires a git ref argument (for example, --base=origin/main)");
  }

  const reasonArgs = args.filter((arg) => arg.startsWith("--reason=")).map((arg) => arg.split("=")[1]);
  const unknownReasons = reasonArgs.filter((value) => !isStaleReason(value));
  if (unknownReasons.length > 0) {
    throw new Error(`Unknown --reason value: ${unknownReasons.join(", ")}. Known: ${STALE_REASONS.join(", ")}`);
  }

  const requestedReasons: StaleReason[] = reasonArgs.length > 0 ? (reasonArgs as StaleReason[]) : [...DEFAULT_STALE_REASONS];
  const wantsReason = (reason: StaleReason): boolean => requestedReasons.includes(reason);
  if (base && !wantsReason("unfollowed")) {
    throw new Error("--base only applies to --reason=unfollowed");
  }

  log.info(`Scanning for stale translations${localeArg ? ` in ${localeArg}` : ""}...`);

  const staleValueEntries = wantsReason("identical") || wantsReason("likely_english")
    ? await findStaleTranslations(localeArg)
    : [];
  const identical = wantsReason("identical") ? staleValueEntries.filter((e) => e.reason === "identical") : [];
  const likelyEnglish = wantsReason("likely_english")
    ? staleValueEntries.filter((e) => e.reason === "likely_english")
    : [];

  let drift: DriftReport | undefined;
  if (wantsReason("drifted")) {
    drift = await findDriftedTranslations(localeArg);
  }

  let unfollowed: StalenessReport | undefined;
  let unfollowedExport: UnfollowedStaleEntry[] = [];
  if (wantsReason("unfollowed")) {
    if (localeArg) await resolveTargetLocales(localeArg);
    unfollowed = filterUnfollowedReport(await findUnfollowedTranslations(base), localeArg);
    unfollowedExport = unfollowedEntries(unfollowed, localeArg);
  }

  log.info(`Found ${identical.length + likelyEnglish.length + (drift?.entries.length ?? 0) + unfollowedExport.length} potentially stale entries:`);
  log.info(`  • ${identical.length} keys with value identical to English (never translated)`);
  log.info(`  • ${likelyEnglish.length} keys with value that appears to be English text`);
  log.info(`  • ${drift?.entries.length ?? 0} keys whose English source moved after the translation`);
  log.info(`  • ${unfollowedExport.length} locale/key pairs not updated with this branch's English changes`);

  if (!doExport) {
    const grouped = new Map<string, StaleEntry[]>();
    for (const entry of [...identical, ...likelyEnglish]) {
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

    if (drift) {
      for (const line of formatDriftReport(drift)) console.log(line);
    }
    if (unfollowed) {
      console.log(`\n${renderStalenessReport(unfollowed, { verboseOutput: args.includes("--verbose") })}`);
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log("Run with --export to write stale-translations.json for batch translation.");
  } else {
    // Drifted entries keep their own shape rather than being flattened into the value-comparison
    // one. A batch translator needs the superseded English to judge whether a re-read is warranted,
    // and dropping that field would leave a bare list of keys that look translated already.
    const drifted: DriftedStaleEntry[] = (drift?.entries ?? []).map((entry) => ({ ...entry, reason: "drifted" }));
    const exported: AnyStaleEntry[] = [...identical, ...likelyEnglish, ...drifted, ...unfollowedExport];
    const outputPath = join(process.cwd(), "scripts", "maintenance", "stale-translations.json");
    await mkdir(join(process.cwd(), "scripts", "maintenance"), { recursive: true });
    await writeFile(outputPath, JSON.stringify(exported, null, 2), "utf-8");
    log.success(`Exported ${exported.length} entries to ${outputPath}`);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    if (err instanceof DriftHistoryError) {
      console.error(`Cannot read repository history: ${err.message}`);
      console.error("A shallow clone has no blame history. Fetch the full history and re-run:");
      console.error("  git fetch --unshallow");
      process.exit(2);
    }
    if (err instanceof MissingBaseRefError) {
      console.error(`Cannot compare this branch: ${err.message}`);
      process.exit(2);
    }
    if (err instanceof GitUnavailableError || err instanceof LocaleParseError) {
      console.error("Fatal error:", err.message);
      process.exit(1);
    }
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
