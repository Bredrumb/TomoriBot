import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyCommentSweepLedger } from "../../../scripts/devtools/commentSweepApply";
import { compareTypeScriptSources } from "../../../scripts/devtools/commentSweepGate";
import { scanCommentSweepCandidates, type CommentSweepCandidate } from "../../../scripts/devtools/commentSweepScan";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("comment sweep gate", () => {
  it("accepts comment-only changes", () => {
    const before = "// Explain value\nconst value: number = 1;\n";
    const after = "// Better rationale\nconst value: number = 1;\n";

    expect(compareTypeScriptSources(before, after)).toEqual({ status: "equal" });
  });

  it("rejects statement changes with a minimal excerpt", () => {
    const before = "const value: number = 1;\n";
    const after = "const value: number = 2;\n";
    const result = compareTypeScriptSources(before, after);

    expect(result.status).toBe("different");
    if (result.status === "different") {
      expect(result.difference.beforeExcerpt).toContain("value = 1");
      expect(result.difference.afterExcerpt).toContain("value = 2");
    }
  });

  it("treats parse failures as failures", () => {
    const result = compareTypeScriptSources("const value = 1;\n", "const value = ;\n");

    expect(result.status).toBe("parse-error");
  });
});

describe("comment sweep scanner", () => {
  it("extracts deterministic, judgment, JSDoc, and dash candidates", async () => {
    const root = await createTemporaryRoot();
    const source = [
      "// 1. Read the value",
      "const value = 1;",
      "// Rule 20: Keep constants at the top",
      "// const oldValue = 0;",
      "/* single line */",
      "/**",
      " * 2. Format the value",
      " * @param input - Input value",
      " * Keep this rationale — callers depend on it.",
      " */",
      "export function format(input: number): string {",
      "  return String(input);",
      "}",
      "",
    ].join("\n");
    await Bun.write(join(root, "fixture.ts"), source);

    const candidates = await scanCommentSweepCandidates({
      paths: ["fixture.ts"],
      repoRoot: root,
    });

    expect(findOperation(candidates, "strip-numbering")).toHaveLength(2);
    expect(findOperation(candidates, "strip-rule")).toHaveLength(1);
    expect(findOperation(candidates, "delete-commented-code")).toHaveLength(1);
    expect(findOperation(candidates, "normalize-block")).toHaveLength(1);
    expect(candidates.some((row) => row.tier === "2")).toBeTrue();
    expect(candidates.some((row) => row.tier === "2b")).toBeTrue();
    expect(candidates.some((row) => row.tier === "2c")).toBeTrue();
    expect(candidates.some((row) => row.manual_review === "jsdoc-numbering-in-tagged-block")).toBeTrue();
  });

  it("protects suppressions and their adjacent explanation", async () => {
    const root = await createTemporaryRoot();
    await Bun.write(
      join(root, "fixture.ts"),
      ["// The fixture needs an intentionally broad type.", "// @ts-expect-error", "const value: any = 1;", ""].join(
        "\n",
      ),
    );

    const candidates = await scanCommentSweepCandidates({
      paths: ["fixture.ts"],
      repoRoot: root,
      tiers: ["2"],
    });

    expect(candidates).toHaveLength(0);
  });

  it("treats prose citing an instruction file as rationale, not scaffolding", async () => {
    const root = await createTemporaryRoot();
    await Bun.write(
      join(root, "fixture.ts"),
      ["// 7. Invalidate cache AFTER successful write (mandatory per CLAUDE.md rule 5)", "invalidate();", ""].join(
        "\n",
      ),
    );

    const candidates = await scanCommentSweepCandidates({
      paths: ["fixture.ts"],
      repoRoot: root,
      tiers: ["1"],
    });

    expect(findOperation(candidates, "strip-rule")).toHaveLength(0);
    expect(findOperation(candidates, "strip-numbering")).toHaveLength(1);
  });

  it("permits numbering strips on locale-example comments but nothing else", async () => {
    const root = await createTemporaryRoot();
    const path = join(root, "scripts", "checks", "checkLocalizationKeys.ts");
    await Bun.write(
      path,
      ["// 1. Top-level description: commands.{category}.description", "const pattern = 1;", ""].join("\n"),
    );

    const candidates = await scanCommentSweepCandidates({
      paths: ["scripts/checks/checkLocalizationKeys.ts"],
      repoRoot: root,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].operation).toBe("strip-numbering");
  });
});

describe("comment sweep apply", () => {
  it("applies Tier 1 rows bottom-up and preserves transpiled code", async () => {
    const root = await createTemporaryRoot();
    const sourcePath = join(root, "fixture.ts");
    await Bun.write(
      sourcePath,
      [
        "// 1. Read the value",
        "const value = 1;",
        "// Rule 20: Keep constants at the top",
        "// const oldValue = 0;",
        "/* single line */",
        "",
      ].join("\n"),
    );
    const candidates = await scanCommentSweepCandidates({
      paths: ["fixture.ts"],
      repoRoot: root,
      tiers: ["1"],
    });
    const ledgerPath = join(root, "ledger.jsonl");
    await writeLedger(ledgerPath, candidates);

    const result = await applyCommentSweepLedger({
      ledgerPath,
      minConfidence: 0,
      repoRoot: root,
      tier: "1",
    });
    const updated = await Bun.file(sourcePath).text();

    expect(result.gateFailures).toBe(0);
    expect(result.appliedEdits).toBe(candidates.length);
    expect(updated).toContain("// Read the value");
    expect(updated).toContain("// single line");
    expect(updated).not.toContain("Rule 20");
    expect(updated).not.toContain("oldValue");
    expect(
      compareTypeScriptSources(
        [
          "// 1. Read the value",
          "const value = 1;",
          "// Rule 20: Keep constants at the top",
          "// const oldValue = 0;",
          "/* single line */",
          "",
        ].join("\n"),
        updated,
      ),
    ).toEqual({ status: "equal" });
  });

  it("strips rule scaffolding without discarding the surrounding prose", async () => {
    const root = await createTemporaryRoot();
    const sourcePath = join(root, "fixture.ts");
    await Bun.write(
      sourcePath,
      [
        "// Rule 14",
        "import { readFile } from 'node:fs/promises';",
        "// 1. Ensure the command runs in a guild channel (Rule 17)",
        "const guarded = readFile;",
        "",
      ].join("\n"),
    );
    const candidates = await scanCommentSweepCandidates({
      paths: ["fixture.ts"],
      repoRoot: root,
      tiers: ["1"],
    });
    const ledgerPath = join(root, "ledger.jsonl");
    await writeLedger(ledgerPath, candidates);

    const result = await applyCommentSweepLedger({
      ledgerPath,
      minConfidence: 0,
      repoRoot: root,
      tier: "1",
    });
    const updated = await Bun.file(sourcePath).text();

    expect(result.gateFailures).toBe(0);
    expect(updated).not.toContain("Rule 14");
    expect(updated).not.toContain("Rule 17");
    expect(updated).toContain("// Ensure the command runs in a guild channel");
  });

  it("skips drifted rows", async () => {
    const root = await createTemporaryRoot();
    const sourcePath = join(root, "fixture.ts");
    await Bun.write(sourcePath, "// Redundant\nconst value = 1;\n");
    const [candidate] = await scanCommentSweepCandidates({
      paths: ["fixture.ts"],
      repoRoot: root,
      tiers: ["2"],
    });
    const ledgerPath = join(root, "ledger.jsonl");
    await writeLedger(ledgerPath, [{ ...candidate, confidence: 1, verdict: "delete" }]);
    await Bun.write(sourcePath, "// Redundant\nconst value = 2;\n");

    const result = await applyCommentSweepLedger({
      ledgerPath,
      minConfidence: 0.9,
      repoRoot: root,
    });

    expect(result.driftSkipped).toBe(1);
    expect(await Bun.file(sourcePath).text()).toContain("// Redundant");
  });

  it("leaves a file unchanged when the gate rejects a rewrite", async () => {
    const root = await createTemporaryRoot();
    const sourcePath = join(root, "fixture.ts");
    const original = "// Replace me — safely\nconst value = 1;\n";
    await Bun.write(sourcePath, original);
    const [candidate] = await scanCommentSweepCandidates({
      paths: ["fixture.ts"],
      repoRoot: root,
      tiers: ["2c"],
    });
    const ledgerPath = join(root, "ledger.jsonl");
    await writeLedger(ledgerPath, [
      {
        ...candidate,
        confidence: 1,
        rewrite: "const changed = true;",
        verdict: "rewrite",
      },
    ]);

    const result = await applyCommentSweepLedger({
      ledgerPath,
      minConfidence: 0.9,
      repoRoot: root,
    });

    expect(result.gateFailures).toBe(1);
    expect(await Bun.file(sourcePath).text()).toBe(original);
  });
});

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tomori-comment-sweep-"));
  temporaryRoots.push(root);
  return root;
}

function findOperation(
  candidates: CommentSweepCandidate[],
  operation: CommentSweepCandidate["operation"],
): CommentSweepCandidate[] {
  return candidates.filter((candidate) => candidate.operation === operation);
}

async function writeLedger(path: string, rows: object[]): Promise<void> {
  await Bun.write(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}
