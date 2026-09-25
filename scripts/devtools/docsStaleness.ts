/**
 * Page-level translation staleness for the docs site and the translated READMEs.
 *
 * The locale-key scans compare individual values. A translated page has no stable line mapping to
 * its English source, so the page is the unit here: a translation is stale when the English page's
 * translatable text changed after the translation was last committed, or when a branch changed the
 * English page without touching the translation.
 *
 * The baseline is the translation's last commit. A commit that edits both trees (a link sweep, say)
 * therefore resets it even if the prose was not re-translated, so a clean result means "touched
 * since", not "reviewed since".
 */

/** Sections that stay English by policy (see docs/en/contributing/localization/docs-site.md). */
export const ENGLISH_ONLY_DOC_SECTIONS = ["architecture/", "contributing/", "wiki/"] as const;

/**
 * Pages a generator writes. Their freshness belongs to the generator and its check, not to a
 * translator, so they are never reported as stale translations.
 */
export const GENERATED_DOC_PAGES = ["features/command-reference.md"] as const;

export type DocsStaleReason = "unfollowed" | "drifted" | "missing" | "orphaned";

export interface DocsStaleEntry {
  reason: DocsStaleReason;
  /** Page identity shared across locales: `self-hosting/maintenance.md`, or `README.md`. */
  page: string;
  locale: string;
  english: string;
  translation: string;
  /** For `unfollowed`: what the branch did to the English page. */
  change?: "added" | "changed" | "removed";
  /** For `drifted`: the translation's last commit, the baseline the English is compared against. */
  baseline?: string;
  /** For `drifted` and `unfollowed`: lines of translatable English text that differ. */
  changedLines?: number;
}

/** The git reads this module needs, batched so a full-tree scan costs a handful of processes. */
export interface DocsGit {
  listFiles(revision: string): string[];
  /** Last commit reachable from HEAD that touched each path. */
  lastCommits(): Map<string, string>;
  readMany(specs: { revision: string; path: string }[]): Map<string, string | null>;
  changedPaths(from: string, to: string): string[];
  shortRevision(revision: string): string;
}

const DOC_PATHSPECS = ["docs", "README.md", ".github"];

function specKey(revision: string, path: string): string {
  return `${revision}:${path}`;
}

function runGit(repoRoot: string, args: string[], stdin?: string): string {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd: repoRoot,
    stdin: stdin === undefined ? undefined : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(proc.stderr).trim() || `git ${args.join(" ")} failed`);
  }
  return new TextDecoder().decode(proc.stdout);
}

export function createGitDocsSource(repoRoot: string): DocsGit {
  return {
    listFiles(revision) {
      return runGit(repoRoot, ["ls-tree", "-r", "--name-only", revision, "--", ...DOC_PATHSPECS])
        .split("\n")
        .filter(Boolean);
    },
    lastCommits() {
      const commits = new Map<string, string>();
      let current = "";
      const log = runGit(repoRoot, ["log", "--format=%x00%H", "--name-only", "HEAD", "--", ...DOC_PATHSPECS]);
      for (const line of log.split("\n")) {
        if (line.startsWith("\u0000")) current = line.slice(1);
        else if (line.length > 0 && !commits.has(line)) commits.set(line, current);
      }
      return commits;
    },
    readMany(specs) {
      const results = new Map<string, string | null>();
      if (specs.length === 0) return results;
      const output = Bun.spawnSync(["git", "cat-file", "--batch"], {
        cwd: repoRoot,
        stdin: new TextEncoder().encode(`${specs.map((spec) => specKey(spec.revision, spec.path)).join("\n")}\n`),
        stdout: "pipe",
        stderr: "pipe",
      }).stdout;
      // `cat-file --batch` answers each request with a header line and then exactly `size` bytes,
      // so the stream is parsed by byte count; a page may itself contain lines that look like headers.
      const bytes = new Uint8Array(output);
      const decoder = new TextDecoder();
      let offset = 0;
      for (const spec of specs) {
        const newline = bytes.indexOf(10, offset);
        const header = decoder.decode(bytes.subarray(offset, newline));
        offset = newline + 1;
        if (header.endsWith(" missing")) {
          results.set(specKey(spec.revision, spec.path), null);
          continue;
        }
        const size = Number(header.split(" ")[2]);
        results.set(specKey(spec.revision, spec.path), decoder.decode(bytes.subarray(offset, offset + size)));
        offset += size + 1;
      }
      return results;
    },
    changedPaths(from, to) {
      return runGit(repoRoot, ["diff", "--name-only", from, to, "--", ...DOC_PATHSPECS])
        .split("\n")
        .filter(Boolean);
    },
    shortRevision(revision) {
      return runGit(repoRoot, ["rev-parse", "--short", revision]).trim();
    },
  };
}

/**
 * Text a translator is responsible for: the body plus the frontmatter fields readers see. Other
 * frontmatter (sidebar order, `aiGenerated`) changes without creating translation work.
 */
export function translatableText(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const frontmatter = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!frontmatter) return normalized.trim();
  const visible = frontmatter[1].split("\n").filter((line) => /^\s*(title|description|label):/.test(line));
  return [...visible, normalized.slice(frontmatter[0].length)].join("\n").trim();
}

/** Lines present on one side but not the other, counted as a multiset. */
export function changedLineCount(before: string, after: string): number {
  const counts = new Map<string, number>();
  for (const line of before.split("\n")) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of after.split("\n")) {
    const remaining = counts.get(line) ?? 0;
    if (remaining > 0) counts.set(line, remaining - 1);
    else added++;
  }
  const removed = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return Math.max(added, removed);
}

interface PagePath {
  page: string;
  english: string;
  translation(locale: string): string;
}

/** Maps a repository path to its page identity, or null when it is not a tracked translation surface. */
export function englishPageFor(path: string): PagePath | null {
  if (path === "README.md") {
    return { page: "README.md", english: path, translation: (locale) => `.github/README_${locale}.md` };
  }
  const match = /^docs\/en\/(.+\.mdx?)$/.exec(path);
  if (!match) return null;
  const page = match[1];
  if (ENGLISH_ONLY_DOC_SECTIONS.some((section) => page.startsWith(section))) return null;
  if ((GENERATED_DOC_PAGES as readonly string[]).includes(page)) return null;
  return { page, english: path, translation: (locale) => `docs/${locale}/${page}` };
}

/** Maps a translated path back to its page identity and locale. */
function translatedPageFor(
  path: string,
  locales: readonly string[],
): { page: string; locale: string; english: string } | null {
  const readme = /^\.github\/README_(.+)\.md$/.exec(path);
  if (readme && locales.includes(readme[1])) return { page: "README.md", locale: readme[1], english: "README.md" };
  const doc = /^docs\/([^/]+)\/(.+\.mdx?)$/.exec(path);
  if (doc && doc[1] !== "en" && locales.includes(doc[1])) {
    return { page: doc[2], locale: doc[1], english: `docs/en/${doc[2]}` };
  }
  return null;
}

function sortEntries(entries: DocsStaleEntry[]): DocsStaleEntry[] {
  return entries.sort((a, b) => a.locale.localeCompare(b.locale) || a.page.localeCompare(b.page));
}

/**
 * Whole-tree state at HEAD: pages with no translation (`missing`), translations with no English
 * source or inside an English-only section (`orphaned`), and translations whose English source
 * changed after their last commit (`drifted`).
 */
export function findDocsTreeStaleness(git: DocsGit, locales: readonly string[]): DocsStaleEntry[] {
  const files = new Set(git.listFiles("HEAD"));
  const entries: DocsStaleEntry[] = [];
  const driftCandidates: { page: PagePath; locale: string; baseline: string }[] = [];
  const lastCommits = git.lastCommits();

  for (const path of files) {
    const page = englishPageFor(path);
    if (!page) continue;
    for (const locale of locales) {
      const translation = page.translation(locale);
      if (!files.has(translation)) {
        entries.push({ reason: "missing", page: page.page, locale, english: page.english, translation });
        continue;
      }
      const baseline = lastCommits.get(translation);
      if (baseline) driftCandidates.push({ page, locale, baseline });
    }
  }

  for (const path of files) {
    const translated = translatedPageFor(path, locales);
    if (!translated || (GENERATED_DOC_PAGES as readonly string[]).includes(translated.page)) continue;
    const englishOnly = ENGLISH_ONLY_DOC_SECTIONS.some((section) => translated.page.startsWith(section));
    if (englishOnly || !files.has(translated.english)) {
      entries.push({ reason: "orphaned", ...translated, translation: path });
    }
  }

  const texts = git.readMany([
    ...driftCandidates.map((candidate) => ({ revision: candidate.baseline, path: candidate.page.english })),
    ...[...new Set(driftCandidates.map((candidate) => candidate.page.english))].map((path) => ({
      revision: "HEAD",
      path,
    })),
  ]);
  for (const { page, locale, baseline } of driftCandidates) {
    // A missing English page at the baseline means the translation predates its source (a rename,
    // or a page written ahead of English), so every line counts as unconfirmed.
    const before = texts.get(specKey(baseline, page.english));
    const beforeText = before ? translatableText(before) : "";
    const afterText = translatableText(texts.get(specKey("HEAD", page.english)) ?? "");
    if (beforeText === afterText) continue;
    entries.push({
      reason: "drifted",
      page: page.page,
      locale,
      english: page.english,
      translation: page.translation(locale),
      baseline: git.shortRevision(baseline),
      changedLines: changedLineCount(beforeText, afterText),
    });
  }
  return sortEntries(entries);
}

/**
 * Branch follow-up: English pages whose translatable text changed between the merge base and HEAD
 * while a translation stayed untouched in the same range. An added English page with no
 * translation is reported as `added`; a removed one whose translation remains, as `removed`.
 */
export function findDocsUnfollowed(git: DocsGit, mergeBase: string, locales: readonly string[]): DocsStaleEntry[] {
  const changed = new Set(git.changedPaths(mergeBase, "HEAD"));
  const pages = [...changed].map(englishPageFor).filter((page): page is PagePath => page !== null);
  if (pages.length === 0) return [];

  const texts = git.readMany(
    pages.flatMap((page) => [
      { revision: mergeBase, path: page.english },
      { revision: "HEAD", path: page.english },
    ]),
  );
  const headFiles = new Set(git.listFiles("HEAD"));
  const entries: DocsStaleEntry[] = [];

  for (const page of pages) {
    const before = texts.get(specKey(mergeBase, page.english)) ?? null;
    const after = texts.get(specKey("HEAD", page.english)) ?? null;
    const beforeText = before === null ? null : translatableText(before);
    const afterText = after === null ? null : translatableText(after);
    if (beforeText === afterText) continue;
    const change = beforeText === null ? "added" : afterText === null ? "removed" : "changed";

    for (const locale of locales) {
      const translation = page.translation(locale);
      const exists = headFiles.has(translation);
      if (change === "removed" ? !exists : changed.has(translation)) continue;
      entries.push({
        reason: "unfollowed",
        page: page.page,
        locale,
        english: page.english,
        translation,
        change,
        changedLines: changedLineCount(beforeText ?? "", afterText ?? ""),
      });
    }
  }
  return sortEntries(entries);
}

/** Renders docs entries grouped by reason and page, listing the locales behind each page. */
export function formatDocsStaleness(entries: DocsStaleEntry[]): string[] {
  const titles: Record<DocsStaleReason, string> = {
    unfollowed: "Docs pages this branch changed without updating the translation",
    drifted: "Translated docs pages whose English source changed after the translation's last commit",
    missing: "Docs pages with no translation (readers get the English fallback)",
    orphaned: "Translated docs pages with no English source, or inside an English-only section",
  };
  const lines: string[] = [];
  for (const reason of ["unfollowed", "drifted", "missing", "orphaned"] as const) {
    const ofReason = entries.filter((entry) => entry.reason === reason);
    if (ofReason.length === 0) continue;
    lines.push(`\n## ${titles[reason]} (${ofReason.length})`);
    const byPage = new Map<string, DocsStaleEntry[]>();
    for (const entry of ofReason) byPage.set(entry.page, [...(byPage.get(entry.page) ?? []), entry]);
    for (const [page, pageEntries] of [...byPage].sort(([a], [b]) => a.localeCompare(b))) {
      const locales = pageEntries
        .map((entry) => {
          if (entry.reason === "drifted") {
            return `${entry.locale} (${entry.changedLines} line${entry.changedLines === 1 ? "" : "s"} since ${entry.baseline})`;
          }
          if (entry.reason === "orphaned") return `${entry.locale} (${entry.translation})`;
          return entry.locale;
        })
        .join(", ");
      const change = pageEntries[0].change ? ` [English ${pageEntries[0].change}]` : "";
      lines.push(`  ${page}${change}: ${locales}`);
    }
  }
  return lines;
}
