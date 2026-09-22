import { spawnSync } from "node:child_process";
import * as ts from "typescript";

/**
 * Per-key translation provenance, derived from Git history rather than a committed manifest.
 *
 * The sibling question ("is this value byte-identical to English?") answers whether a string was
 * ever translated. This module answers a different one: a string that reads as a real translation
 * can still be stale, because the English it was written against has moved since. Nothing in the
 * working tree records that relationship, so it has to be recovered from history.
 *
 * The baseline for one locale key is the commit that last changed that key's own translated line,
 * which `git blame` reports exactly. The English file at that commit is therefore the English the
 * translator was looking at, and comparing it against the current English file separates a
 * translation that is merely old from one that matched English all along.
 *
 * File-level last-touch dates were tried first and rejected: they report zero drift in this
 * repository because most locale commits move both trees at once. Per-key provenance survives that
 * shape, since a key the translator did not touch keeps its older line commit when a neighbour in
 * the same file is retranslated.
 */

/** A leaf key in a locale tree, with the inclusive line range its value spans. */
export interface LocaleKeyLocation {
  key: string;
  /** First line of the value, 1-based. */
  startLine: number;
  /** Last line of the value, 1-based. Equal to {@link startLine} for a single-line value. */
  endLine: number;
}

/**
 * One translation whose English source moved after the key's own last edit.
 *
 * `englishAtBaseline` is what the translator saw, and `english` is what the key now falls back to
 * while the value stays untranslated. Both are reported together because the reviewer's decision
 * needs the before and after, not just the fact that they differ.
 */
export interface DriftedEntry {
  key: string;
  locale: string;
  /** The translated value, retranslate this one. */
  target: string;
  /** English the translation was written against. */
  enAtBaseline: string;
  /** English the key falls back to until it is retranslated. */
  en: string;
  /** The commit that last changed this key's translated line. */
  baselineRevision: string;
  /** Commit date of `baselineRevision`, `YYYY-MM-DD`. */
  baselineDate: string;
}

/** Aggregate for one repository-wide drift scan. */
export interface DriftReport {
  entries: DriftedEntry[];
  /** Locale files that contributed at least one drifted key, with their newest baseline commit. */
  files: DriftFileSummary[];
  /** Locales that were scanned, whether or not they contributed findings. */
  scannedLocales: string[];
}

export interface DriftFileSummary {
  file: string;
  locale: string;
  count: number;
  /** Earliest baseline among this file's findings, by commit time. */
  oldestBaselineRevision: string;
  oldestBaselineDate: string;
  /** Latest baseline among this file's findings, by commit time. */
  newestBaselineRevision: string;
  newestBaselineDate: string;
}

/** Provenance for one line of a file: the commit that last changed it. */
export interface LineProvenance {
  /** 1-based line number in the file, from the blame header. */
  line: number;
  revision: string;
  /**
   * Committer time in epoch seconds, which is what orders baselines.
   *
   * A commit id is a hash, so comparing revisions as strings orders them arbitrarily. Selecting the
   * "newest" baseline that way can pick a commit from months ago and silently compare against the
   * wrong English.
   */
  committedAt: number;
}

/**
 * Seam for repository access so the drift comparison can be tested against fixtures without a real
 * checkout or a real history. Production uses {@link createGitDriftSource}.
 */
export interface DriftGitSource {
  /** Repository-relative locale files, POSIX separated, from the committed tree. */
  listLocaleFiles(locale: string): string[];
  /** Authored translation locales, excluding `en-US`, sorted. */
  listTranslationLocales(): string[];
  /**
   * One entry per line of the file at `HEAD`, in file order.
   *
   * Blame runs against the committed revision rather than the working tree, because every other
   * input to the comparison is read from `HEAD`. Blaming the working tree would let an uncommitted
   * edit renumber the lines and move a key's provenance while the report still displays the
   * committed translation.
   */
  blameFile(path: string): LineProvenance[];
  /** Reads many `(revision, path)` blobs at once, keyed by `revision:path`. */
  readBlobs(pairs: Array<{ revision: string; path: string }>): Map<string, string>;
  /** True when the checkout lacks the history this analysis needs. */
  isShallow(): boolean;
}

const DEFAULT_LOCALE = "en-US";
const LOCALES_ROOT = "src/locales";
const BLOB_KEY_SEPARATOR = "\u0000";

export class DriftHistoryError extends Error {}

function runGit(args: string[], cwd: string, input?: string): string {
  const result = spawnSync("git", args, { cwd, input, maxBuffer: 1 << 28, encoding: "utf8" });
  if (result.status !== 0) {
    throw new DriftHistoryError(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function runGitBytes(args: string[], cwd: string, input: string): Buffer {
  const result = spawnSync("git", args, { cwd, input, maxBuffer: 1 << 28 });
  if (result.status !== 0) {
    throw new DriftHistoryError(result.stderr.toString().trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

export function blobKey(revision: string, path: string): string {
  return `${revision}${BLOB_KEY_SEPARATOR}${path}`;
}

/**
 * Reads many `(revision, path)` blobs in one `git cat-file --batch` call.
 *
 * One `git show` per blob costs seconds across a repository this size, while the batch protocol
 * answers the same set in one process. Objects the revision does not carry come back as a
 * `<spec> missing` line and are skipped, which is what a file added after that revision looks like.
 * Object ids are resolved first, because resolving by name would make the batch reread the same
 * blob once per path that reaches it.
 */
export function batchReadBlobs(specs: string[], cwd = process.cwd()): Map<string, string> {
  const blobs = new Map<string, string>();
  if (specs.length === 0) return blobs;

  const output = runGitBytes(["cat-file", "--batch"], cwd, `${specs.join("\n")}\n`);
  let offset = 0;

  while (offset < output.length) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd === -1) break;

    const header = output.subarray(offset, headerEnd).toString("utf8");
    const match = /^([0-9a-f]{40}) blob (\d+)$/.exec(header);

    if (!match) {
      // Missing objects answer with the original spec on its own line, so skip to the next one.
      const next = output.indexOf(0x0a, headerEnd + 1);
      offset = next === -1 ? output.length : next + 1;
      continue;
    }

    const size = Number(match[2]);
    const start = headerEnd + 1;
    blobs.set(header.slice(0, 40), output.subarray(start, start + size).toString("utf8"));
    offset = start + size + 1;
  }

  return blobs;
}

export function createGitDriftSource(cwd = process.cwd()): DriftGitSource {
  const resolveObjectId = (revision: string, path: string): string | undefined => {
    try {
      return runGit(["rev-parse", `${revision}:${path}`], cwd).trim();
    } catch {
      // A path absent from that revision is not drift; the parity gate owns absent keys.
      return undefined;
    }
  };

  return {
    listLocaleFiles(locale: string): string[] {
      return runGit(["ls-files", `${LOCALES_ROOT}/${locale}`], cwd)
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.endsWith(".ts"));
    },

    listTranslationLocales(): string[] {
      const locales = new Set<string>();
      const pattern = new RegExp(`^${LOCALES_ROOT}/([^/]+)/`);

      for (const line of runGit(["ls-files", `${LOCALES_ROOT}/`], cwd).split("\n")) {
        const match = pattern.exec(line.trim());
        if (match && match[1] !== DEFAULT_LOCALE) locales.add(match[1]);
      }

      return [...locales].sort();
    },

    blameFile(path: string): LineProvenance[] {
      // Blame is pinned to HEAD rather than left to default to the working tree. Every value the
      // report prints is read from HEAD, so blaming the working tree would let an uncommitted edit
      // renumber these lines and move a key's baseline while the report shows the committed string.
      //
      // `--porcelain` without `--line-porcelain` emits the commit header once per run of lines that
      // share a commit and `\t`-prefixed content lines, which is all this needs and several times
      // smaller to parse. `raw` keeps the header fields byte-stable: the human format aligns them
      // with padding, which would break the trailing-field parse below.
      const provenance: LineProvenance[] = [];
      let revision = "";
      let committedAt = 0;
      let lineNumber = 0;

      for (const line of runGit(["blame", "--porcelain", "--raw", "HEAD", "--", path], cwd).split("\n")) {
        if (line.startsWith("\t")) {
          provenance.push({ line: lineNumber, revision, committedAt });
          continue;
        }

        // A header is `<sha> <origLine> <finalLine> [<groupSize>]`, and a shallow boundary prefixes
        // the sha with `^`. Without that prefix in the pattern a truncated checkout parses as zero
        // baselines and reports every key as clean, which is the opposite of the truth.
        const header = /^\^?([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(line);
        if (header) {
          revision = header[1];
          lineNumber = Number(header[2]);
          continue;
        }

        const committed = /^committer-time (\d+)$/.exec(line);
        if (committed) committedAt = Number(committed[1]);
      }

      return provenance;
    },

    readBlobs(pairs: Array<{ revision: string; path: string }>): Map<string, string> {
      const resolved: Array<{ objectId: string; key: string }> = [];
      for (const { revision, path } of pairs) {
        const objectId = resolveObjectId(revision, path);
        if (objectId) resolved.push({ objectId, key: blobKey(revision, path) });
      }

      const blobs = batchReadBlobs(resolved.map((entry) => entry.objectId), cwd);
      const result = new Map<string, string>();
      for (const { objectId, key } of resolved) {
        const content = blobs.get(objectId);
        if (content !== undefined) result.set(key, content);
      }
      return result;
    },

    isShallow(): boolean {
      return runGit(["rev-parse", "--is-shallow-repository"], cwd).trim() === "true";
    },
  };
}

/**
 * Walks a locale file's default export and records every leaf's dot path with the line it starts on.
 *
 * Parent object keys are skipped deliberately. They carry no value, and blaming the line a nested
 * object opens on would attribute every one of its children to whichever commit moved a brace.
 */
export function collectLocaleKeyLocations(source: string, filePath = "locale.ts"): LocaleKeyLocation[] {
  return walkLocaleObject(source, filePath, (path, startLine, endLine) => ({ key: path, startLine, endLine }));
}

/** Every leaf key in a locale file, mapped to the text of its value after runtime normalization. */
export function extractLocaleValues(source: string, filePath = "locale.ts"): Map<string, string> {
  const values = new Map<string, string>();
  for (const { key, value } of walkLocaleLeaves(source, filePath)) values.set(key, value);
  return values;
}

function walkLocaleObject<T>(
  source: string,
  filePath: string,
  map: (path: string, startLine: number, endLine: number) => T,
): T[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const results: T[] = [];

  const visit = (node: ts.ObjectLiteralExpression, prefix: string): void => {
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;

      const name = propertyNameText(property.name, sourceFile);
      if (!name) continue;

      const path = prefix ? `${prefix}.${name}` : name;
      const initializer = property.initializer;

      if (ts.isObjectLiteralExpression(initializer)) {
        visit(initializer, path);
        continue;
      }

      // Arrays are locale-specific by design (`general.defaults.base_trigger_words`), so they are a
      // leaf here the same way they are for the identical-value check.
      //
      // The end line matters as much as the start: a wrapped value can have its closing lines
      // changed by a later commit than the one that opened it, and blaming only the first line
      // would attribute the whole value to the older commit.
      const startLine = sourceFile.getLineAndCharacterOfPosition(initializer.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(initializer.getEnd()).line + 1;
      results.push(map(path, startLine, endLine));
    }
  };

  const root = findDefaultExportObject(sourceFile);
  if (root) visit(root, "");
  return results;
}

function walkLocaleLeaves(source: string, filePath: string): Array<{ key: string; value: string }> {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const leaves: Array<{ key: string; value: string }> = [];

  const visit = (node: ts.ObjectLiteralExpression, prefix: string): void => {
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;

      const name = propertyNameText(property.name, sourceFile);
      if (!name) continue;

      const path = prefix ? `${prefix}.${name}` : name;
      const initializer = property.initializer;

      if (ts.isObjectLiteralExpression(initializer)) {
        visit(initializer, path);
        continue;
      }

      const value = literalText(initializer);
      if (value !== undefined) leaves.push({ key: path, value });
    }
  };

  const root = findDefaultExportObject(sourceFile);
  if (root) visit(root, "");
  return leaves;
}

function findDefaultExportObject(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  const search = (node: ts.Node): ts.ObjectLiteralExpression | undefined => {
    if (ts.isExportAssignment(node)) {
      return ts.isObjectLiteralExpression(node.expression) ? node.expression : undefined;
    }

    let found: ts.ObjectLiteralExpression | undefined;
    ts.forEachChild(node, (child) => {
      found ??= search(child);
    });
    return found;
  };

  return search(sourceFile);
}

/**
 * The text of a locale value, without the quotes that happen to be around it.
 *
 * Locale files use template literals and quoted strings interchangeably, and both mean the same
 * string to the runtime, so reading raw source would make a delimiter change look like a value
 * change.
 *
 * Escapes inside a template are left literal: `\{` reaches the localizer as a backslash and a brace,
 * so preserving it keeps that difference visible.
 */
function literalText(node: ts.Expression): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return normalizeLocaleValue(node.text);
  if (ts.isNumericLiteral(node)) return node.text;
  return undefined;
}

/**
 * Normalizes a value to what the runtime actually stores, which is the runtime's own dedent rule.
 *
 * `initializeLocalizer` dedents every loaded string, removing the common indent that locale file
 * layout adds and changing nothing else. Before this, the comparison collapsed all whitespace, which
 * treated a reflowed sentence and a rewritten one as equal and hid deliberate layout changes:
 * Markdown hard line breaks, fenced blocks, and the `-#` panel markers all survive the runtime
 * dedent, so a change to any of them is a real change to what a reader sees.
 */
export function normalizeLocaleValue(value: string): string {
  if (!value.includes("\n")) return value;

  const lines = value.split("\n");
  const firstNonEmpty = lines.find((line) => line.trim().length > 0);
  if (!firstNonEmpty) return value;

  const indent = /^[ \t]+/.exec(firstNonEmpty)?.[0];
  if (!indent) return value;

  const indentPattern = new RegExp(`^${indent}`);
  return lines.map((line) => (line.trim().length > 0 ? line.replace(indentPattern, "") : line)).join("\n");
}

function propertyNameText(name: ts.PropertyName, sourceFile: ts.SourceFile): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    return name.getText(sourceFile);
  }
  return undefined;
}

/**
 * Orders revisions by when they were committed, and dates them.
 *
 * Commit ids are hashes, so ordering them as strings is arbitrary: in this repository the lexically
 * largest revision of one locale file is two weeks older than the newest. Anything that needs
 * "newest" has to go through here rather than compare revision strings.
 */
export interface DriftChronology {
  /** True when `candidate` was committed after `reference`. */
  isNewer(candidate: string, reference: string): boolean;
  /** Commit date as `YYYY-MM-DD`. */
  date(revision: string): string;
}

export function createChronology(committedAt: Map<string, number>): DriftChronology {
  const timeOf = (revision: string): number => committedAt.get(revision) ?? 0;

  return {
    isNewer: (candidate, reference) => timeOf(candidate) > timeOf(reference),
    date: (revision) => {
      const seconds = committedAt.get(revision);
      return seconds === undefined ? "unknown" : new Date(seconds * 1000).toISOString().slice(0, 10);
    },
  };
}

/**
 * English values for the revisions a comparison needs, loaded on demand.
 *
 * The first pass supplies the current English and the locale's own baseline revisions. Only then is
 * a revision's English worth reading, and only for the keys that survived the first pass. Reading
 * every revision's whole tree up front costs one parse per file per revision, which is the
 * difference between a second and several minutes on a tree this size.
 */
export interface DriftValueLookup {
  /** Committed `en-US` values, by key. */
  current(key: string): string | undefined;
  /** `en-US` value of one key at one baseline revision, or undefined when that revision had no such key. */
  atBaseline(revision: string, key: string): string | undefined;
}

/**
 * Compares one locale against the English it was translated from, key by key.
 *
 * A key is reported when English differs from the value it had at that key's own baseline commit.
 * Keys absent from the locale are skipped: `check-locales` owns parity, and reporting them here
 * would double-count every new English key as drift.
 */
export function findDriftedKeys(input: {
  locale: string;
  /** Keys the locale currently defines, mapped to their translated value. */
  localeValues: Map<string, string>;
  /** Baseline revision per key, from this locale's own blame. */
  baselineByKey: Map<string, string>;
  english: DriftValueLookup;
  chronology: DriftChronology;
}): DriftedEntry[] {
  const entries: DriftedEntry[] = [];

  for (const [key, value] of input.localeValues) {
    const baselineRevision = input.baselineByKey.get(key);
    if (!baselineRevision) continue;

    const english = input.english.current(key);
    if (english === undefined) continue;

    const englishBefore = input.english.atBaseline(baselineRevision, key);
    if (englishBefore === undefined || englishBefore === english) continue;

    entries.push({
      key,
      locale: input.locale,
      target: value,
      enAtBaseline: englishBefore,
      en: english,
      baselineRevision,
      baselineDate: input.chronology.date(baselineRevision),
    });
  }

  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Splits a `git blame` result into per-key baselines.
 *
 * Blame reports one entry per final line, and the locale file's AST gives each key an inclusive line
 * range. Every line in that range is considered, and the key takes the newest revision among them,
 * because any one of those edits means the translator touched that key. Blaming only the opening
 * line would miss a later edit to the closing lines of a wrapped value.
 */
export function mapLinesToBaselines(
  locations: LocaleKeyLocation[],
  provenance: LineProvenance[],
  chronology: DriftChronology,
): Map<string, string> {
  const baselines = new Map<string, string>();

  for (const { key, startLine, endLine } of locations) {
    for (let line = startLine; line <= endLine; line++) {
      const entry = provenance[line - 1];
      if (!entry?.revision) continue;

      const existing = baselines.get(key);
      if (!existing || chronology.isNewer(entry.revision, existing)) {
        baselines.set(key, entry.revision);
      }
    }
  }

  return baselines;
}

/**
 * Runs one locale's drift analysis end to end.
 *
 * Returning the per-file summaries alongside the entries lets the caller print what was and was not
 * comparable. A locale whose files carry no history at all produces no entries rather than an
 * every-key-is-drifted avalanche, which is the failure mode a missing baseline would otherwise
 * create.
 */
export function analyzeLocaleDrift(input: {
  locale: string;
  source: DriftGitSource;
  englishFiles: string[];
}): { entries: DriftedEntry[]; files: DriftFileSummary[] } {
  const { locale, source, englishFiles } = input;

  const relativeOf = (englishPath: string): string =>
    englishPath.replace(`${LOCALES_ROOT}/${DEFAULT_LOCALE}/`, "");

  const englishPathByFile = new Map<string, string>();
  for (const englishPath of englishFiles) englishPathByFile.set(relativeOf(englishPath), englishPath);

  const localeFiles = source.listLocaleFiles(locale);
  const localeFileSet = new Set(localeFiles);

  // One batched read for both sides of every file, so a locale scan costs a fixed handful of git
  // processes rather than two per file.
  const headBlobs = source.readBlobs([
    ...englishFiles.map((path) => ({ revision: "HEAD", path })),
    ...localeFiles.map((path) => ({ revision: "HEAD", path })),
  ]);

  const englishCurrent = new Map<string, string>();
  for (const englishPath of englishFiles) {
    const englishSource = headBlobs.get(blobKey("HEAD", englishPath));
    if (englishSource === undefined) continue;
    for (const [key, value] of extractLocaleValues(englishSource, englishPath)) {
      englishCurrent.set(key, value);
    }
  }

  const localeValues = new Map<string, string>();
  const baselineByKey = new Map<string, string>();
  const relativeFileByKey = new Map<string, string>();
  const committedAt = new Map<string, number>();
  const pendingBaselines: Array<{
    relative: string;
    locations: LocaleKeyLocation[];
    provenance: LineProvenance[];
  }> = [];

  // Provenance is collected across every file before any baseline is chosen, so the chronology that
  // orders revisions is complete rather than growing while the comparison runs.
  for (const englishPath of englishFiles) {
    const relative = relativeOf(englishPath);
    const localePath = `${LOCALES_ROOT}/${locale}/${relative}`;
    if (!localeFileSet.has(localePath)) continue;

    const localeSource = headBlobs.get(blobKey("HEAD", localePath));
    if (localeSource === undefined) continue;

    for (const [key, value] of extractLocaleValues(localeSource, localePath)) {
      localeValues.set(key, value);
    }

    const provenance = source.blameFile(localePath);
    for (const entry of provenance) {
      if (entry.revision) committedAt.set(entry.revision, entry.committedAt);
    }

    pendingBaselines.push({
      relative,
      locations: collectLocaleKeyLocations(localeSource, localePath),
      provenance,
    });
  }

  const chronology = createChronology(committedAt);

  for (const { relative, locations, provenance } of pendingBaselines) {
    for (const [key, revision] of mapLinesToBaselines(locations, provenance, chronology)) {
      baselineByKey.set(key, revision);
      relativeFileByKey.set(key, relative);
    }
  }

  const revisionCache = new Map<string, Map<string, string>>();
  const englishAtBaseline = (revision: string, key: string): string | undefined => {
    const relative = relativeFileByKey.get(key);
    const path = englishPathByFile.get(relative ?? "");
    if (!path) return undefined;

    return readEnglishAt(revision, path).get(key);
  };

  /**
   * Reads and parses one English file at one revision, once per pair.
   *
   * Only the file the key itself lives in is read: a revision usually touches several locale files,
   * so reading everything that revision touched to answer a question about one key would pull in
   * keys that can never match. The pair count is bounded by the distinct baseline revisions, which
   * `git blame` keeps in the low hundreds even on a tree this size.
   */
  const readEnglishAt = (revision: string, path: string): Map<string, string> => {
    const cacheKey = blobKey(revision, path);
    const cached = revisionCache.get(cacheKey);
    if (cached) return cached;

    const content = source.readBlobs([{ revision, path }]).get(cacheKey);
    const values = content === undefined ? new Map<string, string>() : extractLocaleValues(content, path);
    revisionCache.set(cacheKey, values);
    return values;
  };

  const entries = findDriftedKeys({
    locale,
    localeValues,
    baselineByKey,
    english: { current: (key) => englishCurrent.get(key), atBaseline: englishAtBaseline },
    chronology,
  });

  return { entries, files: summarizeDriftFiles(entries, relativeFileByKey, chronology) };
}

/**
 * Groups findings by file.
 *
 * Each summary carries the oldest and newest baseline in the group rather than one representative
 * revision. A file's findings can come from several baselines months apart, and naming only one of
 * them would misstate what the reader is looking at. The newest is chosen by commit time, not by
 * comparing revision strings.
 */
function summarizeDriftFiles(
  entries: DriftedEntry[],
  relativeFileByKey: Map<string, string>,
  chronology: DriftChronology,
): DriftFileSummary[] {
  const summaries = new Map<string, DriftFileSummary>();

  for (const entry of entries) {
    const file = relativeFileByKey.get(entry.key) ?? "unknown";
    const existing = summaries.get(file);

    if (existing) {
      existing.count += 1;
      if (chronology.isNewer(entry.baselineRevision, existing.newestBaselineRevision)) {
        existing.newestBaselineRevision = entry.baselineRevision;
        existing.newestBaselineDate = entry.baselineDate;
      }
      if (chronology.isNewer(existing.oldestBaselineRevision, entry.baselineRevision)) {
        existing.oldestBaselineRevision = entry.baselineRevision;
        existing.oldestBaselineDate = entry.baselineDate;
      }
      continue;
    }

    summaries.set(file, {
      file,
      locale: entry.locale,
      count: 1,
      oldestBaselineRevision: entry.baselineRevision,
      oldestBaselineDate: entry.baselineDate,
      newestBaselineRevision: entry.baselineRevision,
      newestBaselineDate: entry.baselineDate,
    });
  }

  return [...summaries.values()].sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
}

/** Keys shown per file before the remainder is summarized rather than listed. */
const DRIFT_DISPLAY_LIMIT = 12;

/**
 * Renders the drift appendix.
 *
 * The heading states the accuracy limit rather than implying a census. The baseline is per file and
 * per key as blame reports it, so when a translator retranslates one key in a file the keys they did
 * not touch keep their own older baselines. The count is a floor on outstanding debt, and a reader
 * who assumes otherwise will under-estimate the queue.
 */
export function formatDriftReport(report: DriftReport): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push("=".repeat(80));
  lines.push("DRIFTED TRANSLATIONS (English source moved after this key was translated)");
  lines.push("=".repeat(80));

  if (report.entries.length === 0) {
    lines.push("");
    lines.push("None. Every translated key matches the English it was written against.");
    lines.push(`Scanned: ${report.scannedLocales.join(", ")}.`);
    return lines;
  }

  lines.push("");
  lines.push(`${report.entries.length} keys across ${report.files.length} files:`);
  for (const summary of report.files) {
    lines.push(`  [${summary.locale}] ${summary.file} (${summary.count}) baselines ${formatBaselineRange(summary)}`);
  }

  const byFile = new Map<string, DriftedEntry[]>();
  for (const entry of report.entries) {
    const file = `${entry.locale}::${entry.key.split(".").slice(0, 3).join(".")}`;
    const group = byFile.get(file) ?? [];
    group.push(entry);
    byFile.set(file, group);
  }

  for (const [group, entries] of [...byFile.entries()].sort()) {
    const [locale] = group.split("::");
    lines.push("");
    lines.push(`## [${locale}] ${group.split("::")[1]} (${entries.length})`);
    for (const entry of entries.slice(0, DRIFT_DISPLAY_LIMIT)) {
      lines.push(`  .${entry.key.split(".").slice(3).join(".") || entry.key}`);
      lines.push(`    EN was: ${truncate(entry.enAtBaseline)}`);
      lines.push(`    EN now: ${truncate(entry.en)}`);
      lines.push(`    ${locale.toUpperCase()}: ${truncate(entry.target)}`);
    }
    if (entries.length > DRIFT_DISPLAY_LIMIT) {
      lines.push(`  ...and ${entries.length - DRIFT_DISPLAY_LIMIT} more in this group`);
    }
  }

  lines.push("");
  lines.push("A listed key may still read correctly: the English may have changed without changing");
  lines.push("its meaning. Review each one rather than retranslating the list.");
  return lines;
}

function truncate(value: string, limit = 80): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > limit ? `${singleLine.slice(0, limit)}...` : singleLine;
}

/**
 * One file's baseline span, collapsed to a single date when every finding shares a baseline.
 *
 * A file's findings routinely come from several baselines months apart, so naming one of them would
 * imply the whole group was compared against that commit.
 */
function formatBaselineRange(summary: DriftFileSummary): string {
  if (summary.oldestBaselineRevision === summary.newestBaselineRevision) {
    return `${summary.newestBaselineDate} ${summary.newestBaselineRevision.slice(0, 9)}`;
  }
  return (
    `${summary.oldestBaselineDate} ${summary.oldestBaselineRevision.slice(0, 9)}` +
    ` to ${summary.newestBaselineDate} ${summary.newestBaselineRevision.slice(0, 9)}`
  );
}

/** One-line summary for the console header. */
export function summarizeDrift(report: DriftReport): string {
  if (report.entries.length === 0) return "no drifted translations";
  return `${report.entries.length} drifted keys in ${report.files.length} files`;
}
