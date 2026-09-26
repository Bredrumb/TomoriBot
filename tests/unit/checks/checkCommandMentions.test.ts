import { describe, expect, it } from "bun:test";
import { findRuntimeMentions } from "../../../scripts/checks/checkCommandMentions";

describe("findRuntimeMentions", () => {
  it("finds a single-line getCommandMention in an ordinary file", () => {
    const source = `const path = getCommandMention("a", "b");\n`;
    const findings = findRuntimeMentions(source, "src/commands/test.ts");
    expect(findings).toEqual([{ file: "src/commands/test.ts", line: 1, mention: "a b" }]);
  });

  it("finds a multi-line getCommandMention call", () => {
    const source = `
const __probeMultiline = getCommandMention(
  "definitely",
  "not",
  "real",
);
`;
    const findings = findRuntimeMentions(source, "src/commands/test.ts");
    expect(findings).toEqual([{ file: "src/commands/test.ts", line: 2, mention: "definitely not real" }]);
  });

  it("finds a mention call in an allowlisted file", () => {
    const source = `const path = mention("a", "b");\n`;
    const findings = findRuntimeMentions(source, "src/utils/discord/helpCatalog.ts");
    expect(findings).toEqual([{ file: "src/utils/discord/helpCatalog.ts", line: 1, mention: "a b" }]);
  });

  it("does not find a mention call in a non-allowlisted file", () => {
    const source = `const path = mention("add");\n`;
    const findings = findRuntimeMentions(source, "src/utils/discord/ui/configPanel.ts");
    expect(findings).toEqual([]);
  });

  it("does not find a call with non-literal arguments", () => {
    const source = `const path = getCommandMention("personal", "openrouter-model", action);\n`;
    const findings = findRuntimeMentions(source, "src/commands/test.ts");
    expect(findings).toEqual([]);
  });

  it("does not find calls inside commandRegistry.ts", () => {
    const source = `const path = getCommandMention("a", "b");\n`;
    const findings = findRuntimeMentions(source, "src/utils/discord/commandRegistry.ts");
    expect(findings).toEqual([]);
  });
});

import {
  analyzeStaleBaseline,
  findMentions,
  formatStaleBaselineReport,
} from "../../../scripts/checks/checkCommandMentions";
import { join } from "node:path";
import { spawn } from "bun";
import { readFile, rm, writeFile } from "node:fs/promises";

describe("findMentions", () => {
  it("reports a code-span command mention with its file and line", () => {
    const source = `This is a test of \`/some old path\` in docs.\nAnd another \`/command\` here.`;
    const findings = findMentions(source, "docs/en/test.md");
    expect(findings).toEqual([
      { file: "docs/en/test.md", line: 1, mention: "some old path" },
      { file: "docs/en/test.md", line: 2, mention: "command" },
    ]);
  });
});

/**
 * The two ways a baseline entry stops being owed a fix are decided here rather than through the
 * CLI, because each CLI spawn loads the whole command graph. Both reasons share the one analysis and
 * report path, so the single spawn in {@link runWithBaseline} proves the wiring for both.
 */
describe("stale baseline analysis", () => {
  const finding = (mention: string) => ({ file: "src/locales/en-US/commands.ts", line: 1, mention });

  it("reports an entry whose path is now registered", () => {
    const entries = analyzeStaleBaseline([finding("setup"), finding("kill")], new Set(["setup"]), new Set(["setup"]));

    expect(entries).toEqual([{ path: "setup", reason: "now a registered command" }]);
  });

  it("reports an entry whose mention no longer occurs anywhere", () => {
    const entries = analyzeStaleBaseline([finding("kill")], new Set(["kill"]), new Set(["impersonate"]));

    expect(entries).toEqual([{ path: "impersonate", reason: "no longer occurs anywhere" }]);
  });

  it("leaves an entry alone while its mention is still unregistered", () => {
    expect(analyzeStaleBaseline([finding("natres")], new Set(["kill"]), new Set(["natres"]))).toEqual([]);
  });

  it("reports an entry once when both conditions hold", () => {
    const entries = analyzeStaleBaseline([], new Set(["setup"]), new Set(["setup"]));

    expect(entries).toEqual([{ path: "setup", reason: "now a registered command" }]);
  });

  it("renders each reported entry with its path and reason", () => {
    const report = formatStaleBaselineReport([
      { path: "impersonate", reason: "no longer occurs anywhere" },
      { path: "setup", reason: "now a registered command" },
    ]);

    expect(report).toContain("STALE BASELINE ENTRIES");
    expect(report).toContain("/impersonate   (no longer occurs anywhere)");
    expect(report).toContain("/setup   (now a registered command)");
    expect(formatStaleBaselineReport([])).toBe("");
  });
});

describe("check-command-mentions CLI", () => {
  const realBaseline = join(process.cwd(), "scripts", "checks", "docs-mention-baseline.json");

  /**
   * Points the check at a throwaway baseline. Editing the tracked file in place would race the
   * real check-command-mentions run, because vl executes its checks in parallel.
   */
  async function runWithBaseline(extraEntry: { path: string; reason: string }) {
    const tempBaseline = join(process.cwd(), "tests", "unit", "checks", `tmp-baseline-${Date.now()}.json`);
    const parsed = JSON.parse(await readFile(realBaseline, "utf8"));
    parsed.exceptions.push(extraEntry);
    await writeFile(tempBaseline, JSON.stringify(parsed, null, 2));

    try {
      const proc = spawn(["bun", "run", "check-command-mentions"], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, COMMAND_MENTION_BASELINE_PATH: tempBaseline },
      });
      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();
      return { exitCode, stderr };
    } finally {
      await rm(tempBaseline, { force: true });
    }
  }

  it("fails when a baselined entry no longer occurs anywhere", async () => {
    const { exitCode, stderr } = await runWithBaseline({ path: "fake non existent command", reason: "test" });

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("STALE BASELINE ENTRIES");
    expect(stderr).toContain("/fake non existent command");
    expect(stderr).toContain("no longer occurs anywhere");
    // Bun's 5s default is not enough: this spawns a subprocess that loads the entire command
    // graph, which alone takes ~6s uncontended and longer when vl runs its lanes in parallel.
  }, 60000);
});
