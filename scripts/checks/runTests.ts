import type { SQL } from "bun";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "dotenv";
import { createScriptSqlClient } from "./lib/scriptSqlClient";
import { usesModuleMocks } from "./lib/testIsolation";

// Timeout is passed via CLI flag because Bun's 5s default flakes under lane starvation and only the CLI flag covers
// hooks.
function getTestTimeoutMs(): string {
  return process.env.TOMORI_TEST_TIMEOUT_MS ?? "30000";
}

// Windows CreateProcessW limits a command line to 32,767 characters, so capping file arguments leaves headroom for bun and reporter flags.
export const MAX_TEST_BATCH_ARG_CHARS = 16_000;

const DATABASE_ENV_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
  "TEST_DB_READY",
] as const;

const runId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const tempDbName = `tomoribot_${runId}`;

interface ConnectionParams {
  host: string;
  port: string;
  user: string;
  password: string;
  maintenanceDb: string;
}

function getConnectionParams(): ConnectionParams | null {
  const explicitUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  const maintenanceDb = process.env.POSTGRES_MAINTENANCE_DB ?? "postgres";

  if (explicitUrl) {
    try {
      const url = new URL(explicitUrl);
      if (!url.password) return null;
      return {
        host: url.hostname || "localhost",
        port: url.port || "5432",
        user: decodeURIComponent(url.username || "postgres"),
        password: decodeURIComponent(url.password),
        maintenanceDb,
      };
    } catch {
      return null;
    }
  }

  const password = process.env.POSTGRES_PASSWORD;
  if (!password) return null;

  return {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: process.env.POSTGRES_PORT ?? "5432",
    user: process.env.POSTGRES_USER ?? "postgres",
    password,
    maintenanceDb,
  };
}

function buildUrl(params: ConnectionParams, database: string): string {
  const url = new URL("postgresql://localhost");
  url.hostname = params.host;
  url.port = params.port;
  url.username = encodeURIComponent(params.user);
  url.password = encodeURIComponent(params.password);
  url.pathname = `/${database}`;
  return url.toString();
}

// Non-local hosts are rejected by default so tests never create or drop databases on a remote or production server.
function isLocalHost(params: ConnectionParams): boolean {
  if (process.env.TOMORI_TESTS_ALLOW_NONLOCAL_DB === "true") return true;
  const allowed = new Set(["localhost", "127.0.0.1", "::1", "postgres", "tomoribot-db", "host.docker.internal"]);
  return allowed.has(params.host.toLowerCase());
}

async function discoverTestFiles(): Promise<string[]> {
  const glob = new Bun.Glob("**/*.test.ts");
  const files: string[] = [];
  for await (const rel of glob.scan({ cwd: "tests" })) {
    // Normalize Windows separators so the path is a valid `bun test` argument.
    files.push(`tests/${rel.replaceAll("\\", "/")}`);
  }
  // Sort for stable, reproducible run order across platforms.
  return files.sort();
}

// The vl JUnit parser scans for <testsuite> tags across the whole string, so plain concatenation works without a
// single XML root element.
async function mergeJUnitFiles(sources: string[], dest: string): Promise<void> {
  const parts: string[] = [];
  for (const src of sources) {
    const text = await Bun.file(src)
      .text()
      .catch(() => "");
    if (text.trim()) parts.push(text);
    await rm(src, { force: true }).catch(() => undefined);
  }
  await Bun.write(dest, parts.join("\n"));
}

interface Batch {
  files: string[];
}

interface Lane {
  id: string;
  batches: Batch[];
}

// Tracked at module scope so signal handlers can terminate every concurrent lane before dropping the disposable
// database.
const liveProcesses = new Set<ReturnType<typeof Bun.spawn>>();

async function killLiveTestProcesses(): Promise<void> {
  const running = [...liveProcesses];
  for (const proc of running) proc.kill();
  await Promise.all(running.map((proc) => proc.exited.catch(() => undefined)));
  liveProcesses.clear();
}

async function fileUsesModuleMocks(file: string): Promise<boolean> {
  const source = await Bun.file(file)
    .text()
    .catch(() => "");
  return usesModuleMocks(source);
}

export function buildFileBatches(files: readonly string[], maxArgChars = MAX_TEST_BATCH_ARG_CHARS): Batch[] {
  const batches: Batch[] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const file of files) {
    // Reserve 3 chars per path so worst-case quoting and separating spaces fit under the budget.
    const argCost = file.length + 3;
    if (current.length > 0 && currentChars + argCost > maxArgChars) {
      batches.push({ files: current });
      current = [];
      currentChars = 0;
    }
    current.push(file);
    currentChars += argCost;
  }

  if (current.length > 0) {
    batches.push({ files: current });
  }

  return batches;
}

// Mock files each get one process because Bun leaks mock.module(), and DB suites stay sequential in input order
// because they share fixed-id fixtures.
export async function planLanes(files: string[]): Promise<Lane[]> {
  const mockFlags = await Promise.all(files.map(fileUsesModuleMocks));

  const shared: Record<"unit" | "db", string[]> = { unit: [], db: [] };
  const isolated: Record<"unit" | "db", string[]> = { unit: [], db: [] };

  for (const [index, file] of files.entries()) {
    const group = file.includes("/regression/") ? "db" : "unit";
    (mockFlags[index] ? isolated : shared)[group].push(file);
  }

  const lanes: Lane[] = [];

  // Lane order doubles as the deterministic order buffered output is replayed in.
  if (shared.unit.length > 0) lanes.push({ id: "unit", batches: buildFileBatches(shared.unit) });
  if (isolated.unit.length > 0) {
    lanes.push({ id: "unit-isolated", batches: isolated.unit.map((file) => ({ files: [file] })) });
  }

  // Shared batches first, then any mock-using regression file on its own: all
  // sequential within the single DB lane.
  const dbBatches: Batch[] = [...buildFileBatches(shared.db), ...isolated.db.map((file) => ({ files: [file] }))];
  if (dbBatches.length > 0) lanes.push({ id: "db", batches: dbBatches });

  return lanes;
}

interface LaneResult {
  lane: Lane;
  exitCode: number;
  output: string;
  junitOutfiles: string[];
}

// Lane output is buffered instead of inherited because concurrent lanes would interleave it, so the caller replays
// buffers in lane order.
async function runLane(
  lane: Lane,
  extraEnv: Record<string, string>,
  requestedOutfile?: string,
  omitDatabaseEnv = false,
): Promise<LaneResult> {
  const junitOutfiles: string[] = [];
  const chunks: string[] = [];
  let exitCode = 0;

  for (const [index, batch] of lane.batches.entries()) {
    const reporterArgs: string[] = [];
    if (requestedOutfile) {
      const batchOutfile = join(tmpdir(), `tomori-junit-${runId}-${lane.id}-${index}.xml`);
      reporterArgs.push("--reporter=junit", `--reporter-outfile=${batchOutfile}`);
      junitOutfiles.push(batchOutfile);
    }

    // Spawn the batch and track it so signal-driven cleanup can terminate it.
    const streamOutput = process.env.TOMORI_TEST_STREAM_OUTPUT === "true";
    const childEnv = { ...process.env, ...extraEnv };
    if (omitDatabaseEnv) {
      for (const key of DATABASE_ENV_KEYS) delete childEnv[key];
      // Unit processes have no database credentials, so telemetry must not arm background writes.
      childEnv.STAT_TRACKING_ENABLED = "false";
    }

    // The wrapper owns environment loading and database selection. Prevent a child from loading a
    // more specific local env file and silently undoing the disposable-database or skip decision.
    const proc = Bun.spawn(
      ["bun", "--no-env-file", "test", "--timeout", getTestTimeoutMs(), ...batch.files, ...reporterArgs],
      {
        env: childEnv,
        stdout: streamOutput ? "inherit" : "pipe",
        stderr: streamOutput ? "inherit" : "pipe",
      },
    );
    liveProcesses.add(proc);

    const [stdout, stderr] = streamOutput
      ? ["", ""]
      : await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = (await proc.exited) ?? 1;
    liveProcesses.delete(proc);

    if (process.env.TOMORI_TEST_QUIET !== "true" || code !== 0) {
      chunks.push(stdout + stderr);
    }

    // Remember the first failure but keep going so every batch reports.
    if (code !== 0 && exitCode === 0) exitCode = code;
  }

  return { lane, exitCode, output: chunks.join(""), junitOutfiles };
}

async function runTestFiles(
  files: string[],
  extraEnv: Record<string, string> = {},
  omitDatabaseEnv = false,
): Promise<number> {
  const requestedOutfile = process.env.BUN_TEST_JUNIT_OUTFILE;
  const lanes = await planLanes(files);

  const results = await Promise.all(
    lanes.map((lane) => runLane(lane, extraEnv, requestedOutfile, omitDatabaseEnv || lane.id !== "db")),
  );

  // Replay buffered output in fixed lane order so concurrent runs stay readable.
  // TOMORI_TEST_QUIET is set by `vl` in quiet mode to mute passing lanes while keeping failing ones.
  for (const result of results) {
    if (process.env.TOMORI_TEST_QUIET === "true" && result.exitCode === 0) continue;
    const fileCount = result.lane.batches.reduce((total, batch) => total + batch.files.length, 0);
    process.stdout.write(`\n──── lane: ${result.lane.id} (${fileCount} files) ────\n`);
    process.stdout.write(result.output);
  }

  const allOutfiles = results.flatMap((result) => result.junitOutfiles);
  if (requestedOutfile && allOutfiles.length > 0) {
    await mergeJUnitFiles(allOutfiles, requestedOutfile);
  }

  return results.find((result) => result.exitCode !== 0)?.exitCode ?? 0;
}

async function main(): Promise<void> {
  // Suites assume the self-hosted branch, and a workstation `.env` may be production-shaped to exercise
  // hosted-only flows by hand. Pinning here instead of refusing keeps `bun run test` working as typed;
  // `isLocalHost` is what keeps a production database out of reach, not this.
  process.env.RUN_ENV = "development";
  delete process.env.TEST_PRODUCTION;

  const requestedFiles = process.argv
    .slice(2)
    .filter((argument) => !argument.startsWith("--"))
    .map((file) => file.replaceAll("\\", "/"));
  const testFiles = requestedFiles.length > 0 ? requestedFiles : await discoverTestFiles();
  if (requestedFiles.length > 0) process.env.TOMORI_TEST_STREAM_OUTPUT = "true";
  if (testFiles.length === 0) {
    console.error("[test-runner] No test files found under tests/.");
    process.exit(1);
  }
  if (testFiles.some((file) => !file.startsWith("tests/") || !file.endsWith(".test.ts"))) {
    console.error("[test-runner] Focused test paths must be .test.ts files under tests/.");
    process.exit(1);
  }

  const params = getConnectionParams();

  if (!params) {
    console.log("[test-runner] No Postgres credentials found. DB regression tests will be skipped.");
    process.exit(await runTestFiles(testFiles, {}, true));
  }

  // Non-local host detected, so fall back to skip mode to avoid touching remote DBs.
  if (!isLocalHost(params)) {
    console.warn(
      `[test-runner] Postgres host "${params.host}" is not local. Skipping DB provisioning.\n` +
        "Set TOMORI_TESTS_ALLOW_NONLOCAL_DB=true to override.",
    );
    process.exit(await runTestFiles(testFiles, {}, true));
  }

  const adminUrl = buildUrl(params, params.maintenanceDb);
  const testDbUrl = buildUrl(params, tempDbName);

  let adminSql: SQL | null = null;

  async function cleanup(): Promise<void> {
    // Lanes run concurrently, so several processes may be alive at once.
    await killLiveTestProcesses();
    if (adminSql) {
      // Terminate any remaining connections so DROP DATABASE can proceed.
      await adminSql`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = ${tempDbName}
          AND pid <> pg_backend_pid()
      `.catch(() => undefined);
      await adminSql`DROP DATABASE IF EXISTS ${adminSql(tempDbName)} WITH (FORCE)`.catch(() => undefined);
      await adminSql.close({ timeout: 1 }).catch(() => undefined);
      adminSql = null;
    }
  }

  // Register signal handlers so Ctrl+C and process termination still drop the DB.
  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", async () => {
    await cleanup();
    process.exit(143);
  });

  try {
    adminSql = createScriptSqlClient(adminUrl);
    await adminSql`SELECT 1`;
  } catch {
    console.log("[test-runner] Could not reach Postgres. DB regression tests will be skipped.");
    await adminSql?.close({ timeout: 1 }).catch(() => undefined);
    adminSql = null;
    process.exit(await runTestFiles(testFiles, {}, true));
  }

  let exitCode = 1;

  try {
    console.log(`[test-runner] Provisioning test database: ${tempDbName}`);
    await adminSql`DROP DATABASE IF EXISTS ${adminSql(tempDbName)} WITH (FORCE)`;
    await adminSql`CREATE DATABASE ${adminSql(tempDbName)}`;

    // Inject the test DB coordinates into the child environment.
    //    TEST_DB_READY=1 tells testDb.ts to enable the DB regression suites.
    const testEnv: Record<string, string> = {
      POSTGRES_HOST: params.host,
      POSTGRES_PORT: params.port,
      POSTGRES_USER: params.user,
      POSTGRES_PASSWORD: params.password,
      POSTGRES_DB: tempDbName,
      DATABASE_URL: testDbUrl,
      TEST_DB_READY: "1",
    };

    // Run the lanes; every spawned process registers itself in liveProcesses so
    // signal-driven cleanup can terminate them all and still drop the DB.
    exitCode = await runTestFiles(testFiles, testEnv);
  } finally {
    console.log(`[test-runner] Dropping test database: ${tempDbName}`);
    await cleanup();
  }

  process.exit(exitCode);
}

// Guarded so unit tests can import batching helpers without running the suite or loading .env.
if (import.meta.main) {
  config({ quiet: true });
  main().catch(async (err) => {
    console.error("[test-runner] Fatal:", err);
    process.exit(1);
  });
}
