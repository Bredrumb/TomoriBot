import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DriftHistoryError, createGitDriftSource } from "../../scripts/devtools/localeDrift";
import { findDriftedTranslations } from "../../scripts/devtools/findStaleTranslations";

/**
 * History behaviour that only a real repository can prove.
 *
 * The unit tests drive the scan through an injected source, which cannot show what `git blame`
 * actually reports when the history is truncated. A shallow clone is exactly that case, and it fails
 * in the direction that matters: blame attributes every line to the grafted root, whose English file
 * is the newest the clone holds, so the scan finds nothing and reports the tree as clean.
 *
 * These tests build a real repository with a real commit graph, then clone it at depth 1.
 */
const REPO_TIMEOUT_MS = 120_000;
const GIT_ENV = {
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.com",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.com",
};

let workspace = "";
let sourceRepo = "";
let shallowRepo = "";

function git(args: string[], cwd: string, date?: string): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: { ...Bun.env, ...GIT_ENV, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function localeFile(entries: Array<[string, string]>): string {
  const body = entries.map(([key, value]) => `    ${key}: ${value},`).join("\n");
  return `export default {\n  general: {\n${body}\n  },\n};\n`;
}

async function commitFiles(files: Record<string, string>, message: string, date: string): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const full = join(sourceRepo, path);
    await Bun.write(full, content);
  }
  git(["add", "-A"], sourceRepo);
  git(["commit", "-q", "-m", message], sourceRepo, date);
}

describe("locale drift: real repository history", () => {
  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "locale-drift-"));
    sourceRepo = join(workspace, "source");
    shallowRepo = join(workspace, "shallow");

    git(["init", "-q", "-b", "main", sourceRepo], workspace);
    git(["config", "user.email", GIT_ENV.GIT_AUTHOR_EMAIL], sourceRepo);
    git(["config", "user.name", GIT_ENV.GIT_AUTHOR_NAME], sourceRepo);

    const englishPath = "src/locales/en-US/general.ts";
    const japanesePath = "src/locales/ja/general.ts";

    await commitFiles(
      {
        [englishPath]: localeFile([["moved", "`Original English`"]]),
        [japanesePath]: localeFile([["moved", "`元の日本語`"]]),
      },
      "add locale trees",
      "2026-01-01T00:00:00Z",
    );

    // English moves on its own. The translation still holds the older text.
    await commitFiles(
      { [englishPath]: localeFile([["moved", "`Rewritten English`"]]) },
      "rewrite english",
      "2026-02-01T00:00:00Z",
    );

    git(["clone", "-q", "--depth=1", `file://${sourceRepo}`, shallowRepo], workspace);
  }, REPO_TIMEOUT_MS);

  afterAll(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it("finds the drift when the history is present", async () => {
    const report = await findDriftedTranslations("ja", sourceRepo);

    expect(report.scannedLocales).toEqual(["ja"]);
    expect(report.entries.map((entry) => entry.key)).toEqual(["general.moved"]);
    expect(report.entries[0]?.enAtBaseline).toBe("Original English");
    expect(report.entries[0]?.en).toBe("Rewritten English");
  });

  it("reports the clone as shallow through the real git source", () => {
    const source = createGitDriftSource(shallowRepo);

    expect(source.isShallow()).toBe(true);
  });

  it(
    "refuses a depth-1 clone instead of reporting it clean",
    async () => {
      // The failure this guards against is a false clean report, so asserting only the throw would
      // miss a regression that returns an empty report instead.
      const drift = findDriftedTranslations("ja", shallowRepo);
      await expect(drift).rejects.toBeInstanceOf(DriftHistoryError);
      await expect(drift).rejects.toThrow(/shallow/);
    },
    REPO_TIMEOUT_MS,
  );

  it(
    "exits 2 with the fetch instruction from the command line",
    async () => {
      const entry = join(import.meta.dir, "../../scripts/devtools/findStaleTranslations.ts");
      const result = Bun.spawnSync(["bun", "run", entry, "--locale=ja", "--reason=drifted"], {
        cwd: shallowRepo,
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = `${result.stdout.toString()}${result.stderr.toString()}`;

      expect(result.exitCode).toBe(2);
      expect(output).toContain("git fetch --unshallow");
      // The documented contract: no report at all, rather than a clean one.
      expect(output).not.toContain("None. Every translated key matches");
    },
    REPO_TIMEOUT_MS,
  );

  it(
    "reports findings from the command line when history is complete",
    async () => {
      const entry = join(import.meta.dir, "../../scripts/devtools/findStaleTranslations.ts");
      const result = Bun.spawnSync(["bun", "run", entry, "--locale=ja", "--reason=drifted"], {
        cwd: sourceRepo,
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = `${result.stdout.toString()}${result.stderr.toString()}`;

      expect(result.exitCode).toBe(0);
      expect(output).toContain("1 keys whose English source moved");
    },
    REPO_TIMEOUT_MS,
  );

  it(
    "ignores uncommitted translation edits, which default blame would follow",
    async () => {
      const japanesePath = join(sourceRepo, "src/locales/ja/general.ts");
      const committed = await Bun.file(japanesePath).text();

      // An uncommitted edit that adds a line ahead of the key. Blame without a revision follows the
      // working tree, so the key's line number moves and its provenance shifts, while every value the
      // report prints still comes from HEAD. The report has to describe one revision, not two.
      await writeFile(
        japanesePath,
        localeFile([
          ["extra", "`コミットされていない`"],
          ["moved", "`元の日本語`"],
        ]),
      );

      const dirtyReport = await findDriftedTranslations("ja", sourceRepo);
      await writeFile(japanesePath, committed);
      const cleanReport = await findDriftedTranslations("ja", sourceRepo);

      expect(dirtyReport.entries).toEqual(cleanReport.entries);
    },
    REPO_TIMEOUT_MS,
  );
});
