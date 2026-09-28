import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type DocsStaleEntry,
  createGitDocsSource,
  findDocsTreeStaleness,
  findDocsUnfollowed,
  translatableText,
} from "../../../scripts/devtools/docsStaleness";

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
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(proc.stderr).trim()}`);
  }
  return new TextDecoder().decode(proc.stdout).trim();
}

/** A real repository, because baselines come from commit history rather than file contents. */
function createRepo(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "docs-staleness-"));
  temporaryRoots.push(root);
  git(root, "init", "-q", "-b", "main");
  const repo = {
    root,
    write(files: Record<string, string>) {
      for (const [path, contents] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), contents, "utf8");
      }
    },
    remove(path: string) {
      unlinkSync(join(root, path));
    },
    commit(message: string): string {
      git(root, "add", "-A");
      git(root, "commit", "-qm", message);
      return git(root, "rev-parse", "HEAD");
    },
  };
  repo.write(files);
  repo.commit("base");
  return repo;
}

function page(title: string, body: string, extraFrontmatter = ""): string {
  return `---\ntitle: "${title}"\n${extraFrontmatter}---\n\n${body}\n`;
}

function summarize(entries: DocsStaleEntry[]): string[] {
  return entries.map(
    (entry) => `${entry.reason} ${entry.locale} ${entry.page}${entry.change ? ` ${entry.change}` : ""}`,
  );
}

describe("docs translation staleness", () => {
  it("counts only reader-visible text, not sidebar order or review flags", () => {
    const before = page("Memory", "Body line", "sidebar:\n  order: 2\n");
    expect(translatableText(page("Memory", "Body line", "sidebar:\n  order: 5\naiGenerated: false\n"))).toBe(
      translatableText(before),
    );
    expect(translatableText(page("Memories", "Body line"))).not.toBe(translatableText(before));
  });

  it("reports drift, missing, and orphaned pages while skipping English-only and generated pages", () => {
    const repo = createRepo({
      "docs/en/guide.md": page("Guide", "Original body"),
      "docs/ja/guide.md": page("ガイド", "元の本文"),
      "docs/en/stable.md": page("Stable", "Unchanged"),
      "docs/ja/stable.md": page("安定", "変更なし"),
      "docs/en/new-page.md": page("New", "Not yet translated"),
      "docs/ja/removed.md": page("削除", "英語版がない"),
      "docs/ja/contributing/setup.md": page("貢献", "英語のみの節"),
      "docs/en/architecture/flow.md": page("Flow", "English only"),
      "docs/en/features/command-reference.md": page("Commands", "Generated"),
      "docs/ja/features/command-reference.md": page("コマンド", "生成"),
      "README.md": "# TomoriBot\n",
      ".github/README_ja.md": "# TomoriBot (ja)\n",
    });
    repo.write({
      "docs/en/guide.md": page("Guide", "Original body\n---\nsize 12\nA new paragraph"),
      "docs/en/stable.md": page("Stable", "Unchanged", "sidebar:\n  order: 3\n"),
      "docs/en/architecture/flow.md": page("Flow", "Rewritten English only"),
      "README.md": "# TomoriBot\n\nNew intro.\n",
    });
    repo.commit("English moves on");

    const entries = findDocsTreeStaleness(createGitDocsSource(repo.root), ["ja"]);

    expect(summarize(entries)).toEqual([
      "orphaned ja contributing/setup.md",
      "drifted ja guide.md",
      "missing ja new-page.md",
      "drifted ja README.md",
      "orphaned ja removed.md",
    ]);
    const guide = entries.find((entry) => entry.page === "guide.md");
    expect(guide?.changedLines).toBe(3);
    expect(guide?.baseline).toMatch(/^[0-9a-f]{7,}$/);
  });

  it("treats a translation touched after the English change as followed", () => {
    const repo = createRepo({
      "docs/en/guide.md": page("Guide", "One"),
      "docs/ja/guide.md": page("ガイド", "一"),
    });
    repo.write({ "docs/en/guide.md": page("Guide", "Two") });
    repo.commit("English change");
    repo.write({ "docs/ja/guide.md": page("ガイド", "二") });
    repo.commit("Japanese follow-up");

    expect(findDocsTreeStaleness(createGitDocsSource(repo.root), ["ja"])).toEqual([]);
  });

  it("reports branch changes the translations did not follow, per locale", () => {
    const repo = createRepo({
      "docs/en/changed.md": page("Changed", "Before"),
      "docs/ja/changed.md": page("変更", "前"),
      "docs/pt-BR/changed.md": page("Alterado", "Antes"),
      "docs/en/removed.md": page("Removed", "Gone soon"),
      "docs/ja/removed.md": page("削除", "まもなく"),
      "docs/en/order-only.md": page("Order", "Same"),
      "docs/ja/order-only.md": page("順序", "同じ"),
      "docs/en/contributing/guide.md": page("Contrib", "English only"),
    });
    const mergeBase = git(repo.root, "rev-parse", "HEAD");
    repo.write({
      "docs/en/changed.md": page("Changed", "After"),
      "docs/pt-BR/changed.md": page("Alterado", "Depois"),
      "docs/en/added.md": page("Added", "Brand new"),
      "docs/en/order-only.md": page("Order", "Same", "sidebar:\n  order: 9\n"),
      "docs/en/contributing/guide.md": page("Contrib", "Still English only"),
    });
    repo.remove("docs/en/removed.md");
    repo.commit("branch work");

    const entries = findDocsUnfollowed(createGitDocsSource(repo.root), mergeBase, ["ja", "pt-BR"]);

    expect(summarize(entries)).toEqual([
      "unfollowed ja added.md added",
      "unfollowed ja changed.md changed",
      "unfollowed ja removed.md removed",
      "unfollowed pt-BR added.md added",
    ]);
  });
});
