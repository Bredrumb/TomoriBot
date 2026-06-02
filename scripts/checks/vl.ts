import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "bun";
import { config } from "dotenv";

config({ quiet: true });

/** Shape of every item pushed into the results array */
type ResultItem = {
  name: string;
  exitCode: number | null;
  fatal: boolean;
  skippedReason?: string;
  isWarning?: boolean;
  subItems?: string[];
  summary?: string;
  /** Inline hint shown on failure — takes precedence over the global HINTS lookup */
  hint?: string;
  /** Used by CATEGORIES to identify test-file items without string matching */
  _category?: string;
};

async function runCheck(name: string, command: string[], fatal: boolean = true): Promise<ResultItem> {
  console.log(`> Running ${name}...`);
  const proc = spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.log(stdout + stderr);
  }
  return { name, exitCode, fatal };
}

/** Maps test file basename → display name and isolation hint */
const TEST_FILE_META: Record<string, { displayName: string; hint: string }> = {
  "chat.regression.test.ts": {
    displayName: "Reply Decision & Channel Queue",
    hint: "Run `bun test tests/regression/chat/` and check `tests/regression/chat/fixtures/`",
  },
  "cache-invalidation.regression.test.ts": {
    displayName: "Cache Invalidation",
    hint: "Run `bun test tests/regression/db/cache-invalidation.regression.test.ts`",
  },
  "config.regression.test.ts": {
    displayName: "Config Repository",
    hint: "Run `bun test tests/regression/db/config.regression.test.ts`",
  },
  "llm.regression.test.ts": {
    displayName: "LLM Repository",
    hint: "Run `bun test tests/regression/db/llm.regression.test.ts`",
  },
  "memory.regression.test.ts": {
    displayName: "Memory Repository",
    hint: "Run `bun test tests/regression/db/memory.regression.test.ts`",
  },
  "persona.regression.test.ts": {
    displayName: "Persona Repository",
    hint: "Run `bun test tests/regression/db/persona.regression.test.ts`",
  },
  "repositories.regression.test.ts": {
    displayName: "Repository Delegation & Cache",
    hint: "Run `bun test tests/regression/db/repositories.regression.test.ts`",
  },
  "server.regression.test.ts": {
    displayName: "Server Repository",
    hint: "Run `bun test tests/regression/db/server.regression.test.ts`",
  },
  "tool-rag.regression.test.ts": {
    displayName: "Tool & RAG Repository",
    hint: "Run `bun test tests/regression/db/tool-rag.regression.test.ts`",
  },
  "user.regression.test.ts": {
    displayName: "User Repository",
    hint: "Run `bun test tests/regression/db/user.regression.test.ts`",
  },
  "configCommandMappings.test.ts": {
    displayName: "Config Command Mapping Contracts",
    hint: "Run `bun test tests/unit/commands/configCommandMappings.test.ts`",
  },
  "chunkProcessor.test.ts": {
    displayName: "Sentence Chunk Splitter",
    hint: "Run `bun test tests/unit/processors/chunkProcessor.test.ts`",
  },
  "llmOutputProcessor.test.ts": {
    displayName: "LLM Output Processor",
    hint: "Run `bun test tests/unit/processors/llmOutputProcessor.test.ts`",
  },
  "mentionProcessor.test.ts": {
    displayName: "Mention & Template Sanitizer",
    hint: "Run `bun test tests/unit/processors/mentionProcessor.test.ts`",
  },
  "generationTurnFallback.test.ts": {
    displayName: "Generation Turn Fallback",
    hint: "Run `bun test tests/unit/processors/generationTurnFallback.test.ts`",
  },
  "preset-import.regression.test.ts": {
    displayName: "Preset Import",
    hint: "Run `bun test tests/regression/db/preset-import.regression.test.ts`",
  },
  "personaQueue.test.ts": {
    displayName: "Persona Queue",
    hint: "Run `bun test tests/unit/chat/personaQueue.test.ts`",
  },
  "presetAttributePublicFlags.test.ts": {
    displayName: "Preset Attribute Public Flags",
    hint: "Run `bun test tests/unit/preset/presetAttributePublicFlags.test.ts`",
  },
  "reasoningContentSpillGuard.test.ts": {
    displayName: "Reasoning Content Spill Guard",
    hint: "Run `bun test tests/unit/providers/reasoningContentSpillGuard.test.ts`",
  },
  "thinkBlockContentStripper.test.ts": {
    displayName: "Think Block Content Stripper",
    hint: "Run `bun test tests/unit/providers/thinkBlockContentStripper.test.ts`",
  },
  "bufferManager.test.ts": {
    displayName: "Stream Buffer Manager",
    hint: "Run `bun test tests/unit/stream/bufferManager.test.ts`",
  },
  "deliberateToolMode.test.ts": {
    displayName: "Deliberate Tool Mode",
    hint: "Run `bun test tests/unit/tools/deliberateToolMode.test.ts`",
  },
  "fetchUrlUrlSafety.test.ts": {
    displayName: "Fetch URL Safety",
    hint: "Run `bun test tests/unit/tools/fetchUrlUrlSafety.test.ts`",
  },
  "channelPrompt.test.ts": {
    displayName: "Channel Prompt Context Assembly",
    hint: "Run `bun test tests/unit/context/channelPrompt.test.ts`",
  },
  "channelPromptCacheStore.test.ts": {
    displayName: "Channel Prompt Cache Store",
    hint: "Run `bun test tests/unit/cache/channelPromptCacheStore.test.ts`",
  },
  "generatedImageMessage.test.ts": {
    displayName: "Generated Image Message",
    hint: "Run `bun test tests/unit/discord/generatedImageMessage.test.ts`",
  },
  "customImageEndpointSupport.test.ts": {
    displayName: "Custom Image Endpoint Support",
    hint: "Run `bun test tests/unit/provider/customImageEndpointSupport.test.ts`",
  },
  "providerInfoRegistry.test.ts": {
    displayName: "Provider Info Registry",
    hint: "Run `bun test tests/unit/providers/providerInfoRegistry.test.ts`",
  },
  "toolAssembly.test.ts": {
    displayName: "Tool Assembly",
    hint: "Run `bun test tests/unit/tools/toolAssembly.test.ts`",
  },
};

/** One decoded `<testsuite>` element from bun's JUnit reporter output. */
type JUnitSuite = { name: string; file: string; tests: number; failures: number; skipped: number };

/**
 * Parses bun's JUnit XML into one ResultItem per test FILE.
 *
 * Bun emits a file-level `<testsuite>` (where `name` equals the `file` path)
 * plus a nested suite per `describe` block (same `file`, `name` = describe text).
 * We keep only the file-level suites so each file contributes exactly one row,
 * then map its basename through `TEST_FILE_META` for a friendly display name.
 * Returns `null` when the XML has no usable suites so the caller can fall back.
 */
function parseJUnitSuites(xml: string): ResultItem[] | null {
  const suites: JUnitSuite[] = [];
  const attr = (tag: string, key: string): string => tag.match(new RegExp(`${key}="([^"]*)"`))?.[1] ?? "";

  for (const tag of xml.match(/<testsuite\b[^>]*>/g) ?? []) {
    const name = attr(tag, "name");
    const file = attr(tag, "file");
    // File-level aggregate only — name === file. Skip nested describe suites.
    if (!file || name !== file) continue;
    suites.push({
      name,
      file,
      tests: Number.parseInt(attr(tag, "tests") || "0", 10),
      failures: Number.parseInt(attr(tag, "failures") || "0", 10),
      skipped: Number.parseInt(attr(tag, "skipped") || "0", 10),
    });
  }

  if (suites.length === 0) return null;

  return suites
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((suite) => {
      const fileName = suite.file.split(/\\|\//).pop() ?? suite.file;
      const passCount = Math.max(0, suite.tests - suite.failures - suite.skipped);
      const meta = TEST_FILE_META[fileName];
      return {
        name: meta?.displayName ?? fileName,
        exitCode: suite.failures > 0 ? 1 : 0,
        fatal: suite.failures > 0,
        summary: `(${passCount} pass, ${suite.skipped} skip, ${suite.failures} fail)`,
        hint: meta?.hint,
        _category: "test",
      } satisfies ResultItem;
    });
}

/**
 * Legacy fallback: parse `bun test`'s piped console output into per-file items.
 * Used only when the JUnit XML is unavailable (older bun, reporter failure).
 * Note: bun omits per-file headers for files that log nothing, so this path can
 * under-report — the JUnit path above is preferred.
 */
function parseConsoleOutput(output: string, exitCode: number): ResultItem[] {
  const testBlocks = output.split(/([a-zA-Z0-9_\\/\-.]+\.test\.ts):/);
  const items: ResultItem[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < testBlocks.length; i += 2) {
    const fileName = testBlocks[i].split(/\\|\//).pop() ?? testBlocks[i];
    if (seen.has(fileName)) continue;
    seen.add(fileName);

    const blockContent = testBlocks[i + 1] ?? "";
    const passCount = (blockContent.match(/\(pass\)/g) ?? []).length;
    const skipCount = (blockContent.match(/\(skip\)/g) ?? []).length;
    const failCount = (blockContent.match(/\(fail\)/g) ?? []).length;
    const fileFailed = failCount > 0;
    const meta = TEST_FILE_META[fileName];

    items.push({
      name: meta?.displayName ?? fileName,
      exitCode: fileFailed ? 1 : 0,
      fatal: fileFailed,
      summary: `(${passCount} pass, ${skipCount} skip, ${failCount} fail)`,
      hint: meta?.hint,
      _category: "test",
    });
  }

  if (items.length === 0) {
    items.push({
      name: "Tests (bun run test)",
      exitCode: exitCode !== 0 ? 1 : 0,
      fatal: exitCode !== 0,
      summary: exitCode !== 0 ? "(no test output — possible compilation error)" : "(0 pass, 0 skip, 0 fail)",
      hint: "Run `bun run test` directly to see the full runner output.",
      _category: "test",
    });
  }

  return items;
}

/**
 * Runs all tests and returns one ResultItem per test file. Prefers bun's JUnit
 * reporter (reliable per-file enumeration) and falls back to console parsing.
 * On any failure the full bun test output is printed before returning.
 */
async function runTests(): Promise<ResultItem[]> {
  console.log(`> Running Tests (bun run test)...`);

  // runTests.ts forwards these reporter flags to `bun test` when this env var is set.
  const junitOutfile = join(tmpdir(), `tomori-vl-junit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.xml`);
  const proc = spawn(["bun", "run", "test"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, BUN_TEST_JUNIT_OUTFILE: junitOutfile },
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;

  const output = stdout + stderr;

  // Print full output only on failure so vl stays concise on green runs
  if (exitCode !== 0) {
    console.log(output);
  }

  // 1. Prefer the JUnit XML — it lists every file regardless of console logging.
  let items: ResultItem[] | null = null;
  try {
    const xml = await Bun.file(junitOutfile).text();
    items = parseJUnitSuites(xml);
  } catch {
    // JUnit file missing/unreadable — fall back below.
  } finally {
    await rm(junitOutfile, { force: true }).catch(() => undefined);
  }

  // 2. Fall back to console parsing if JUnit was unavailable.
  return items ?? parseConsoleOutput(output, exitCode);
}

async function runLint(): Promise<ResultItem> {
  console.log(`> Running Linting (bun run lint)...`);
  const proc = spawn(["bun", "run", "lint"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;

  const output = stdout + stderr;
  console.log(output);

  const warningsMatch = output.match(/Found (\d+) warning/i);
  const fixedMatch = output.match(/Fixed (\d+) file/i);

  let isWarning = false;
  let summary = "";

  if (exitCode === 0 && (warningsMatch || fixedMatch)) {
    isWarning = Boolean(warningsMatch); // auto-fixes alone stay green; only actual warnings turn yellow
    const parts = [];
    if (fixedMatch) parts.push(`fixed ${fixedMatch[1]}`);
    if (warningsMatch) parts.push(`${warningsMatch[1]} warning`);
    summary = `(${parts.join(", ")})`;
  }

  return {
    name: "Linting (bun run lint)",
    exitCode,
    fatal: exitCode !== 0,
    isWarning,
    summary,
  };
}

async function runAudit(): Promise<ResultItem> {
  console.log(`> Running Dependency Audit (bun audit)...`);

  // --filter . scopes audit to the root bot package only, excluding workspace
  // packages (e.g. apps/docs Astro build deps) from blocking the pipeline.
  // We use cmd.exe on Windows for bun audit to prevent pipe hangs, just in case.
  let command = ["bun", "audit", "--filter", "."];
  if (process.platform === "win32") {
    command = ["cmd.exe", "/d", "/s", "/c", "bun audit --filter ."];
  }

  const proc = spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;

  const output = stdout + stderr;
  console.log(output);

  let hasHighOrCritical = false;
  if (/(\d+)\s+critical/i.test(output) && !output.match(/0\s+critical/i)) hasHighOrCritical = true;
  if (/(\d+)\s+high/i.test(output) && !output.match(/0\s+high/i)) hasHighOrCritical = true;

  return {
    name: "Dependency Audit (bun audit)",
    exitCode: hasHighOrCritical ? 1 : exitCode !== 0 ? 1 : 0,
    // Audit issues are never contributor-caused — warn locally, block only in the deploy pipeline
    fatal: false,
    isWarning: hasHighOrCritical || exitCode !== 0,
  };
}

const dbConfigured = !!(process.env.POSTGRES_PASSWORD || process.env.DATABASE_URL || process.env.POSTGRES_URL);

const CATEGORIES = {
  CODE: (r: ResultItem) =>
    r.name.includes("Type Check") ||
    r.name.includes("Linting") ||
    r.name.includes("Dependency Audit") ||
    r.name.includes("SQL Audit"),
  TESTS: (r: ResultItem) => r._category === "test",
  DB: (r: ResultItem) => r.name.includes("Schema Drift") || r.name.includes("Lifecycle"),
  LOCALES: (r: ResultItem) => r.name.includes("Localization"),
};

async function main() {
  console.log("Running Validation Checks in parallel...\n");

  // All checks are independent — run them concurrently and collect results
  const [
    typeCheckResult,
    lintResult,
    auditResult,
    sqlAuditResult,
    testResultItems,
    schemaDriftResult,
    dbLifecycleResult,
    localesResult,
    localeLengthsResult,
  ] = await Promise.all([
    runCheck("Type Check (bun run check)", ["bun", "run", "check"], true),
    runLint(),
    runAudit(),
    runCheck("SQL Audit (bun run audit-sql)", ["bun", "run", "audit-sql"], true),
    runTests(),
    dbConfigured
      ? runCheck("Schema Drift Check (bun run check-schema)", ["bun", "run", "check-schema"], true)
      : Promise.resolve<ResultItem>({ name: "Schema Drift Check", exitCode: null, fatal: true, skippedReason: "No local DB configured" }),
    dbConfigured
      ? runCheck("DB Lifecycle Validation (bun run db:lifecycle)", ["bun", "run", "db:lifecycle"], true)
      : Promise.resolve<ResultItem>({ name: "DB Lifecycle Validation", exitCode: null, fatal: true, skippedReason: "No local DB configured" }),
    runCheck("Localization Keys (bun run check-locales)", ["bun", "run", "check-locales"], false),
    // Discord length limits are a hard blocker: modal placeholders/descriptions and command
    // descriptions get silently truncated by Discord beyond their max length, so any
    // violation here must block the PR gate (fatal: true) — unlike the broader locale
    // parity check above, which tolerates missing Japanese translations.
    runCheck(
      "Localization Discord Limits (bun run check-locale-lengths)",
      ["bun", "run", "check-locale-lengths"],
      true,
    ),
  ]);

  const results: ResultItem[] = [
    typeCheckResult,
    lintResult,
    auditResult,
    sqlAuditResult,
    ...testResultItems,
    schemaDriftResult,
    dbLifecycleResult,
    localesResult,
    localeLengthsResult,
  ];

  console.log("\n====================================");
  console.log("📋 VALIDATION CHECKLIST RESULTS");
  console.log("====================================\n");

  // Compute before printing — avoids relying on printItem side-effects and handles
  // any item that might not match a category filter
  const allFatalPassed = results.every(
    (r) => r.skippedReason !== undefined || r.exitCode === 0 || r.isWarning || !r.fatal,
  );

  const HINTS: Record<string, string> = {
    "Type Check": "Run `bun run check` locally to see TypeScript errors.",
    "Linting (bun run lint)": "Review the warning or commit the auto-fixed files.",
    "Dependency Audit":
      "Find the vulnerable package in the audit log and pin a safe version in the `overrides` field of package.json, or run `bun update <package-name>` to update it specifically.",
    "SQL Audit":
      "Ensure all raw SQL queries are inside the 'src/utils/db/repositories/' folder or exempt them in the script.",
    "Schema Drift Check": "Ensure `schema.sql` and your Zod types in `src/types/db/schema.ts` are in sync. See the check output for the specific mismatch (column missing from schema.sql, export coverage gap, or INSERT column count mismatch).",
    "DB Lifecycle Validation": "Check the detailed logs above. Your migration might be invalid or nuke-db failed.",
    "Localization Keys":
      "Missing Japanese equivalents are fine to push — run `bun run prune-locales` to clean up orphaned keys, or add the missing `ja` entries to get a clean run.",
    "Localization Discord Limits":
      "Discord truncates modal placeholders (>100 chars), modal titles (>45), and command descriptions (>100). Shorten the listed locale strings — both `en-US` and `ja` sides must fit.",
  };

  const getHint = (name: string) => {
    const key = Object.keys(HINTS).find((k) => name.includes(k));
    return key ? `\n      Hint: ${HINTS[key]}` : "";
  };

  const printItem = (r: ResultItem) => {
    const summary = r.summary ? ` ${r.summary}` : "";
    // Prefer per-item hint (test files); fall back to global HINTS lookup for named checks
    const hintText = r.hint ? `\n      💡 Hint: ${r.hint}` : getHint(r.name);

    if (r.skippedReason) {
      console.log(`  [⚪] ${r.name} (Skipped: ${r.skippedReason})`);
    } else if (r.exitCode === 0 && !r.isWarning) {
      console.log(`  [🟢] ${r.name}${summary}`);
    } else if (r.isWarning) {
      console.log(`  [🟡] ${r.name} (Warning)${summary}${hintText}`);
    } else if (!r.fatal && r.exitCode !== 0) {
      console.log(`  [🟠] ${r.name} (Safe to push — fix when possible)${summary}${hintText}`);
    } else {
      console.log(`  [🔴] ${r.name} (Failed)${summary}${hintText}`);
    }

    if (r.subItems && r.subItems.length > 0) {
      for (const item of r.subItems) {
        console.log(`      ↳ ${item}`);
      }
    }
  };

  console.log("Code Quality");
  for (const r of results.filter((r) => CATEGORIES.CODE(r))) printItem(r);

  console.log("\nUnit Tests (bun run test)");
  for (const r of results.filter((r) => CATEGORIES.TESTS(r))) printItem(r);

  console.log("\nDatabase Validation");
  for (const r of results.filter((r) => CATEGORIES.DB(r))) printItem(r);

  console.log("\nLocalization");
  for (const r of results.filter((r) => CATEGORIES.LOCALES(r))) printItem(r);

  console.log("\n====================================");
  if (allFatalPassed) {
    console.log("\n✅ All required checks passed. You are ready to open a PR.");
    process.exit(0);
  } else {
    console.log("\n❌ Some required checks failed. Please fix the errors above before opening a PR.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
