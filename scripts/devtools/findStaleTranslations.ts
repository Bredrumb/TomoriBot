import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Glob } from "bun";
import { PUBLISHED_DOCS_LOCALES } from "@/constants/docsLocales";
import { type LocaleCode, isDiscordLocaleCode } from "@/constants/locales";
import {
  GitUnavailableError,
  LocaleParseError,
  MissingBaseRefError,
  type StalenessReport,
  checkLocaleStaleness,
  defaultGitRunner,
  renderStalenessReport,
  resolveBaseRef,
} from "../checks/checkLocaleStaleness";
import {
  type DocsStaleEntry,
  createGitDocsSource,
  findDocsTreeStaleness,
  findDocsUnfollowed,
  formatDocsStaleness,
} from "./docsStaleness";
import {
  type DriftReport,
  type DriftedEntry,
  DriftHistoryError,
  analyzeLocaleDrift,
  createGitDriftSource,
  formatDriftReport,
} from "./localeDrift";

const log = {
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  warn: (msg: string) => console.warn(`⚠️  ${msg}`),
  success: (msg: string) => console.log(`✅ ${msg}`),
};

export type ExpectedScript = "latin" | "cjk" | "cyrillic" | "hangul" | "greek" | "devanagari" | "thai";

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

// Array values (such as base_trigger_words) are skipped intentionally because they are locale-specific by design
// rather than translations.
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

export function countScriptLetters(value: string, script: ExpectedScript): { latinCount: number; targetCount: number } {
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

export function looksLikeEnglish(value: string, expectedScript: ExpectedScript): boolean {
  if (expectedScript === "latin") return false;

  const { latinCount, targetCount } = countScriptLetters(value, expectedScript);
  return latinCount > 0 && targetCount === 0;
}

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

export interface DriftedStaleEntry extends DriftedEntry {
  reason: "drifted";
}

export interface UnfollowedStaleEntry {
  key: string;
  en: string;
  previousEn?: string;
  target?: string;
  locale: LocaleCode;
  reason: "unfollowed";
  change: "added" | "changed";
}

export type AnyStaleEntry = StaleEntry | DriftedStaleEntry | UnfollowedStaleEntry | DocsStaleEntry;

// Reasons are listed in report order, and missing and orphaned apply only to docs pages since check-locales owns
// missing locale keys.
export const STALE_REASONS = ["identical", "likely_english", "drifted", "unfollowed", "missing", "orphaned"] as const;
export type StaleReason = (typeof STALE_REASONS)[number];
const DEFAULT_STALE_REASONS: readonly StaleReason[] = ["identical", "likely_english", "drifted", "missing", "orphaned"];

export const STALE_SCOPES = ["all", "keys", "docs"] as const;
export type StaleScope = (typeof STALE_SCOPES)[number];

// Callers pass the key scan's resolved merge base so branch follow-up for docs and keys compares the exact same
// commit range.
export function findDocsStaleness(options: {
  reasons: readonly StaleReason[];
  locale?: string;
  mergeBase?: string;
  repoRoot?: string;
}): DocsStaleEntry[] {
  const repoRoot = options.repoRoot ?? process.cwd();
  const locales = PUBLISHED_DOCS_LOCALES.filter((id) => id !== "en" && (!options.locale || id === options.locale));
  if (locales.length === 0) return [];
  const git = createGitDocsSource(repoRoot);
  const entries: DocsStaleEntry[] = [];

  const wantsTree = options.reasons.some(
    (reason) => reason === "drifted" || reason === "missing" || reason === "orphaned",
  );
  if (wantsTree) {
    if (options.reasons.includes("drifted") && createGitDriftSource(repoRoot).isShallow()) {
      throw new DriftHistoryError("this checkout is shallow, so translation baselines are missing");
    }
    entries.push(...findDocsTreeStaleness(git, locales).filter((entry) => options.reasons.includes(entry.reason)));
  }
  if (options.mergeBase && options.reasons.includes("unfollowed")) {
    entries.push(...findDocsUnfollowed(git, options.mergeBase, locales));
  }
  return entries;
}

async function resolveMergeBase(base: string | undefined, repoRoot = process.cwd()): Promise<string> {
  const ref = base ?? (await resolveBaseRef(defaultGitRunner, repoRoot));
  return (await defaultGitRunner(["merge-base", ref, "HEAD"], repoRoot)).trim();
}

export function isStaleReason(value: string): value is StaleReason {
  return (STALE_REASONS as readonly string[]).includes(value);
}

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

// This check stays opt-in rather than part of the default stale scan because a no-argument run must not require a git
// merge base.
export async function findUnfollowedTranslations(base?: string, repoRoot = process.cwd()): Promise<StalenessReport> {
  return checkLocaleStaleness({ repoRoot, base });
}

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
    localeEditCounts: new Map(
      [...report.localeEditCounts].filter(([candidate]) => candidate === locale || candidate === "en-US"),
    ),
  };
}

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
        throw new Error(`Failed to load locale "${locale}": ${error instanceof Error ? error.message : String(error)}`);
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

// Exit code 0 even with findings, and exit 2 on missing git history, because swallowing shallow clone failures would
// report every tree as clean.
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const doExport = args.includes("--export");
  const localeArg =
    args.find((arg) => arg.startsWith("--locale="))?.split("=")[1] ??
    (args.includes("--locale") ? args[args.indexOf("--locale") + 1] : undefined);
  const baseFlagIndex = args.indexOf("--base");
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

  const scopeArg = args.find((arg) => arg.startsWith("--scope="))?.split("=")[1] ?? "all";
  if (!(STALE_SCOPES as readonly string[]).includes(scopeArg)) {
    throw new Error(`Unknown --scope value: ${scopeArg}. Known: ${STALE_SCOPES.join(", ")}`);
  }
  const scansKeys = scopeArg !== "docs";
  const scansDocs = scopeArg !== "keys";

  const requestedReasons: StaleReason[] =
    reasonArgs.length > 0 ? (reasonArgs as StaleReason[]) : [...DEFAULT_STALE_REASONS];
  const wantsReason = (reason: StaleReason): boolean => requestedReasons.includes(reason);
  const wantsKeyReason = (reason: StaleReason): boolean => scansKeys && wantsReason(reason);
  if (base && !wantsReason("unfollowed")) {
    throw new Error("--base only applies to --reason=unfollowed");
  }

  log.info(`Scanning for stale translations${localeArg ? ` in ${localeArg}` : ""}...`);

  const staleValueEntries =
    wantsKeyReason("identical") || wantsKeyReason("likely_english") ? await findStaleTranslations(localeArg) : [];
  const identical = wantsKeyReason("identical") ? staleValueEntries.filter((e) => e.reason === "identical") : [];
  const likelyEnglish = wantsKeyReason("likely_english")
    ? staleValueEntries.filter((e) => e.reason === "likely_english")
    : [];

  let drift: DriftReport | undefined;
  if (wantsKeyReason("drifted")) {
    drift = await findDriftedTranslations(localeArg);
  }

  let unfollowed: StalenessReport | undefined;
  let unfollowedExport: UnfollowedStaleEntry[] = [];
  if (wantsKeyReason("unfollowed")) {
    if (localeArg) await resolveTargetLocales(localeArg);
    unfollowed = filterUnfollowedReport(await findUnfollowedTranslations(base), localeArg);
    unfollowedExport = unfollowedEntries(unfollowed, localeArg);
  }

  const docs = scansDocs
    ? findDocsStaleness({
        reasons: requestedReasons,
        locale: localeArg,
        mergeBase: wantsReason("unfollowed") ? await resolveMergeBase(unfollowed?.requestedBase ?? base) : undefined,
      })
    : [];
  const docsCount = (reason: StaleReason): number => docs.filter((entry) => entry.reason === reason).length;

  log.info(
    `Found ${identical.length + likelyEnglish.length + (drift?.entries.length ?? 0) + unfollowedExport.length + docs.length} potentially stale entries:`,
  );
  log.info(`  • ${identical.length} keys with value identical to English (never translated)`);
  log.info(`  • ${likelyEnglish.length} keys with value that appears to be English text`);
  log.info(`  • ${drift?.entries.length ?? 0} keys whose English source moved after the translation`);
  log.info(`  • ${unfollowedExport.length} locale/key pairs not updated with this branch's English changes`);
  if (scansDocs) {
    log.info(
      `  • docs pages (per locale): ${docsCount("unfollowed")} unfollowed, ${docsCount("drifted")} drifted, ${docsCount("missing")} missing, ${docsCount("orphaned")} orphaned`,
    );
  }

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
    for (const line of formatDocsStaleness(docs)) console.log(line);

    console.log(`\n${"=".repeat(80)}`);
    console.log("Run with --export to write stale-translations.json for batch translation.");
  } else {
    // Drifted entries keep their own shape rather than being flattened into the value-comparison
    // one. A batch translator needs the superseded English to judge whether a re-read is warranted,
    // and dropping that field would leave a bare list of keys that look translated already.
    const drifted: DriftedStaleEntry[] = (drift?.entries ?? []).map((entry) => ({ ...entry, reason: "drifted" }));
    const exported: AnyStaleEntry[] = [...identical, ...likelyEnglish, ...drifted, ...unfollowedExport, ...docs];
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
