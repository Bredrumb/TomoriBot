import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "bun";
import { config } from "dotenv";
import { AUDIT_IGNORED_ADVISORIES } from "./lib/auditIgnores";
import { isVerboseOutput } from "./lib/gateOutput";

type ResultItem = {
  name: string;
  exitCode: number | null;
  fatal: boolean;
  skippedReason?: string;
  isWarning?: boolean;
  subItems?: string[];
  summary?: string;
  hint?: string;
  _category?: "unit-test" | "regression-test";
};

// Quiet mode hides only passing output because failing checks must always print full detail under both modes.
let verboseOutput = false;

type Command = { argv: string[]; acceptsDetailFlag: boolean };

// Explicitly returns --no-verbose so it overrides inherited verbosity, and applies only to first-party checks because
// third-party CLIs reject unknown flags.
function detailFlag(): string {
  return verboseOutput ? "--verbose" : "--no-verbose";
}

// Using the double-dash separator delivers the detail flag because Bun parses bare flags inconsistently across
// platforms.
function resolveArgv({ argv, acceptsDetailFlag }: Command): string[] {
  return acceptsDetailFlag ? [...argv, "--", detailFlag()] : argv;
}

async function runCheck(
  name: string,
  argv: string[],
  fatal: boolean = true,
  acceptsDetailFlag: boolean = false,
): Promise<ResultItem> {
  console.log(`> Running ${name}...`);
  const proc = spawn(resolveArgv({ argv, acceptsDetailFlag }), { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  if (exitCode !== 0 || verboseOutput) {
    console.log(stdout + stderr);
  }
  return { name, exitCode, fatal };
}

interface WarningCheckOptions {
  outputHasWarnings?: (output: string) => boolean;
  summarizeWarnings?: (output: string) => string;
  summarizeFailure?: (output: string) => string | undefined;
  acceptsDetailFlag?: boolean;
  // Defaults to true so unfamiliar non-zero exits never hide failure output; only set false when exit 1 means a
  // count-only warning like knip.
  failureNeedsDetail?: boolean;
  blocksOnFailure?: boolean;
}

async function runWarningCheck(
  name: string,
  argv: string[],
  {
    outputHasWarnings = () => false,
    summarizeWarnings,
    summarizeFailure,
    acceptsDetailFlag = false,
    failureNeedsDetail = true,
    blocksOnFailure = false,
  }: WarningCheckOptions = {},
): Promise<ResultItem> {
  console.log(`> Running ${name}...`);
  const proc = spawn(resolveArgv({ argv, acceptsDetailFlag }), { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  const output = stdout + stderr;
  const isWarning = (exitCode !== 0 && !blocksOnFailure) || (exitCode === 0 && outputHasWarnings(output));
  const summary = isWarning ? summarizeWarnings?.(output) || undefined : undefined;
  const subItems = exitCode !== 0 ? summarizeFailure?.(output) : undefined;

  // Failures print full detail unless the caller sets failureNeedsDetail: false for pre-counted non-zero findings like
  // knip.
  const detailIsReported = (failureNeedsDetail && exitCode !== 0) || (isWarning && !summary && !subItems);
  if (detailIsReported || verboseOutput) {
    console.log(output);
  }

  return {
    name,
    exitCode,
    fatal: blocksOnFailure,
    isWarning,
    summary,
    subItems: subItems ? [subItems] : undefined,
  };
}

async function runLocalesCheck(name: string, command: string[]): Promise<ResultItem> {
  console.log(`> Running ${name}...`);
  const proc = spawn(resolveArgv({ argv: command, acceptsDetailFlag: true }), { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  const output = stdout + stderr;

  // Exit code 2 denotes advisory parity gaps and 0 denotes a clean pass, so both stay quiet unless --verbose is set.
  const isFatal = exitCode !== 0 && exitCode !== 2;
  if (isFatal || verboseOutput) {
    console.log(output);
  }

  const advisoryCount = output.match(/(\d+) keys missing in some locale/)?.[1];
  return {
    name,
    exitCode,
    fatal: isFatal,
    summary:
      advisoryCount && !verboseOutput
        ? `(${advisoryCount} keys missing in some locale, re-run with --verbose to list)`
        : undefined,
  };
}

const WORD_DISPLAY_OVERRIDES: Record<string, string> = {
  ai: "AI",
  api: "API",
  byok: "BYOK",
  db: "DB",
  dtm: "DTM",
  id: "ID",
  ids: "IDs",
  json: "JSON",
  junit: "JUnit",
  llm: "LLM",
  mcp: "MCP",
  nai: "NAI",
  nsfw: "NSFW",
  rag: "RAG",
  sql: "SQL",
  stt: "STT",
  ttl: "TTL",
  tts: "TTS",
  ui: "UI",
  url: "URL",
  xml: "XML",
  google: "Google",
  novelai: "NovelAI",
  openrouter: "OpenRouter",
  searxng: "SearXNG",
};

function decodeXmlAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function normalizeTestPath(file: string): string {
  return file.replace(/\\/g, "/");
}

function classifyTestFile(file: string): "unit-test" | "regression-test" {
  const normalized = normalizeTestPath(file);
  return normalized.includes("/regression/") || normalized.startsWith("tests/regression/")
    ? "regression-test"
    : "unit-test";
}

function testCategoryRank(category: ResultItem["_category"]): number {
  return category === "regression-test" ? 1 : 0;
}

function testHintForFile(file: string): string {
  return `Run \`bun test ${normalizeTestPath(file)}\``;
}

function fileNameFromPath(file: string): string {
  return normalizeTestPath(file).split("/").pop() ?? file;
}

function stripTestSuffix(fileName: string): string {
  return fileName.replace(/\.test\.ts$/, "").replace(/\.regression$/, "");
}

function humanizeDisplayName(value: string): string {
  const spaced = value
    .replace(/[—–]/g, "-")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return spaced
    .split(" ")
    .map((word) => {
      const lower = word.toLowerCase();
      if (WORD_DISPLAY_OVERRIDES[lower]) return WORD_DISPLAY_OVERRIDES[lower];
      if (word === "&") return word;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function displayNameFromSuiteName(suiteName: string): string {
  return humanizeDisplayName(suiteName.replace(/\s*[—–-]\s*regression\s*$/i, "").replace(/\s+regression\s*$/i, ""));
}

function displayNameFromTestFile(file: string, topLevelDescribeNames: string[] = []): string {
  const uniqueDescribeNames = [...new Set(topLevelDescribeNames.filter(Boolean))];
  if (uniqueDescribeNames.length === 1) {
    return displayNameFromSuiteName(uniqueDescribeNames[0]);
  }

  return humanizeDisplayName(stripTestSuffix(fileNameFromPath(file)));
}

type JUnitSuite = {
  name: string;
  file: string;
  tests: number;
  failures: number;
  skipped: number;
  topLevelDescribeNames: string[];
};

function buildTestResultItem(suite: JUnitSuite): ResultItem {
  const passCount = Math.max(0, suite.tests - suite.failures - suite.skipped);
  return {
    name: displayNameFromTestFile(suite.file, suite.topLevelDescribeNames),
    exitCode: suite.failures > 0 ? 1 : 0,
    fatal: suite.failures > 0,
    summary: `(${passCount} pass, ${suite.skipped} skip, ${suite.failures} fail)`,
    hint: testHintForFile(suite.file),
    _category: classifyTestFile(suite.file),
  };
}

function sortTestItems(items: ResultItem[]): ResultItem[] {
  return items.sort((a, b) => {
    const categoryOrder = testCategoryRank(a._category) - testCategoryRank(b._category);
    if (categoryOrder !== 0) return categoryOrder;
    return a.name.localeCompare(b.name);
  });
}

export function parseJUnitSuites(xml: string): ResultItem[] | null {
  const fileSuites = new Map<string, Omit<JUnitSuite, "topLevelDescribeNames">>();
  const topLevelDescribeNames = new Map<string, string[]>();
  const stack: Array<{ name: string; file: string; isFileSuite: boolean }> = [];
  const attr = (tag: string, key: string): string =>
    decodeXmlAttr(tag.match(new RegExp(`${key}="([^"]*)"`))?.[1] ?? "");
  const countAttr = (tag: string, key: string): number => Number.parseInt(attr(tag, key) || "0", 10);

  for (const tag of xml.match(/<\/?testsuite\b[^>]*>/g) ?? []) {
    if (tag.startsWith("</")) {
      stack.pop();
      continue;
    }

    const name = attr(tag, "name");
    const file = normalizeTestPath(attr(tag, "file"));
    const parent = stack.at(-1);

    // Normalize both `name` and `file` for file-suite matching because Bun uses Windows backslashes, while storing raw
    // `name` for describe prose.
    const isFileSuite = Boolean(file) && normalizeTestPath(name) === file;

    if (isFileSuite) {
      fileSuites.set(file, {
        name,
        file,
        tests: countAttr(tag, "tests"),
        failures: countAttr(tag, "failures"),
        skipped: countAttr(tag, "skipped"),
      });
    } else if (file && name && parent?.file === file && parent.isFileSuite) {
      const names = topLevelDescribeNames.get(file) ?? [];
      names.push(name);
      topLevelDescribeNames.set(file, names);
    }

    if (!tag.endsWith("/>")) {
      stack.push({ name, file, isFileSuite });
    }
  }

  if (fileSuites.size === 0) return null;

  return sortTestItems(
    [...fileSuites.values()].map((suite) =>
      buildTestResultItem({
        ...suite,
        topLevelDescribeNames: topLevelDescribeNames.get(suite.file) ?? [],
      }),
    ),
  );
}

// Console parsing is a fallback for missing JUnit XML because Bun omits headers for quiet test files, so this path
// can under-report.
function parseConsoleOutput(output: string, exitCode: number): ResultItem[] {
  const testBlocks = output.split(/([a-zA-Z0-9_\\/\-.]+\.test\.ts):/);
  const items: ResultItem[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < testBlocks.length; i += 2) {
    const file = normalizeTestPath(testBlocks[i]);
    if (seen.has(file)) continue;
    seen.add(file);

    const blockContent = testBlocks[i + 1] ?? "";
    const passCount = (blockContent.match(/\(pass\)/g) ?? []).length;
    const skipCount = (blockContent.match(/\(skip\)/g) ?? []).length;
    const failCount = (blockContent.match(/\(fail\)/g) ?? []).length;

    items.push(
      buildTestResultItem({
        name: file,
        file,
        tests: passCount + skipCount + failCount,
        failures: failCount,
        skipped: skipCount,
        topLevelDescribeNames: [],
      }),
    );
  }

  if (items.length === 0) {
    items.push({
      name: "Tests (bun run test)",
      exitCode: exitCode !== 0 ? 1 : 0,
      fatal: exitCode !== 0,
      summary: exitCode !== 0 ? "(no test output — possible compilation error)" : "(0 pass, 0 skip, 0 fail)",
      hint: "Run `bun run test` directly to see the full runner output.",
      _category: "unit-test",
    });
  }

  return sortTestItems(items);
}

// Failure output reprints the full runner buffer because lanes print whole blocks and targeted re-runs surface noisy
// DB and cache logger chatter.
async function runTests(): Promise<ResultItem[]> {
  console.log(`> Running Tests (bun run test)...`);

  // runTests.ts forwards these reporter flags to `bun test` when this env var is set.
  const junitOutfile = join(tmpdir(), `tomori-vl-junit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.xml`);
  const proc = spawn(["bun", "run", "test"], {
    stdout: "pipe",
    stderr: "pipe",
    // Suppress the runner's lane replay via TOMORI_TEST_QUIET in quiet mode because per-file rows replace it below.
    env: {
      ...process.env,
      BUN_TEST_JUNIT_OUTFILE: junitOutfile,
      ...(verboseOutput ? {} : { TOMORI_TEST_QUIET: "true" }),
    },
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;

  const output = stdout + stderr;

  // Prefer the JUnit XML because it lists every file regardless of console logging.
  let items: ResultItem[] | null = null;
  try {
    const xml = await Bun.file(junitOutfile).text();
    items = parseJUnitSuites(xml);
  } catch {
  } finally {
    await rm(junitOutfile, { force: true }).catch(() => undefined);
  }

  const resolved = items ?? parseConsoleOutput(output, exitCode);

  // Treat a non-zero runner exit with zero failed items (e.g. crash or OOM) as fatal so it never reads as green.
  const unaccountedFailure = exitCode !== 0 && resolved.every((item) => item.exitCode === 0);
  if (unaccountedFailure) {
    resolved.push({
      name: "Test Runner (bun run test)",
      exitCode: 1,
      fatal: true,
      summary: `(runner exited ${exitCode} with no failing file reported)`,
      hint: "Run `bun run test` directly — a file likely crashed before reporting results.",
      _category: "unit-test",
    });
  }

  // Print full runner output on any failure or crash because batch deaths may yield no per-file items.
  if (verboseOutput || unaccountedFailure || exitCode !== 0) {
    console.log(output);
  }

  return resolved;
}

async function runLint(): Promise<ResultItem> {
  console.log(`> Running Linting (bun run lint)...`);
  const proc = spawn(["bun", "run", "lint"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;

  const output = stdout + stderr;
  if (exitCode !== 0 || verboseOutput) {
    console.log(output);
  }

  const warningsMatch = output.match(/Found (\d+) warning/i);
  const fixedMatch = output.match(/Fixed (\d+) file/i);

  let isWarning = false;
  let summary = "";

  if (exitCode === 0 && (warningsMatch || fixedMatch)) {
    // Auto-fixes alone stay green; only actual warnings turn yellow.
    isWarning = Boolean(warningsMatch);
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

// Whole bun audit package blocks are kept rather than matching severity lines because a severity needs its indented
// dependency path for context.
function selectBlockingAuditBlocks(output: string): string {
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of output.split("\n")) {
    if (line.length > 0 && !/^\s/.test(line) && current.length > 0) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current);

  return blocks
    .filter((block, index) => {
      // The final block is the vulnerability tally and the fix hints, never a package.
      if (index === blocks.length - 1) return true;
      return block.some((line) => /\b(?:high|critical):/i.test(line));
    })
    .map((block) => block.join("\n"))
    .join("\n");
}

async function runAudit(): Promise<ResultItem> {
  console.log(`> Running Dependency Audit (bun audit)...`);

  // Wrap `bun audit` in cmd.exe on Windows to avoid pipe hangs (workspace filters are unsupported, so docs devDeps
  // also audit).
  const ignoreFlags = AUDIT_IGNORED_ADVISORIES.map((id) => `--ignore=${id}`);
  let command = ["bun", "audit", ...ignoreFlags];
  if (process.platform === "win32") {
    command = ["cmd.exe", "/d", "/s", "/c", ["bun", "audit", ...ignoreFlags].join(" ")];
  }

  // Bound bun audit with a timeout because it is the only check hitting a remote registry that can stall forever.
  const timeoutMs = Number.parseInt(process.env.TOMORI_VL_AUDIT_TIMEOUT_MS || "60000", 10);

  const proc = spawn(command, { stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    // Killing the cmd.exe wrapper on Windows lets vl unblock immediately even if the child exits asynchronously.
    proc.kill();
  }, timeoutMs);

  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  clearTimeout(timer);

  const output = stdout + stderr;
  // A timed-out audit proves nothing either way, so report it as a warning rather
  // than a pass or a failure, so the advisory state is simply unknown this run.
  if (timedOut) {
    // Killed mid-flight, so whatever it managed to print is the only evidence of how
    // far it got, and it is small because the timeout bounds it.
    console.log(output);
    return {
      name: "Dependency Audit (bun audit)",
      exitCode: 1,
      fatal: false,
      isWarning: true,
      summary: `(timed out after ${timeoutMs}ms — registry unreachable?)`,
      hint: "The advisory registry did not respond. Re-run when back online, or raise TOMORI_VL_AUDIT_TIMEOUT_MS.",
    };
  }

  let hasHighOrCritical = false;
  if (/(\d+)\s+critical/i.test(output) && !output.match(/0\s+critical/i)) hasHighOrCritical = true;
  if (/(\d+)\s+high/i.test(output) && !output.match(/0\s+high/i)) hasHighOrCritical = true;

  // Require the vulnerability tally line before trusting completion because transport or format failures lack it.
  const parsedTally = /\d+\s+vulnerabilit/i.test(output);

  // Print only high/critical blocks in quiet mode so transitive advisories do not flood output, while keeping full
  // output when unparsed.
  if (verboseOutput || !parsedTally) {
    console.log(output);
  } else if (hasHighOrCritical) {
    console.log(selectBlockingAuditBlocks(output));
  }

  return {
    name: "Dependency Audit (bun audit)",
    exitCode: hasHighOrCritical ? 1 : exitCode !== 0 ? 1 : 0,
    // Audit issues are never contributor-caused; warn locally, block only in the deploy pipeline
    fatal: false,
    isWarning: hasHighOrCritical || exitCode !== 0,
    // Emit the clean summary only on completed exit-0 runs because other outcomes printed above or lack a tally.
    summary: parsedTally && exitCode === 0 ? "(no high or critical advisories)" : undefined,
  };
}

// Checked lazily inside main() rather than at module scope because tests import parseJUnitSuites and module-level
// .env loading would leak real credentials.
function isDbConfigured(): boolean {
  return !!(process.env.POSTGRES_PASSWORD || process.env.DATABASE_URL || process.env.POSTGRES_URL);
}

// Named-check filters must gate on this guard because test names use arbitrary describe prose that can match check
// substrings and double-count.
const isNamedCheck = (r: ResultItem): boolean => r._category === undefined;

const CATEGORIES = {
  // Architectural guards (persona-workflow, text-preview) are omitted here because tests/unit/checks/ runs them in the
  // test lane without rescanning the repo.
  CODE: (r: ResultItem) =>
    isNamedCheck(r) &&
    (r.name.includes("Type Check") ||
      r.name.includes("Linting") ||
      r.name.includes("Runtime Imports") ||
      r.name.includes("SQL Audit") ||
      r.name.includes("Knip")),
  CONTENT: (r: ResultItem) => isNamedCheck(r) && (r.name.includes("Media Size") || r.name.includes("Seed Catalog")),
  SECURITY: (r: ResultItem) => isNamedCheck(r) && r.name.includes("Dependency Audit"),
  UNIT_TESTS: (r: ResultItem) => r._category === "unit-test",
  REGRESSION_TESTS: (r: ResultItem) => r._category === "regression-test",
  DB: (r: ResultItem) =>
    isNamedCheck(r) &&
    (r.name.includes("Schema Drift") || r.name.includes("Lifecycle") || r.name.includes("Migration Files")),
  LOCALES: (r: ResultItem) =>
    isNamedCheck(r) && (r.name.includes("Localization") || r.name.includes("Config Breadcrumbs")),
  DOCUMENTATION: (r: ResultItem) =>
    isNamedCheck(r) &&
    (r.name.includes("Command Reference") ||
      r.name.includes("Command Mentions") ||
      r.name.includes("Command Roots") ||
      r.name.includes("Comment Audit")),
};

async function main() {
  // Load .env here rather than at module scope so importing this file is side-effect free.
  config({ quiet: true });
  verboseOutput = isVerboseOutput();
  const dbConfigured = isDbConfigured();

  console.log(
    verboseOutput
      ? "Running Validation Checks (verbose: every check prints its full output)...\n"
      : "Running Validation Checks... (quiet is the default; pass --verbose for full detail, --no-verbose to force quiet)\n",
  );

  const [
    typeCheckResult,
    lintResult,
    runtimeImportsResult,
    knipResult,
    commentAuditResult,
    auditResult,
    sqlAuditResult,
    mediaSizeResult,
    modelCatalogResult,
    migrationFilesResult,
    testResultItems,
    schemaDriftResult,
    dbLifecycleResult,
    localesResult,
    localeLengthsResult,
    configBreadcrumbsResult,
  ] = await Promise.all([
    runCheck("Type Check (bun run check)", ["bun", "run", "check"], true),
    runLint(),
    runCheck("Runtime Imports (bun run check-runtime-imports)", ["bun", "run", "check-runtime-imports"], true, true),
    runWarningCheck("Knip (bun run knip)", ["bun", "run", "knip"], {
      // Knip exits 1 on unused exports, so vl grades it as a warning and summarizes its counts instead of failing.
      outputHasWarnings: (output) => /\(\d+\)$/.test(output),
      summarizeWarnings: (output) => {
        const counts = [...output.matchAll(/^(\S[^\n]*?) \((\d+)\)$/gm)].map(([, label, count]) => {
          return `${count} ${label.toLowerCase()}`;
        });
        return counts.length > 0 ? `(${counts.join(", ")})` : "";
      },
      failureNeedsDetail: false,
    }),

    runWarningCheck("Comment Audit (bun run audit-comments)", ["bun", "run", "audit-comments"], {
      outputHasWarnings: (output) => /^WARN /m.test(output),
      // Summarized only on exit 0 because failing audits print errors via summarizeFailure instead.
      summarizeWarnings: (output) => {
        const warningCount = output.match(/^WARN /gm)?.length ?? 0;
        return warningCount > 0 ? `(${warningCount} warning${warningCount === 1 ? "" : "s"})` : "";
      },
      // Read from the check's own verdict line rather than re-counting severities here,
      // so the two counts cannot drift apart.
      summarizeFailure: (output) => output.match(/\d+ error\(s\), \d+ warning\(s\), \d+ file\(s\) checked/)?.[0],
      // A failing audit is entirely file-and-line findings, so the listing is the report.
      failureNeedsDetail: true,
      blocksOnFailure: true,
      // Omit detail flags because audit-comments enables its own listing and --no-verbose would mute counted WARN lines.
    }),
    runAudit(),

    runCheck("SQL Audit (bun run audit-sql)", ["bun", "run", "audit-sql"], true, true),
    runCheck("Media Size (bun run check-media-size)", ["bun", "run", "check-media-size"], true, true),
    runCheck("Seed Catalog (bun run check-seed-catalogs)", ["bun", "run", "check-seed-catalogs"], true, true),
    // Filesystem-only (no DB): verifies rollback pairing + numbering uniqueness,
    // so it runs unconditionally regardless of local DB configuration.
    runCheck("Migration Files (bun run check-migrations)", ["bun", "run", "check-migrations"], true, true),
    runTests(),
    dbConfigured
      ? runCheck("Schema Drift Check (bun run check-schema)", ["bun", "run", "check-schema"], true, true)
      : Promise.resolve<ResultItem>({
          name: "Schema Drift Check",
          exitCode: null,
          fatal: true,
          skippedReason: "No local DB configured",
        }),
    dbConfigured
      ? runCheck("DB Lifecycle Validation (bun run db:lifecycle)", ["bun", "run", "db:lifecycle"], true, true)
      : Promise.resolve<ResultItem>({
          name: "DB Lifecycle Validation",
          exitCode: null,
          fatal: true,
          skippedReason: "No local DB configured",
        }),
    runLocalesCheck("Localization Keys (bun run check-locales)", ["bun", "run", "check-locales"]),
    // Untruncated overlong strings reject Discord payloads and block, while pre-truncated strings only warn.
    runWarningCheck(
      "Localization Discord Limits (bun run check-locale-lengths)",
      ["bun", "run", "check-locale-lengths"],
      {
        acceptsDetailFlag: true,
        blocksOnFailure: true,
        outputHasWarnings: (output) => /Truncation advisory: \d+/.test(output),
        summarizeWarnings: (output) => {
          const count = output.match(/Truncation advisory: (\d+)/)?.[1];
          return count ? `(${count} locale strings truncated, re-run with --verbose to list)` : "";
        },
      },
    ),
    runCheck(
      "Config Breadcrumbs (bun run check-config-breadcrumbs)",
      ["bun", "run", "check-config-breadcrumbs"],
      true,
      true,
    ),
  ]);

  // Run sequentially outside Promise.all so Windows/Bun never loads multiple complete command graphs concurrently.
  const commandReferenceResult = await runCheck(
    "Command Reference Freshness (bun run check-command-reference)",
    ["bun", "run", "check-command-reference"],
    true,
    true,
  );

  // Also loads the complete command graph, so it stays serialized alongside the check above.
  const commandMentionsResult = await runCheck(
    "Command Mentions (bun run check-command-mentions)",
    ["bun", "run", "check-command-mentions"],
    true,
    true,
  );

  // Also loads the complete command graph, so it stays serialized alongside the checks above.
  const commandRootsResult = await runCheck(
    "Command Roots Documentation (bun run check-command-roots)",
    ["bun", "run", "check-command-roots"],
    true,
    true,
  );

  const results: ResultItem[] = [
    typeCheckResult,
    lintResult,
    runtimeImportsResult,
    knipResult,
    commentAuditResult,
    auditResult,
    sqlAuditResult,
    mediaSizeResult,
    modelCatalogResult,
    migrationFilesResult,
    ...testResultItems,
    schemaDriftResult,
    dbLifecycleResult,
    localesResult,
    localeLengthsResult,
    configBreadcrumbsResult,
    commandReferenceResult,
    commandMentionsResult,
    commandRootsResult,
  ];

  console.log("\n====================================");
  console.log("VALIDATION RESULTS");
  console.log("====================================\n");

  const allFatalPassed = results.every(
    (r) => r.skippedReason !== undefined || r.exitCode === 0 || r.isWarning || !r.fatal,
  );

  const HINTS: Record<string, string> = {
    "Type Check": "Run `bun run check` locally to see TypeScript errors.",
    "Linting (bun run lint)": "Review the warning or commit the auto-fixed files.",
    "Runtime Imports":
      "Run `bun install --frozen-lockfile`, then `bun run check-runtime-imports`. Confirm bun.lock resolves gaxios to uuid@9.",
    Knip: "Run `bun run knip`. Before removing an export, check its callers with `git grep <symbol> release -- src tests`; if release uses it, keep the export and add a JSDoc @public tag naming its release caller.",
    "Comment Audit":
      "Run `bun run audit-comments` and review each finding against docs/en/contributing/policies/comments.md before editing.",
    "Command Mentions":
      "A locale string names a slash path that is not registered. Update the prose to the new path, or add a documented entry to scripts/checks/command-mention-exceptions.json.",
    "Dependency Audit":
      "Update the parent dependency or run `bun update <package-name>` specifically. Only use a global override when the replacement stays within every dependent package's declared version range.",
    "SQL Audit":
      "Ensure all raw SQL queries are inside the 'src/utils/db/repositories/' folder or exempt them in the script.",
    "Seed Catalog":
      "Run `bun run check-seed-catalogs` to see which invariant broke. Seed catalogs live in `src/db/seed/catalog/` — the same validations run at bot startup, so a failure here would also fail a real boot.",
    "Media Size":
      "Run `bun run compress-media` to fix this automatically (lossless re-encode, downscaling oversized art to fit). Default Persona avatars/sprites ship to Discord, so keep them under 1 MB. The budget is the DEFAULT_LIMIT_BYTES constant in scripts/lib/media.ts; raise it there only when art that genuinely must ship at full size cannot fit.",
    "Schema Drift Check":
      "Ensure `schema.sql` and your Zod types in `src/types/db/schema.ts` are in sync. See the check output for the specific mismatch (column missing from schema.sql, export coverage gap, or INSERT column count mismatch).",
    "Migration Files":
      "Every `NNN_*.sql` up-migration needs a paired `NNN_*.down.sql`, and no two may share an `NNN` prefix. If another PR already merged your number, rename yours to the next free number.",
    "DB Lifecycle Validation": "Check the detailed logs above. Your migration might be invalid or nuke-db failed.",
    "Localization Keys":
      "Missing keys (red/blocking) mean a source file references a key that exists in no locale; this must be fixed. Missing local equivalents (orange/advisory) are safe to push — run `bun run prune-locales` to clean up orphaned keys, or add the missing `ja` entries.",
    "Localization Discord Limits":
      "A failure is a traced locale string over its Discord cap with no truncation, which rejects the whole payload: shorten it or wrap the call in `safeSelectOptionText`. A warning is a traced string the code already truncates, so it ships clipped; shorten it in the listed locale. Dynamic keys and separately declared builder arguments can be missed, so zero warnings does not prove every label fits.",
    "Command Reference":
      "Run `bun run generate-command-reference` and commit the regenerated docs/*/features/command-reference.md files.",
    "Command Roots":
      "Update the documented top-level categories in docs/en/architecture/subsystems/command-system.md to match runtime registration.",
    "Config Breadcrumbs":
      "Update breadcrumb calls in helpCatalog.ts to match CONFIG_PAGES_BY_CATEGORY and config labels.",
  };

  const getHint = (name: string) => {
    const key = Object.keys(HINTS).find((k) => name.includes(k));
    return key ? `\n      Hint: ${HINTS[key]}` : "";
  };

  const printItem = (r: ResultItem) => {
    const summary = r.summary ? ` ${r.summary}` : "";
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

  const printSection = (title: string, items: ResultItem[], emptyMessage?: string) => {
    console.log(title);
    if (items.length === 0 && emptyMessage) {
      console.log(`  [⚪] ${emptyMessage}`);
      return;
    }
    for (const item of items) printItem(item);
  };

  // Quiet mode omits green test rows to avoid burying failures, and states the green count explicitly so a quiet
  // section cannot look skipped.
  const printTestSection = (title: string, items: ResultItem[], emptyMessage: string) => {
    if (verboseOutput) {
      printSection(title, items, emptyMessage);
      return;
    }

    console.log(title);
    if (items.length === 0) {
      console.log(`  [⚪] ${emptyMessage}`);
      return;
    }

    const passing = items.filter((r) => r.exitCode === 0 && !r.isWarning && r.skippedReason === undefined);
    for (const item of items) {
      if (!passing.includes(item)) printItem(item);
    }
    if (passing.length > 0) {
      console.log(`  [🟢] ${passing.length} test files passed (pass --verbose to list them)`);
    }
  };

  printSection(
    "Code Quality",
    results.filter((r) => CATEGORIES.CODE(r)),
  );

  printSection(
    "\nContent Guards",
    results.filter((r) => CATEGORIES.CONTENT(r)),
  );

  printSection(
    "\nProject Security",
    results.filter((r) => CATEGORIES.SECURITY(r)),
  );

  printTestSection(
    "\nUnit Tests (bun run test)",
    results.filter((r) => CATEGORIES.UNIT_TESTS(r)),
    "No unit test files reported by runner",
  );

  printTestSection(
    "\nRegression Tests (bun run test)",
    results.filter((r) => CATEGORIES.REGRESSION_TESTS(r)),
    "No regression test files reported by runner",
  );

  printSection(
    "\nDatabase Validation",
    results.filter((r) => CATEGORIES.DB(r)),
  );

  printSection(
    "\nLocalization",
    results.filter((r) => CATEGORIES.LOCALES(r)),
  );

  printSection(
    "\nDocumentation",
    results.filter((r) => CATEGORIES.DOCUMENTATION(r)),
  );

  // Print uncategorized checks so any newly added gate still surfaces in output when failing.
  const categorized = new Set(Object.values(CATEGORIES).flatMap((matches) => results.filter((r) => matches(r))));
  const uncategorized = results.filter((r) => !categorized.has(r));
  if (uncategorized.length > 0) {
    printSection("\nOther Checks (uncategorized — add these to CATEGORIES in vl.ts)", uncategorized);
  }

  console.log("\n====================================");

  // Emit a machine-readable `vl-status:` trailer last so harnesses and log tail readers get an unambiguous verdict.
  const grade = (r: ResultItem): "skip" | "pass" | "warn" | "fail" => {
    if (r.skippedReason !== undefined) return "skip";
    if (r.isWarning) return "warn";
    if (r.exitCode === 0) return "pass";
    return r.fatal ? "fail" : "warn";
  };
  const tally = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const r of results) tally[grade(r)]++;

  const exitCode = allFatalPassed ? 0 : 1;
  console.log(
    `\nvl-status: ${exitCode === 0 ? "PASS" : "FAIL"} exit=${exitCode}` +
      ` pass=${tally.pass} warn=${tally.warn} fail=${tally.fail} skip=${tally.skip}\n`,
  );

  if (allFatalPassed) {
    console.log("✅ All required checks passed.\n");
    process.exit(0);
  } else {
    console.log("❌ Some required checks failed. Please fix the errors above before opening a PR.\n");
    process.exit(1);
  }
}

// Guarded so `parseJUnitSuites` can be imported by its unit test without
// running the entire validation suite as a side effect of the import.
if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
