import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as ts from "typescript";
import { isVerboseOutput, verboseOutputHint } from "./lib/gateOutput";

export const STALENESS_DOC_PATH = "docs/en/contributing/localization/new-locale.md";

const DEFAULT_LOCALE = "en-US";
// Forward slash is required, not cosmetic: this value is concatenated into a git treeish
// (`<ref>:<path>`), and git rejects a separator that arrived from path.join on Windows.
const LOCALES_ROOT = "src/locales";
const LOCALE_FILE_EXTENSION = ".ts";
const DISPLAY_KEY_LIMIT = 25;
const NO_KEY = "none";
const STALENESS_RULES = [
  "A touched translation may still be wrong, and an untouched one may still be correct.",
  "The runtime en-US fallback is unchanged; this report never fails a build.",
] as const;

const log = {
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  warn: (msg: string) => console.warn(`⚠️  ${msg}`),
  error: (msg: string) => console.error(`❌ ${msg}`),
};

export class GitUnavailableError extends Error {}
export class MissingBaseRefError extends Error {}
export class LocaleParseError extends Error {}

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

function runGitSync(args: string[], cwd: string): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(proc.stderr).trim() || `git ${args.join(" ")} failed`);
  }
  return new TextDecoder().decode(proc.stdout);
}

export const defaultGitRunner: GitRunner = async (args, cwd) => runGitSync(args, cwd);

export interface LocaleSnapshot {
  values: Map<string, string>;
  locales: string[];
  conflicts: Set<string>;
}

export interface LocaleKeyStatus {
  locale: string;
  present: boolean;
  value?: string;
  touched: boolean;
}

export interface ChangedKeyReport {
  key: string;
  english: string;
  previousEnglish?: string;
  review: LocaleKeyStatus[];
  missing: LocaleKeyStatus[];
}

export interface KeyDetail {
  key: string;
  before: string;
}

export interface StalenessReport {
  requestedBase: string;
  baseRevision: string;
  headRevision: string;
  includesUncommittedEdits: boolean;
  uncommittedLocalePaths: string[];
  translationLocales: string[];
  added: ChangedKeyReport[];
  changed: ChangedKeyReport[];
  removed: KeyDetail[];
  localeEditCounts: Map<string, number>;
  conflicts: Set<string>;
}

export interface CheckLocaleStalenessOptions {
  repoRoot: string;
  base?: string;
  source?: "head" | "worktree";
  git?: GitRunner;
}

export interface ParsedArguments {
  base?: string;
  source: "head" | "worktree";
  verboseOutput: boolean;
}

export function parseArguments(argv: string[]): ParsedArguments {
  const baseFlagIndex = argv.indexOf("--base");
  const baseEquals = argv.find((arg) => arg.startsWith("--base="));
  const base = baseEquals
    ? baseEquals.slice("--base=".length)
    : baseFlagIndex >= 0
      ? argv[baseFlagIndex + 1]
      : undefined;

  if (baseFlagIndex >= 0 && !base) {
    throw new Error("--base requires a git ref argument (e.g. --base origin/main)");
  }
  if (base === "") {
    throw new Error("--base requires a non-empty git ref argument (e.g. --base origin/main)");
  }

  return {
    base,
    source: argv.includes("--worktree") ? "worktree" : "head",
    verboseOutput: isVerboseOutput(argv),
  };
}

async function listTrackedLocaleFiles(
  git: GitRunner,
  ref: string,
  cwd: string,
  failure: new (message: string) => Error = MissingBaseRefError,
): Promise<string[]> {
  let stdout: string;
  try {
    stdout = await git(["ls-tree", "-r", "--name-only", `${ref}:${LOCALES_ROOT}`], cwd);
  } catch (error) {
    throw new failure(
      `${ref} has no ${LOCALES_ROOT} tree in this checkout (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(LOCALE_FILE_EXTENSION))
    .sort();
}

function splitLocalePath(relativePath: string): { locale: string; file: string } | undefined {
  const [locale, ...rest] = relativePath.split("/");
  if (!locale || rest.length === 0) return undefined;
  return { locale, file: rest.join("/") };
}

export async function readRefSnapshot(git: GitRunner, cwd: string, ref: string): Promise<LocaleSnapshot> {
  const relativePaths = await listTrackedLocaleFiles(git, ref, cwd);
  return readSnapshotFiles(git, cwd, ref, relativePaths, MissingBaseRefError);
}

export async function readHeadSnapshot(git: GitRunner, cwd: string): Promise<LocaleSnapshot> {
  const relativePaths = await listTrackedLocaleFiles(git, "HEAD", cwd, LocaleParseError);
  return readSnapshotFiles(git, cwd, "HEAD", relativePaths, LocaleParseError);
}

async function readSnapshotFiles(
  git: GitRunner,
  cwd: string,
  ref: string,
  relativePaths: readonly string[],
  failure: new (message: string) => Error,
): Promise<LocaleSnapshot> {
  return collectSnapshot(
    async (relativePath) => {
      try {
        return await git(["show", `${ref}:${LOCALES_ROOT}/${relativePath}`], cwd);
      } catch (error) {
        throw new failure(
          `Could not read ${LOCALES_ROOT}/${relativePath} at ${ref} (${error instanceof Error ? error.message : String(error)}).`,
        );
      }
    },
    [...relativePaths],
  );
}

export async function readWorkingTreeSnapshot(
  git: GitRunner,
  cwd: string,
  dirtyPaths?: readonly string[],
): Promise<LocaleSnapshot> {
  const tracked = await listTrackedLocaleFiles(git, "HEAD", cwd, LocaleParseError);
  const dirty = dirtyPaths ?? (await listDirtyLocalePaths(git, cwd));
  const relativePaths = [...new Set([...tracked, ...dirty])].sort();
  return collectSnapshot((relativePath) => readLocaleFile(cwd, relativePath), relativePaths);
}

function readLocaleFile(root: string, relativePath: string): string | undefined {
  const filePath = join(root, LOCALES_ROOT, relativePath);
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new LocaleParseError(
      `Could not read ${LOCALES_ROOT}/${relativePath} (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
}

// Paths must stay relative to `LOCALES_ROOT` because `splitLocalePath` expects a leading locale directory and
// silently drops repo-relative paths.
async function listDirtyLocalePaths(git: GitRunner, cwd: string): Promise<string[]> {
  // The pathspec limits status to this subtree, so the output stays proportional to locale churn
  // rather than to every touched file in the repository.
  let porcelain: string;
  try {
    porcelain = await git(["status", "--porcelain", "--untracked-files=all", "--", LOCALES_ROOT], cwd);
  } catch (error) {
    // Reporting "clean" here would hide exactly the edits this check discloses, so a failed status
    // is a script error rather than an empty list.
    throw new LocaleParseError(
      `Could not read the working tree status (${error instanceof Error ? error.message : String(error)}).`,
    );
  }

  const paths = new Set<string>();
  const rootPrefix = `${LOCALES_ROOT}/`;

  for (const line of porcelain.split("\n")) {
    // `XY <path>`, and `XY <old> -> <new>` for a rename, whose new path is the one on disk.
    const path = line.slice(3).trim();
    const renamed = path.split(" -> ");
    const candidate = unquoteGitPath(renamed[renamed.length - 1] ?? "");
    if (candidate.startsWith(rootPrefix) && candidate.endsWith(LOCALE_FILE_EXTENSION)) {
      paths.add(candidate.slice(rootPrefix.length));
    }
  }

  return [...paths].sort();
}

function unquoteGitPath(path: string): string {
  return path.replace(/^"|"$/g, "");
}

async function collectSnapshot(
  read: (relativePath: string) => Promise<string | undefined> | string | undefined,
  relativePaths: string[],
): Promise<LocaleSnapshot> {
  const values = new Map<string, string>();
  const conflicts = new Set<string>();
  const locales = new Set<string>();

  for (const relativePath of relativePaths) {
    const split = splitLocalePath(relativePath);
    if (!split) continue;
    locales.add(split.locale);

    const source = await read(relativePath);
    // A missing file is a deletion, so it contributes no entries and is compared as absence.
    if (source === undefined) continue;
    parseInto(values, conflicts, source, split.locale, relativePath);
  }

  return { values, locales: [...locales].sort(), conflicts };
}

// Conflicting keys are removed from `target` instead of overwritten because runtime `Object.assign` order decides
// which definition wins.
function parseInto(
  target: Map<string, string>,
  conflicts: Set<string>,
  source: string,
  locale: string,
  file: string,
): void {
  const parsed = parseLocaleSource(source, file);

  // Duplicates inside one file are already recorded against the bare key, which is the form
  // `buildStalenessReport` filters on, so namespacing them here is all that is left to do.
  for (const key of parsed.conflicts) conflicts.add(namespacedKey(locale, key));

  for (const [key, value] of parsed.values) {
    const namespaced = namespacedKey(locale, key);
    if (conflicts.has(namespaced)) continue;

    // A key the assembler and a nested file both define is a conflict only when they disagree;
    // agreeing definitions are one ordinary value.
    const existing = target.get(namespaced);
    if (existing !== undefined && existing !== value) {
      target.delete(namespaced);
      conflicts.add(namespaced);
      continue;
    }
    target.set(namespaced, value);
  }
}

function namespacedKey(locale: string, key: string): string {
  return `${locale}:${key}`;
}

export function parseLocaleSource(
  source: string,
  file = "locale.ts",
): { values: Map<string, string>; conflicts: Set<string> } {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const values = new Map<string, string>();
  const conflicts = new Set<string>();

  const root = findDefaultExportObject(sourceFile);
  if (!root) {
    throw new LocaleParseError(`${file}: no exported object literal was found.`);
  }

  walkObject(root, "", file, values, conflicts);
  return { values, conflicts };
}

function findDefaultExportObject(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  const unwrap = (node: ts.Node): ts.ObjectLiteralExpression | undefined => {
    if (ts.isObjectLiteralExpression(node)) return node;
    if (ts.isParenthesizedExpression(node)) return unwrap(node.expression);
    return undefined;
  };

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      const found = unwrap(statement.expression);
      if (found) return found;
    }
    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.initializer) {
          const found = unwrap(declaration.initializer);
          if (found) return found;
        }
      }
    }
  }
  return undefined;
}

function propertyNameText(name: ts.PropertyName, file: string): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  // A computed name is not a literal key the runtime can be matched against statically.
  if (ts.isComputedPropertyName(name)) return undefined;
  throw new LocaleParseError(`${file}: unsupported property name in the locale object.`);
}

function walkObject(
  object: ts.ObjectLiteralExpression,
  prefix: string,
  file: string,
  values: Map<string, string>,
  conflicts: Set<string>,
): void {
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) continue;
    if (!ts.isPropertyAssignment(property)) {
      throw new LocaleParseError(`${file}: expected key/value pairs in the locale object.`);
    }

    const name = propertyNameText(property.name, file);
    if (name === undefined) continue;

    const key = prefix ? `${prefix}.${name}` : name;
    const initializer = property.initializer;

    if (ts.isObjectLiteralExpression(initializer)) {
      walkObject(initializer, key, file, values, conflicts);
      continue;
    }
    if (ts.isArrayLiteralExpression(initializer)) continue;
    if (ts.isNoSubstitutionTemplateLiteral(initializer) || ts.isStringLiteral(initializer)) {
      const existing = values.get(key);
      // Repeating one value is harmless; disagreeing about it is the conflict worth skipping.
      if (existing !== undefined && existing !== initializer.text) conflicts.add(key);
      values.set(key, initializer.text);
      continue;
    }

    throw new LocaleParseError(`${file}: ${key} is neither a string nor a nested object literal.`);
  }
}

export function normalizeLocaleValue(value: string): string {
  const result: string[] = [];
  let pendingBlank = false;

  for (const rawLine of value.trim().split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") {
      pendingBlank = result.length > 0;
      continue;
    }
    if (pendingBlank) result.push("");
    pendingBlank = false;
    result.push(line);
  }

  return result.join("\n");
}

function valuesDiffer(before: string | undefined, after: string | undefined): boolean {
  if (before === undefined || after === undefined) return before !== after;
  return normalizeLocaleValue(before) !== normalizeLocaleValue(after);
}

function statusForKey(key: string, base: LocaleSnapshot, head: LocaleSnapshot, locale: string): LocaleKeyStatus {
  const before = base.values.get(namespacedKey(locale, key));
  const after = head.values.get(namespacedKey(locale, key));

  return {
    locale,
    present: after !== undefined,
    value: after,
    touched: valuesDiffer(before, after),
  };
}

function translationLocales(locales: string[]): string[] {
  return locales.filter((locale) => locale !== DEFAULT_LOCALE);
}

function collectLocaleEditCounts(base: LocaleSnapshot, head: LocaleSnapshot, locales: string[]): Map<string, number> {
  const keys = new Set([...base.values.keys(), ...head.values.keys()]);
  const counts = new Map<string, number>();

  for (const locale of locales) {
    const prefix = namespacedKey(locale, "");
    let count = 0;
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue;
      if (valuesDiffer(base.values.get(key), head.values.get(key))) count++;
    }
    counts.set(locale, count);
  }

  return counts;
}

export function buildStalenessReport(input: {
  requestedBase: string;
  baseRevision: string;
  headRevision: string;
  includesUncommittedEdits?: boolean;
  uncommittedLocalePaths?: string[];
  base: LocaleSnapshot;
  head: LocaleSnapshot;
}): StalenessReport {
  const {
    requestedBase,
    baseRevision,
    headRevision,
    includesUncommittedEdits = false,
    uncommittedLocalePaths = [],
    base,
    head,
  } = input;
  const authoredTranslationLocales = translationLocales([...new Set([...base.locales, ...head.locales])]);
  const englishPrefix = namespacedKey(DEFAULT_LOCALE, "");

  const added: ChangedKeyReport[] = [];
  const changed: ChangedKeyReport[] = [];
  const removed: KeyDetail[] = [];

  // A key is withheld from all three sections when any locale in either revision defines it twice
  // with different values. The test is on the bare key rather than the `en-US` one, because a
  // conflict in a translation is enough to leave the key's meaning unsettled, and the skipped list
  // would otherwise contradict a section that still reported the key.
  const conflictedKeys = collectConflictedKeys(base, head);
  const sortByKey = (left: { key: string }, right: { key: string }) => left.key.localeCompare(right.key);
  const targets = translationLocales(head.locales);

  for (const [key, after] of head.values) {
    if (!key.startsWith(englishPrefix)) continue;
    const bare = key.slice(englishPrefix.length);
    if (conflictedKeys.has(bare)) continue;

    const before = base.values.get(key);
    if (before === undefined) {
      added.push({ key: bare, english: after, ...splitStatuses(bare, base, head, targets) });
      continue;
    }
    if (valuesDiffer(before, after)) {
      changed.push({ key: bare, english: after, previousEnglish: before, ...splitStatuses(bare, base, head, targets) });
    }
  }

  for (const [key, before] of base.values) {
    if (!key.startsWith(englishPrefix)) continue;
    if (head.values.has(key)) continue;
    const bare = key.slice(englishPrefix.length);
    if (conflictedKeys.has(bare)) continue;
    removed.push({ key: bare, before });
  }

  return {
    requestedBase,
    baseRevision,
    headRevision,
    includesUncommittedEdits,
    uncommittedLocalePaths,
    translationLocales: authoredTranslationLocales,
    added: added.sort(sortByKey),
    changed: changed.sort(sortByKey),
    removed: removed.sort(sortByKey),
    localeEditCounts: collectLocaleEditCounts(base, head, [DEFAULT_LOCALE, ...authoredTranslationLocales]),
    conflicts: conflictedKeys,
  };
}

function collectConflictedKeys(base: LocaleSnapshot, head: LocaleSnapshot): Set<string> {
  const bare = new Set<string>();

  for (const namespaced of [...base.conflicts, ...head.conflicts]) {
    const separator = namespaced.indexOf(":");
    if (separator >= 0) bare.add(namespaced.slice(separator + 1));
  }

  return bare;
}

function splitStatuses(
  key: string,
  base: LocaleSnapshot,
  head: LocaleSnapshot,
  locales: string[],
): { review: LocaleKeyStatus[]; missing: LocaleKeyStatus[] } {
  const review: LocaleKeyStatus[] = [];
  const missing: LocaleKeyStatus[] = [];

  for (const locale of locales) {
    const status = statusForKey(key, base, head, locale);
    if (status.touched) continue;
    if (status.present) review.push(status);
    else missing.push(status);
  }

  return { review, missing };
}

export function formatLocales(statuses: LocaleKeyStatus[]): string {
  if (statuses.length === 0) return NO_KEY;
  return statuses.map((status) => status.locale).join(", ");
}

function countFollowUp(entries: ChangedKeyReport[]): number {
  return entries.reduce((total, entry) => total + entry.review.length + entry.missing.length, 0);
}

function formatKeySection(
  title: string,
  reason: string,
  entries: ChangedKeyReport[],
  options: { verboseOutput: boolean },
): string[] {
  if (entries.length === 0) return [];

  const lines = [`\n${title} (${entries.length})`, reason];
  const shown = options.verboseOutput ? entries : entries.slice(0, DISPLAY_KEY_LIMIT);

  for (const entry of shown) {
    lines.push(`  ${entry.key}`);
    if (entry.review.length > 0) {
      lines.push(`    existing translation to review: ${formatLocales(entry.review)}`);
    }
    if (entry.missing.length > 0) {
      lines.push(`    no translation yet: ${formatLocales(entry.missing)}`);
    }
  }

  if (shown.length < entries.length) {
    lines.push(`  ${entries.length - shown.length} more key(s) hidden.`);
  }

  return lines;
}

export function renderStalenessReport(report: StalenessReport, options: { verboseOutput: boolean }): string {
  const lines: string[] = [];
  const totalEnglishChanges = report.added.length + report.changed.length + report.removed.length;

  lines.push(`Translation follow-up advisory: ${report.requestedBase}...HEAD`);
  lines.push(`Base: ${report.baseRevision} | Head: ${report.headRevision}`);
  if (report.includesUncommittedEdits) {
    // Without this line the reader would take an uncommitted local edit for committed branch state.
    lines.push(
      `Working tree contains uncommitted locale edits (${report.uncommittedLocalePaths.length} path(s) ` +
        `differ from HEAD). The committed report still reads HEAD unless --worktree was requested.`,
    );
  }

  if (totalEnglishChanges === 0) {
    lines.push(`\nNo ${DEFAULT_LOCALE} locale values differ in this branch, so no translation follow-up.`);
  } else {
    const followUp = countFollowUp(report.added) + countFollowUp(report.changed);
    lines.push(
      `\n${DEFAULT_LOCALE} keys changed in this branch: ${report.added.length} added, ` +
        `${report.changed.length} materially changed, ${report.removed.length} removed.`,
    );
    lines.push(
      `Translation follow-up: ${followUp} locale/key pair(s) across ` +
        `${report.added.length + report.changed.length} changed key(s), advisory only.`,
    );
    lines.push(`Authored translation locales: ${report.translationLocales.join(", ") || NO_KEY}`);

    lines.push(
      ...formatKeySection(
        "ADDED KEYS",
        "No value existed at the base revision, so a locale without the key renders the English fallback.",
        report.added,
        options,
      ),
    );
    lines.push(
      ...formatKeySection(
        "MATERIALLY CHANGED ENGLISH VALUES",
        "Whitespace-only reformatting is excluded, so an edit listed here changed more than layout.",
        report.changed,
        options,
      ),
    );

    if (report.removed.length > 0) {
      const shown = options.verboseOutput ? report.removed : report.removed.slice(0, DISPLAY_KEY_LIMIT);
      lines.push(`\nREMOVED KEYS (${report.removed.length})`);
      lines.push("No translation work; delete the matching key from every locale that still defines it.");
      for (const entry of shown) lines.push(`  ${entry.key}`);
      if (shown.length < report.removed.length) {
        lines.push(`  ${report.removed.length - shown.length} more key(s) hidden.`);
      }
    }

    const edits = [...report.localeEditCounts]
      .filter(([, count]) => count > 0)
      .map(([locale, count]) => `${locale} ${count}`);
    lines.push(`\nLocale values edited in this branch: ${edits.join(", ") || NO_KEY}`);
  }

  if (report.conflicts.size > 0) {
    lines.push(`\nSKIPPED KEYS (${report.conflicts.size})`);
    lines.push("Some locale defines these twice with different values, so no single value is authoritative.");
    for (const key of [...report.conflicts].sort()) lines.push(`  ${key}`);
  }

  lines.push("");
  for (const rule of STALENESS_RULES) lines.push(`- ${rule}`);
  lines.push("- Existing check-locales, placeholder, marker, and length gates keep their authority.");
  lines.push(`Guide: ${STALENESS_DOC_PATH}`);

  if (!options.verboseOutput && totalEnglishChanges > 0) {
    lines.push(verboseOutputHint("bun run find-stale-translations --reason=unfollowed --base=origin/main"));
  }

  return lines.join("\n");
}

// `HEAD` is omitted from `candidates` because comparing `HEAD` to itself in a shallow clone would return a false
// all-clear instead of failing.
export async function resolveBaseRef(git: GitRunner, repoRoot: string): Promise<string> {
  const candidates: string[] = [];
  const githubBase = process.env.GITHUB_BASE_REF?.trim();
  if (githubBase) candidates.push(`origin/${githubBase}`, githubBase);

  candidates.push("origin/HEAD", "origin/main", "main", "origin/master", "master");

  for (const candidate of candidates) {
    try {
      await git(["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`], repoRoot);
      return candidate;
    } catch {}
  }

  const shallow = await isShallowCheckout(git, repoRoot);
  throw new MissingBaseRefError(
    shallow
      ? "This is a shallow checkout with no base ref to compare against. Fetch the history first " +
          "(`git fetch --unshallow`), or pass a ref this clone already holds with `--base <ref>`."
      : "No base ref found. Fetch the branch this work targets (`git fetch origin <branch>`), then " +
          "pass it with `--base <ref>` or leave the default resolution to find it.",
  );
}

async function isShallowCheckout(git: GitRunner, repoRoot: string): Promise<boolean> {
  try {
    if ((await git(["rev-parse", "--is-shallow-repository"], repoRoot)).trim() === "true") return true;
  } catch {
    return false;
  }

  try {
    const gitDir = (await git(["rev-parse", "--git-dir"], repoRoot)).trim();
    return existsSync(resolve(repoRoot, gitDir, "shallow"));
  } catch {
    return false;
  }
}

function fetchTargetForBase(base: string): string {
  return base.startsWith("origin/") ? base.slice("origin/".length) : base;
}

async function assertGitCheckout(git: GitRunner, repoRoot: string): Promise<void> {
  try {
    await git(["rev-parse", "--git-dir"], repoRoot);
  } catch {
    throw new GitUnavailableError(
      `Not a git checkout: ${repoRoot}. This advisory compares two revisions, so it needs one.`,
    );
  }
}

async function assertUsableBase(git: GitRunner, repoRoot: string, base: string): Promise<string> {
  try {
    await git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`], repoRoot);
  } catch {
    const shallow = await isShallowCheckout(git, repoRoot);
    const fetchTarget = fetchTargetForBase(base);
    throw new MissingBaseRefError(
      shallow
        ? `Base ref "${base}" is not present in this checkout. A shallow clone has no history to ` +
            `compare, so fetch it (\`git fetch origin ${fetchTarget} --depth=100\`) or run \`git fetch --unshallow\`.`
        : `Base ref "${base}" is not present in this checkout. Fetch it (\`git fetch origin ${fetchTarget}\`) ` +
            `or pass a ref this clone holds.`,
    );
  }

  try {
    return (await git(["merge-base", base, "HEAD"], repoRoot)).trim();
  } catch {
    throw new MissingBaseRefError(
      `"${base}" and HEAD share no merge base in this checkout, which an unrelated history produces. ` +
        `Pass a ref that shares this branch's history.`,
    );
  }
}

export async function checkLocaleStaleness(options: CheckLocaleStalenessOptions): Promise<StalenessReport> {
  const { repoRoot, base: requested, source = "head", git = defaultGitRunner } = options;

  await assertGitCheckout(git, repoRoot);
  const base = requested ?? (await resolveBaseRef(git, repoRoot));
  const mergeBase = await assertUsableBase(git, repoRoot, base);

  const headRevision = (await git(["rev-parse", "--short", "HEAD"], repoRoot)).trim();
  const baseSnapshot = await readRefSnapshot(git, repoRoot, mergeBase);

  const dirtyPaths = await listDirtyLocalePaths(git, repoRoot);
  const uncommittedLocalePaths = dirtyPaths.map((path) => `${LOCALES_ROOT}/${path}`);
  // Only uncommitted content earns the disclosure; asking for `--worktree` on a clean tree reads
  // exactly what `HEAD` holds, and claiming otherwise would be a false alarm.
  const includesUncommittedEdits = uncommittedLocalePaths.length > 0;

  // Exactly one source feeds the head side. Mixing committed content for missing files with working
  // tree content for edited ones would describe a tree that exists nowhere.
  const head =
    source === "worktree"
      ? await readWorkingTreeSnapshot(git, repoRoot, dirtyPaths)
      : await readHeadSnapshot(git, repoRoot);

  return buildStalenessReport({
    requestedBase: base,
    baseRevision: mergeBase,
    headRevision,
    includesUncommittedEdits,
    uncommittedLocalePaths,
    base: baseSnapshot,
    head,
  });
}

async function main(): Promise<void> {
  let args: ParsedArguments;
  try {
    args = parseArguments(process.argv.slice(2));
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  let report: StalenessReport;
  try {
    report = await checkLocaleStaleness({ repoRoot: process.cwd(), base: args.base, source: args.source });
  } catch (error) {
    if (error instanceof GitUnavailableError || error instanceof LocaleParseError) {
      log.error(error.message);
      process.exit(1);
    }
    log.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  console.log(renderStalenessReport(report, { verboseOutput: args.verboseOutput }));
}

if (import.meta.main) {
  main().catch((error) => {
    log.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
}
