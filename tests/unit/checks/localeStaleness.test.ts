import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  GitUnavailableError,
  LocaleParseError,
  MissingBaseRefError,
  buildStalenessReport,
  checkLocaleStaleness,
  defaultGitRunner,
  normalizeLocaleValue,
  parseArguments,
  parseLocaleSource,
  readHeadSnapshot,
  readWorkingTreeSnapshot,
  renderStalenessReport,
  resolveBaseRef,
  type StalenessReport,
} from "../../../scripts/checks/checkLocaleStaleness";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

const temporaryRoots: string[] = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd: string, ...args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd, env: GIT_ENV, stdout: "pipe", stderr: "pipe" });
  const stdout = new TextDecoder().decode(proc.stdout).trim();
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(proc.stderr).trim()}`);
  }
  return stdout;
}

interface FixtureRepo {
  root: string;
  write(relativePath: string, contents: string): void;
  commit(message: string): string;
}

/**
 * Base repositories, keyed by their file map, built once and copied per case.
 *
 * Building a repository costs a `git init`, a `git add`, and a `git commit`; the cases here only
 * differ in what they do afterwards, so paying that once per distinct starting shape is enough.
 * Every case still gets its own repository, because each one commits its own change.
 */
const templateRepos = new Map<string, string>();

afterAll(() => {
  for (const root of templateRepos.values()) rmSync(root, { recursive: true, force: true });
  templateRepos.clear();
});

function templateRepo(files: Record<string, string>): string {
  const key = JSON.stringify(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));
  const cached = templateRepos.get(key);
  if (cached) return cached;

  const root = createRepoAt(mkdtempSync(join(tmpdir(), "locale-staleness-template-")));
  for (const [relativePath, contents] of Object.entries(files)) writeLocaleFile(root, relativePath, contents);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "fixture base");

  templateRepos.set(key, root);
  return root;
}

function createRepoAt(root: string): string {
  git(root, "init", "-q", "-b", "main");
  return root;
}

function writeLocaleFile(root: string, relativePath: string, contents: string): void {
  const target = join(root, "src", "locales", relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf8");
}

/**
 * A real repository rather than a mocked git, so the shallow-clone, missing-ref, and merge-base
 * paths under test are the ones the command actually takes.
 */
function createFixtureRepo(files: Record<string, string>): FixtureRepo {
  const root = mkdtempSync(join(tmpdir(), "locale-staleness-"));
  temporaryRoots.push(root);
  cpSync(templateRepo(files), root, { recursive: true });

  return {
    root,
    write: (relativePath, contents) => writeLocaleFile(root, relativePath, contents),
    commit(message) {
      git(root, "add", "-A");
      git(root, "commit", "-qm", message);
      return git(root, "rev-parse", "HEAD");
    },
  };
}

function localeObject(body: string): string {
  return `export default {\n${body}\n};\n`;
}

function reportFor(repo: FixtureRepo, base: string, source?: "head" | "worktree"): Promise<StalenessReport> {
  return checkLocaleStaleness({ repoRoot: repo.root, base, source });
}

/**
 * A genuine CI-shaped shallow checkout: one commit, no remote-tracking base branch, and no local
 * `main`. The refs are deleted deliberately because a `file://` clone otherwise copies the source
 * repository's branches and leaves a resolvable base behind.
 */
function createShallowClone(source: FixtureRepo): string {
  const root = mkdtempSync(join(tmpdir(), "locale-staleness-shallow-"));
  temporaryRoots.push(root);
  const clone = join(root, "clone");
  git(source.root, "clone", "-q", "--depth=1", "--no-local", `file://${source.root}`, clone);
  git(clone, "checkout", "-q", "--detach", "HEAD");

  for (const ref of git(clone, "for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes").split("\n")) {
    if (ref.trim()) git(clone, "update-ref", "-d", ref.trim());
  }

  return clone;
}

const BASE_FILES = {
  "en-US/general.ts": localeObject(`  general: {\n    language_name: \`English\`,\n  },`),
  "ja/general.ts": localeObject(`  general: {\n    language_name: \`日本語\`,\n  },`),
};

describe("checkLocaleStaleness parsing", () => {
  it("reads nested keys and ignores commented-out and quoted examples", () => {
    const { values } = parseLocaleSource(
      `export default {\n  general: {\n    // commented_key: \`not a key\`,\n    yes: \`Yes\`,\n  },\n  "/etc/passwd": \`odd but literal\`,\n};\n`,
      "en-US/general.ts",
    );

    // A commented-out key is not a key, while a quoted literal name is one the runtime can read.
    expect([...values.keys()].sort()).toEqual(["/etc/passwd", "general.yes"]);
    expect(values.get("general.yes")).toBe("Yes");
  });

  it("reports a key one file defines twice with different values as a conflict", () => {
    const parsed = parseLocaleSource(
      `export default {\n  general: {\n    repeated: \`First\`,\n    repeated: \`Second\`,\n  },\n};\n`,
      "ja/general.ts",
    );

    // TypeScript rejects this shape, which is exactly why the parser must not pretend the last
    // definition is authoritative.
    expect([...parsed.conflicts]).toEqual(["general.repeated"]);
  });

  it("treats a repeated identical value as one ordinary value", () => {
    const parsed = parseLocaleSource(
      `export default {\n  general: {\n    repeated: \`Same\`,\n    repeated: \`Same\`,\n  },\n};\n`,
      "ja/general.ts",
    );

    expect(parsed.conflicts.size).toBe(0);
    expect(parsed.values.get("general.repeated")).toBe("Same");
  });

  it("reads nested key paths", () => {
    const { values } = parseLocaleSource(
      localeObject(`  general: {\n    nested: { deeper: \`value\` },\n  },`),
      "en-US/general.ts",
    );

    expect([...values.keys()]).toEqual(["general.nested.deeper"]);
    expect(values.get("general.nested.deeper")).toBe("value");
  });

  it("treats arrays as locale data rather than translatable text", () => {
    const { values } = parseLocaleSource(
      localeObject(`  defaults: {\n    base_trigger_words: ["tomori", "tomo"],\n    bot_name: \`Tomori\`,\n  },`),
      "en-US/general.ts",
    );

    expect([...values.keys()]).toEqual(["defaults.bot_name"]);
  });

  it("rejects a file with no exported object literal", () => {
    expect(() => parseLocaleSource(`export default 3;\n`, "en-US/general.ts")).toThrow(LocaleParseError);
  });

  it("rejects a non-literal leaf the runtime would resolve dynamically", () => {
    expect(() => parseLocaleSource(localeObject(`  general: { yes: someFunction() },`), "en-US/general.ts")).toThrow(
      /is neither a string nor a nested object literal/,
    );
  });

  it("normalizes indentation and blank lines but keeps wording significant", () => {
    expect(normalizeLocaleValue("  Line one  \n\n   Line two ")).toBe("Line one\n\nLine two");
    expect(normalizeLocaleValue("Line one Line two")).not.toBe(normalizeLocaleValue("Line two Line one"));
  });

  it("accepts --base in both forms and rejects a missing ref", () => {
    expect(parseArguments(["--base=origin/main"]).base).toBe("origin/main");
    expect(parseArguments(["--base", "HEAD~2"]).base).toBe("HEAD~2");
    expect(parseArguments(["--base=origin/main", "--verbose"]).verboseOutput).toBe(true);
    expect(() => parseArguments(["--base"])).toThrow(/--base requires a git ref/);
  });
});

describe("checkLocaleStaleness advisories", () => {
  it("reports an added English key with no translation edit", async () => {
    const repo = createFixtureRepo(BASE_FILES);
    const base = git(repo.root, "rev-parse", "HEAD");

    repo.write(
      "en-US/general.ts",
      localeObject(`  general: {\n    language_name: \`English\`,\n    branch_added: \`Fresh string\`,\n  },`),
    );
    repo.commit("add english key");

    const report = await reportFor(repo, base);
    expect(report.added.map((entry) => entry.key)).toEqual(["general.branch_added"]);
    expect(report.changed).toEqual([]);
    expect(report.removed).toEqual([]);

    const added = report.added[0];
    expect(added?.missing.map((status) => status.locale)).toEqual(["ja"]);
    expect(added?.review).toEqual([]);

    const rendered = renderStalenessReport(report, { verboseOutput: false });
    expect(rendered).toContain("no translation yet: ja");
    expect(rendered).toContain("advisory only");
  });

  it("separates a changed English value from an untouched translation and an updated one", async () => {
    const repo = createFixtureRepo({
      "en-US/general.ts": localeObject(
        `  general: {\n    untouched: \`First wording\`,\n    updated: \`First wording\`,\n  },`,
      ),
      "ja/general.ts": localeObject(`  general: {\n    untouched: \`最初の文言\`,\n    updated: \`最初の文言\`,\n  },`),
      "es-419/general.ts": localeObject(
        `  general: {\n    untouched: \`Primera redacción\`,\n    updated: \`Primera redacción\`,\n  },`,
      ),
    });
    const base = git(repo.root, "rev-parse", "HEAD");

    repo.write(
      "en-US/general.ts",
      localeObject(`  general: {\n    untouched: \`Second wording\`,\n    updated: \`Second wording\`,\n  },`),
    );
    repo.write(
      "ja/general.ts",
      localeObject(`  general: {\n    untouched: \`最初の文言\`,\n    updated: \`第二の文言\`,\n  },`),
    );
    repo.commit("change english and one translation");

    const report = await reportFor(repo, base);
    expect(report.added).toEqual([]);
    expect(report.changed.map((entry) => entry.key)).toEqual(["general.untouched", "general.updated"]);

    // The Japanese translation moved with the English value, so the unchanged translations remain.
    const untouched = report.changed.find((entry) => entry.key === "general.untouched");
    expect(untouched?.review.map((status) => status.locale)).toEqual(["es-419", "ja"]);

    const updated = report.changed.find((entry) => entry.key === "general.updated");
    expect(updated?.review.map((status) => status.locale)).toEqual(["es-419"]);
    expect(updated?.missing).toEqual([]);
  });

  it("reports a removal without asking for translation work", async () => {
    const repo = createFixtureRepo({
      "en-US/general.ts": localeObject(`  general: {\n    going_away: \`Removed later\`,\n  },`),
      "ja/general.ts": localeObject(`  general: {\n    going_away: \`後で削除\`,\n  },`),
    });
    const base = git(repo.root, "rev-parse", "HEAD");

    repo.write("en-US/general.ts", localeObject(`  general: {},`));
    repo.commit("remove english key");

    const report = await reportFor(repo, base);
    expect(report.removed.map((entry) => entry.key)).toEqual(["general.going_away"]);
    expect(report.added).toEqual([]);
    expect(report.changed).toEqual([]);

    const rendered = renderStalenessReport(report, { verboseOutput: false });
    expect(rendered).toContain("REMOVED KEYS (1)");
    expect(rendered).toContain("No translation work");
  });

  it("finds keys in nested command locale files through the assembler", async () => {
    const repo = createFixtureRepo({
      "en-US/commands.ts": `import learn from "./commands/learn";\n\nexport default {\n  commands: {\n    ...learn,\n  },\n};\n`,
      "en-US/commands/learn.ts": localeObject(
        `  commands: {\n    learn: {\n      description: \`Learn things\`,\n    },\n  },`,
      ),
      "ja/commands/learn.ts": localeObject(
        `  commands: {\n    learn: {\n      description: \`学びます\`,\n    },\n  },`,
      ),
    });
    const base = git(repo.root, "rev-parse", "HEAD");

    repo.write(
      "en-US/commands/learn.ts",
      localeObject(
        `  commands: {\n    learn: {\n      description: \`Learn things\`,\n      history: {\n        description: \`New nested key\`,\n      },\n    },\n  },`,
      ),
    );
    repo.commit("add nested command key");

    const report = await reportFor(repo, base);
    expect(report.added.map((entry) => entry.key)).toEqual(["commands.learn.history.description"]);
    expect(report.added[0]?.missing.map((status) => status.locale)).toEqual(["ja"]);
  });

  it("reports nothing for changes outside the locale tree", async () => {
    const repo = createFixtureRepo(BASE_FILES);
    const base = git(repo.root, "rev-parse", "HEAD");

    mkdirSync(join(repo.root, "src", "utils"), { recursive: true });
    writeFileSync(join(repo.root, "src", "utils", "thing.ts"), "export const thing = 1;\n", "utf8");
    repo.commit("change unrelated source");

    const report = await reportFor(repo, base);
    expect(report.added).toEqual([]);
    expect(report.changed).toEqual([]);
    expect(report.removed).toEqual([]);

    const rendered = renderStalenessReport(report, { verboseOutput: false });
    expect(rendered).toContain("no translation follow-up");
  });

  it("ignores a formatting-only edit to a locale file", async () => {
    const repo = createFixtureRepo({
      "en-US/general.ts": localeObject(`  general: {\n    language_name: \`English\`,\n  },`),
      "ja/general.ts": localeObject(`  general: {\n    language_name: \`日本語\`,\n  },`),
    });
    const base = git(repo.root, "rev-parse", "HEAD");

    repo.write("en-US/general.ts", localeObject(`  general: {\n\n\n    language_name:      \`English\`,\n\n  },`));
    repo.write("ja/general.ts", localeObject(`  general: {\n      language_name: \`日本語\`,\n  },`));
    repo.commit("reformat locale files");

    const report = await reportFor(repo, base);
    expect(report.added).toEqual([]);
    expect(report.changed).toEqual([]);
  });

  it("keeps a translation-only edit out of the advisory", async () => {
    const repo = createFixtureRepo(BASE_FILES);
    const base = git(repo.root, "rev-parse", "HEAD");

    repo.write("ja/general.ts", localeObject(`  general: {\n    language_name: \`日本語（改）\`,\n  },`));
    repo.commit("translate only");

    const report = await reportFor(repo, base);
    expect(report.added).toEqual([]);
    expect(report.changed).toEqual([]);
    expect(report.removed).toEqual([]);

    // The edit tally is a branch summary, so it counts the Japanese touch; the report itself has
    // nothing to say because no English value moved.
    expect(report.localeEditCounts.get("ja")).toBeGreaterThan(0);
    expect(report.localeEditCounts.get("en-US")).toBe(0);
  });

  it("reports an unusable base ref instead of treating every key as new", async () => {
    const repo = createFixtureRepo(BASE_FILES);

    await expect(reportFor(repo, "origin/does-not-exist")).rejects.toThrow(MissingBaseRefError);
    await expect(reportFor(repo, "origin/does-not-exist")).rejects.toThrow(/not present in this checkout/);
    await expect(reportFor(repo, "origin/does-not-exist")).rejects.toThrow(/git fetch origin does-not-exist/);
  });

  it("fails on a shallow checkout instead of reporting an empty branch", async () => {
    const repo = createFixtureRepo(BASE_FILES);
    const clone = createShallowClone(repo);

    // No candidate ref resolves, and HEAD would compare the clone with itself and report nothing,
    // so the command has to refuse rather than print a clean advisory for missing history.
    await expect(checkLocaleStaleness({ repoRoot: clone })).rejects.toThrow(MissingBaseRefError);
    await expect(checkLocaleStaleness({ repoRoot: clone })).rejects.toThrow(/shallow checkout/);
  });

  it("names the fetch that unblocks a shallow checkout", async () => {
    const repo = createFixtureRepo(BASE_FILES);
    const clone = createShallowClone(repo);

    await expect(resolveBaseRef(defaultGitRunner, clone)).rejects.toThrow(/git fetch --unshallow/);
  });

  it("reports a directory that is not a git checkout", async () => {
    const root = mkdtempSync(join(tmpdir(), "locale-staleness-bare-"));
    temporaryRoots.push(root);
    mkdirSync(join(root, "src", "locales", "en-US"), { recursive: true });

    await expect(checkLocaleStaleness({ repoRoot: root })).rejects.toThrow(GitUnavailableError);
  });

  it("compares against the merge base rather than the base branch tip", async () => {
    const repo = createFixtureRepo(BASE_FILES);
    const branchPoint = git(repo.root, "rev-parse", "HEAD");

    // The base branch advances after this feature branch starts, so its tip holds an English key
    // the branch never saw. Diffing against the tip would invent that key as a removal.
    repo.write(
      "en-US/general.ts",
      localeObject(`  general: {\n    language_name: \`English\`,\n    landed_after_branch: \`Later work\`,\n  },`),
    );
    const baseTip = repo.commit("advance main");

    git(repo.root, "checkout", "-q", "-b", "feature", branchPoint);
    repo.write("ja/general.ts", localeObject(`  general: {\n    language_name: \`日本語（改）\`,\n  },`));
    repo.commit("feature translation edit");

    const report = await reportFor(repo, baseTip);
    expect(report.baseRevision).toBe(branchPoint);
    expect(report.removed).toEqual([]);
    expect(report.added).toEqual([]);
    expect(report.changed).toEqual([]);
  });

  it("excludes a key conflicted in a translation locale from every section", async () => {
    const repo = createFixtureRepo({
      "en-US/general.ts": localeObject(`  general: {\n    contested: \`First wording\`,\n  },`),
      "ja/general.ts": localeObject(`  general: {\n    contested: \`最初の文言\`,\n  },`),
      "ja/other.ts": localeObject(`  general: {\n    contested: \`別の文言\`,\n  },`),
    });
    const base = git(repo.root, "rev-parse", "HEAD");

    repo.write("en-US/general.ts", localeObject(`  general: {\n    contested: \`Second wording\`,\n  },`));
    repo.commit("change english under a japanese conflict");

    const report = await reportFor(repo, base);

    // The English value did move, but the key's meaning is unsettled in Japanese, so reporting it as
    // changed while also listing it as skipped would contradict the skipped list.
    expect(report.added).toEqual([]);
    expect(report.changed).toEqual([]);
    expect(report.removed).toEqual([]);
    expect([...report.conflicts]).toEqual(["general.contested"]);

    const rendered = renderStalenessReport(report, { verboseOutput: false });
    expect(rendered).toContain("SKIPPED KEYS (1)");
    expect(rendered).not.toContain("MATERIALLY CHANGED ENGLISH VALUES");
  });

  it("excludes a key two files in one locale define with different values, without calling it removed", async () => {
    const repo = createFixtureRepo({
      "en-US/general.ts": localeObject(`  general: {\n    contested: \`Assembler value\`,\n  },`),
      "en-US/other.ts": localeObject(`  general: {\n    contested: \`Second value\`,\n  },`),
      "ja/general.ts": localeObject(`  general: {\n    contested: \`争いのある値\`,\n  },`),
    });
    const base = git(repo.root, "rev-parse", "HEAD");

    repo.write("en-US/general.ts", localeObject(`  general: {\n    contested: \`Changed text\`,\n  },`));
    repo.commit("move a conflicting english value");

    const report = await reportFor(repo, base);

    // The conflict is neither an addition, a change, nor a removal, because `Object.assign` order
    // decides the runtime value and the advisory cannot pick one.
    expect(report.added).toEqual([]);
    expect(report.changed).toEqual([]);
    expect(report.removed).toEqual([]);
    expect([...report.conflicts]).toEqual(["general.contested"]);

    const rendered = renderStalenessReport(report, { verboseOutput: false });
    expect(rendered).toContain("SKIPPED KEYS (1)");
    expect(rendered).toContain("general.contested");
    expect(rendered).not.toContain("no translation yet");
  });

  it("keeps a key two files define with the same value in the comparison", async () => {
    const repo = createFixtureRepo({
      "en-US/general.ts": localeObject(`  general: {\n    shared: \`Same text\`,\n  },`),
      "en-US/other.ts": localeObject(`  general: {\n    shared: \`Same text\`,\n  },`),
      "ja/general.ts": localeObject(`  general: {\n    shared: \`同じ文言\`,\n  },`),
    });
    const base = git(repo.root, "rev-parse", "HEAD");

    repo.write("en-US/general.ts", localeObject(`  general: {\n    shared: \`Renamed text\`,\n  },`));
    repo.write("en-US/other.ts", localeObject(`  general: {\n    shared: \`Renamed text\`,\n  },`));
    repo.commit("rename the agreed value");

    const report = await reportFor(repo, base);
    expect(report.conflicts.size).toBe(0);
    expect(report.changed.map((entry) => entry.key)).toEqual(["general.shared"]);
  });

  it("treats every authored non-English locale as advisory follow-up", () => {
    const report = buildStalenessReport({
      requestedBase: "base",
      baseRevision: "base",
      headRevision: "head",
      base: {
        values: new Map([["en-US:general.key", "Old"]]),
        locales: ["en-US", "ja", "zh-CN"],
        conflicts: new Set(),
      },
      head: {
        values: new Map([
          ["en-US:general.key", "New"],
          ["ja:general.key", "古い"],
          ["zh-CN:general.key", "旧"],
        ]),
        locales: ["en-US", "ja", "zh-CN"],
        conflicts: new Set(),
      },
    });

    expect(report.translationLocales).toEqual(["ja", "zh-CN"]);
    expect(renderStalenessReport(report, { verboseOutput: false })).toContain(
      "Authored translation locales: ja, zh-CN",
    );
  });
});

describe("checkLocaleStaleness head source", () => {
  it("reports the committed branch and excludes uncommitted locale edits from it", async () => {
    const repo = createFixtureRepo(BASE_FILES);
    const base = git(repo.root, "rev-parse", "HEAD");

    // Committed work the report must see, plus local work it must not attribute to the branch.
    repo.write(
      "en-US/general.ts",
      localeObject(`  general: {\n    language_name: \`English\`,\n    committed_key: \`In the branch\`,\n  },`),
    );
    repo.commit("commit a key");
    repo.write("ja/general.ts", localeObject(`  general: {\n    language_name: \`日本語（未コミット）\`,\n  },`));

    const report = await reportFor(repo, base);
    expect(report.added.map((entry) => entry.key)).toEqual(["general.committed_key"]);

    // The Japanese edit is absent from the comparison, and its presence in the working tree is
    // disclosed rather than silently folded into the branch.
    expect(report.localeEditCounts.get("ja")).toBe(0);
    expect(report.includesUncommittedEdits).toBe(true);
    const rendered = renderStalenessReport(report, { verboseOutput: false });
    expect(rendered).toContain("Working tree contains uncommitted locale edits");
    expect(rendered).not.toContain("Head includes uncommitted locale edits");
  });

  it("does not claim uncommitted edits when the locale tree is clean", async () => {
    const repo = createFixtureRepo(BASE_FILES);
    const base = git(repo.root, "rev-parse", "HEAD");

    // `--worktree` on a clean tree reads exactly what HEAD holds, so a disclosure here would be a
    // false alarm rather than information.
    const report = await reportFor(repo, base, "worktree");
    expect(report.includesUncommittedEdits).toBe(false);
    expect(report.uncommittedLocalePaths).toEqual([]);
    expect(renderStalenessReport(report, { verboseOutput: false })).not.toContain("uncommitted locale edits");
  });

  it("includes uncommitted locale edits when asked, and says so", async () => {
    const repo = createFixtureRepo(BASE_FILES);
    const base = git(repo.root, "rev-parse", "HEAD");

    repo.write(
      "en-US/general.ts",
      localeObject(`  general: {\n    language_name: \`English\`,\n    uncommitted_key: \`Not committed\`,\n  },`),
    );

    const report = await reportFor(repo, base, "worktree");
    expect(report.added.map((entry) => entry.key)).toEqual(["general.uncommitted_key"]);
    expect(report.includesUncommittedEdits).toBe(true);
    expect(report.uncommittedLocalePaths).toContain("src/locales/en-US/general.ts");

    const rendered = renderStalenessReport(report, { verboseOutput: false });
    expect(rendered).toContain("Working tree contains uncommitted locale edits");
  });

  it("flags uncommitted edits even without being asked, so the report cannot mislead", async () => {
    const repo = createFixtureRepo(BASE_FILES);
    const base = git(repo.root, "rev-parse", "HEAD");

    repo.write("en-US/general.ts", localeObject(`  general: {\n    language_name: \`English (edited)\`,\n  },`));

    const report = await reportFor(repo, base);
    expect(report.added).toEqual([]);
    expect(report.changed).toEqual([]);
    expect(report.includesUncommittedEdits).toBe(true);
    expect(renderStalenessReport(report, { verboseOutput: false })).toContain(
      "Working tree contains uncommitted locale edits",
    );
  });

  it("includes an untracked locale file under --worktree and discloses it", async () => {
    const repo = createFixtureRepo(BASE_FILES);
    const base = git(repo.root, "rev-parse", "HEAD");

    // A brand new file that has not been added yet is the most common shape of work in progress.
    repo.write("en-US/features.ts", localeObject(`  general: {\n    draft_key: \`Written but not staged\`,\n  },`));

    const committed = await reportFor(repo, base);
    expect(committed.added).toEqual([]);
    expect(committed.uncommittedLocalePaths).toContain("src/locales/en-US/features.ts");
    expect(renderStalenessReport(committed, { verboseOutput: false })).toContain(
      "Working tree contains uncommitted locale edits",
    );

    const worktree = await reportFor(repo, base, "worktree");
    expect(worktree.added.map((entry) => entry.key)).toEqual(["general.draft_key"]);
    expect(worktree.uncommittedLocalePaths).toContain("src/locales/en-US/features.ts");

    expect((await readWorkingTreeSnapshot(defaultGitRunner, repo.root)).values.get("en-US:general.draft_key")).toBe(
      "Written but not staged",
    );
  });

  it("leaves an uncommitted deletion out of the committed report and compares it under --worktree", async () => {
    const repo = createFixtureRepo(BASE_FILES);
    const base = git(repo.root, "rev-parse", "HEAD");
    rmSync(join(repo.root, "src", "locales", "en-US", "general.ts"));

    // The deletion is not in the branch, so the committed report is unchanged and says the tree is
    // dirty rather than dropping the file from the comparison.
    const report = await reportFor(repo, base);
    expect(report.removed).toEqual([]);
    expect(report.includesUncommittedEdits).toBe(true);

    const worktree = await reportFor(repo, base, "worktree");
    expect(worktree.removed.map((entry) => entry.key)).toEqual(["general.language_name"]);
  });

  it("fails when a tracked locale file cannot be read for a reason other than deletion", async () => {
    const repo = createFixtureRepo(BASE_FILES);
    const filePath = join(repo.root, "src", "locales", "en-US", "general.ts");

    // A path that exists but is a directory is a broken checkout, not a deletion, so the snapshot
    // refuses instead of treating the branch as if the file were gone.
    rmSync(filePath);
    mkdirSync(filePath);

    await expect(readWorkingTreeSnapshot(defaultGitRunner, repo.root)).rejects.toThrow(LocaleParseError);
    await expect(readWorkingTreeSnapshot(defaultGitRunner, repo.root)).rejects.toThrow(/Could not read/);
  });

  it("reads the committed tree even while the working tree is dirty", async () => {
    const repo = createFixtureRepo(BASE_FILES);
    const committed = await readHeadSnapshot(defaultGitRunner, repo.root);
    expect(committed.values.get("en-US:general.language_name")).toBe("English");

    repo.write("en-US/general.ts", localeObject(`  general: {\n    language_name: \`Dirty\`,\n  },`));
    expect((await readHeadSnapshot(defaultGitRunner, repo.root)).values.get("en-US:general.language_name")).toBe(
      "English",
    );
    expect((await readWorkingTreeSnapshot(defaultGitRunner, repo.root)).values.get("en-US:general.language_name")).toBe(
      "Dirty",
    );
  });

  it("accepts --worktree and defaults to committed HEAD", () => {
    expect(parseArguments([]).source).toBe("head");
    expect(parseArguments(["--worktree"]).source).toBe("worktree");
    expect(parseArguments(["--base=origin/main", "--worktree"]).source).toBe("worktree");
  });
});

describe("checkLocaleStaleness injected snapshots", () => {
  it("ignores a key whose base side is self-conflicting, so it is not read as removed", () => {
    const report = buildStalenessReport({
      requestedBase: "main",
      baseRevision: "aaaaaaa",
      headRevision: "bbbbbbb",
      base: {
        values: new Map([["en-US:general.clean", "Clean"]]),
        locales: ["en-US"],
        conflicts: new Set(["en-US:general.contested"]),
      },
      head: {
        values: new Map([
          ["en-US:general.clean", "Clean"],
          ["en-US:general.contested", "Head value"],
        ]),
        locales: ["en-US"],
        conflicts: new Set(),
      },
    });

    expect(report.added).toEqual([]);
    expect(report.removed).toEqual([]);
    expect([...report.conflicts]).toEqual(["general.contested"]);
  });
});
