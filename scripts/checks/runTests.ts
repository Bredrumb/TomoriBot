/**
 * Test runner wrapper for the TomoriBot regression harness.
 *
 * Behavior:
 *  1. Detect whether a valid local Postgres connection is available.
 *  2. If yes:  create a disposable `tomoribot_test_<id>` database, inject
 *              TEST_DB_READY=1 + POSTGRES_DB=<name> into the child env, run the
 *              suites, then drop the database on any exit path (clean finish,
 *              uncaught error, SIGINT, or SIGTERM).
 *  3. If no:   run the suites without DB env vars so the DB regression tests
 *              skip gracefully instead of erroring.
 *
 * Each suite (unit, regression) runs in its OWN `bun test` process — see
 * {@link TEST_SUITES} for why that isolation is required.
 *
 * Invoke via `bun run test` (package.json) — not `bun test tests/` directly.
 */

import { SQL } from "bun";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "dotenv";

config({ quiet: true });

/** Unique suffix for the disposable database created per run. */
const runId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const tempDbName = `tomoribot_${runId}`;

/**
 * Resolved Postgres connection details extracted from whichever env-var
 * combination the contributor has set.
 */
interface ConnectionParams {
  host: string;
  port: string;
  user: string;
  password: string;
  /** The maintenance database used to issue CREATE/DROP DATABASE. */
  maintenanceDb: string;
}

/**
 * Parses connection parameters from `DATABASE_URL`/`POSTGRES_URL` or the
 * individual `POSTGRES_*` vars. Returns null when no credentials are found.
 */
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

/**
 * Builds a connection URL pointing at the given database name.
 */
function buildUrl(params: ConnectionParams, database: string): string {
  const url = new URL("postgresql://localhost");
  url.hostname = params.host;
  url.port = params.port;
  url.username = encodeURIComponent(params.user);
  url.password = encodeURIComponent(params.password);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Rejects non-local hosts to prevent accidentally creating/dropping a
 * database on a remote or production server. Opt-out via env var for
 * intentional use against a disposable remote instance.
 */
function isLocalHost(params: ConnectionParams): boolean {
  if (process.env.TOMORI_TESTS_ALLOW_NONLOCAL_DB === "true") return true;
  const allowed = new Set(["localhost", "127.0.0.1", "::1", "postgres", "tomoribot-db", "host.docker.internal"]);
  return allowed.has(params.host.toLowerCase());
}

function createSqlClient(url: string): SQL {
  return new SQL(url, { max: 1, idleTimeout: 1, connectionTimeout: 5 });
}

/**
 * Each test FILE runs in its own `bun test <file>` process. Bun applies
 * `mock.module()` process-wide and never restores it between files, so any test
 * that stubs a shared module (e.g. the `@/utils/db/repositories` barrel) would
 * otherwise corrupt every file that loads later in the same process. Because Bun
 * discovers files in filesystem order, that corruption is ordering-dependent and
 * surfaces as flaky "X is not a function" / "Export named X not found" failures
 * that move between suites whenever the file set changes. One process per file
 * guarantees every file starts from the real module graph, so results are
 * deterministic regardless of discovery order.
 *
 * Files run SEQUENTIALLY (never in parallel): the DB regression suites share a
 * single disposable Postgres database with fixed-id fixtures, so concurrent runs
 * would collide on the same rows.
 */
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

/**
 * Concatenates per-file JUnit XML files into the single outfile the caller
 * expects, then removes the per-file temporaries. The `vl` JUnit parser scans
 * for `<testsuite>` tags across the whole string, so plain concatenation yields a
 * file it reads correctly without needing one well-formed root element.
 */
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

/**
 * Runs each file in `files` sequentially, every one in its own `bun test`
 * process. When `BUN_TEST_JUNIT_OUTFILE` is set (the `vl` checklist sets it),
 * each file writes its own JUnit file which are then merged into that requested
 * path. `onProc`, when provided, receives the active child process so
 * signal-driven cleanup can terminate whichever file is currently running.
 *
 * @returns The first non-zero file exit code, or 0 when all files pass.
 */
async function runTestFiles(
  files: string[],
  extraEnv: Record<string, string> = {},
  onProc?: (proc: ReturnType<typeof Bun.spawn> | null) => void,
): Promise<number> {
  const requestedOutfile = process.env.BUN_TEST_JUNIT_OUTFILE;
  const perFileOutfiles: string[] = [];
  let combinedExit = 0;

  for (const [index, file] of files.entries()) {
    // 1. When JUnit output is requested, give each file its own temp outfile.
    const reporterArgs: string[] = [];
    if (requestedOutfile) {
      const fileOutfile = join(tmpdir(), `tomori-junit-${runId}-${index}.xml`);
      reporterArgs.push("--reporter=junit", `--reporter-outfile=${fileOutfile}`);
      perFileOutfiles.push(fileOutfile);
    }

    // 2. Spawn the file in its own process and track it for cleanup.
    const proc = Bun.spawn(["bun", "test", file, ...reporterArgs], {
      env: { ...process.env, ...extraEnv },
      stdout: "inherit",
      stderr: "inherit",
    });
    onProc?.(proc);
    const code = (await proc.exited) ?? 1;
    onProc?.(null);

    // 3. Remember the first failure but keep running so every file reports.
    if (code !== 0 && combinedExit === 0) combinedExit = code;
  }

  // 4. Merge per-file JUnit output into the single file the caller asked for.
  if (requestedOutfile && perFileOutfiles.length > 0) {
    await mergeJUnitFiles(perFileOutfiles, requestedOutfile);
  }

  return combinedExit;
}

async function main(): Promise<void> {
  if (process.env.RUN_ENV === "production") {
    throw new Error("[test-runner] Refusing to run with RUN_ENV=production.");
  }

  // Discover every test file once; each runs in its own process (see runTestFiles).
  const testFiles = await discoverTestFiles();
  if (testFiles.length === 0) {
    console.error("[test-runner] No test files found under tests/.");
    process.exit(1);
  }

  const params = getConnectionParams();

  // 1. No credentials found — run tests in skip mode.
  if (!params) {
    console.log("[test-runner] No Postgres credentials found. DB regression tests will be skipped.");
    process.exit(await runTestFiles(testFiles));
  }

  // 2. Non-local host detected — fall back to skip mode to avoid touching remote DBs.
  if (!isLocalHost(params)) {
    console.warn(
      `[test-runner] Postgres host "${params.host}" is not local. Skipping DB provisioning.\n` +
        "Set TOMORI_TESTS_ALLOW_NONLOCAL_DB=true to override.",
    );
    process.exit(await runTestFiles(testFiles));
  }

  const adminUrl = buildUrl(params, params.maintenanceDb);
  const testDbUrl = buildUrl(params, tempDbName);

  let adminSql: SQL | null = null;
  let proc: ReturnType<typeof Bun.spawn> | null = null;

  /** Kills the child process (if alive) and drops the disposable database. */
  async function cleanup(): Promise<void> {
    if (proc) {
      proc.kill();
      await proc.exited.catch(() => undefined);
      proc = null;
    }
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

  // 3. Probe the Postgres connection before creating anything.
  try {
    adminSql = createSqlClient(adminUrl);
    await adminSql`SELECT 1`;
  } catch {
    console.log("[test-runner] Could not reach Postgres. DB regression tests will be skipped.");
    await adminSql?.close({ timeout: 1 }).catch(() => undefined);
    adminSql = null;
    process.exit(await runTestFiles(testFiles));
  }

  let exitCode = 1;

  try {
    // 4. Create the disposable test database.
    console.log(`[test-runner] Provisioning test database: ${tempDbName}`);
    await adminSql`DROP DATABASE IF EXISTS ${adminSql(tempDbName)} WITH (FORCE)`;
    await adminSql`CREATE DATABASE ${adminSql(tempDbName)}`;

    // 5. Inject the test DB coordinates into the child environment.
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

    // Run each file in its own process; track the active child so signal-driven
    // cleanup can terminate whichever file is running and still drop the DB.
    exitCode = await runTestFiles(testFiles, testEnv, (active) => {
      proc = active;
    });
  } finally {
    // 6. Always drop the disposable database, even if tests failed.
    console.log(`[test-runner] Dropping test database: ${tempDbName}`);
    await cleanup();
  }

  process.exit(exitCode);
}

main().catch(async (err) => {
  console.error("[test-runner] Fatal:", err);
  process.exit(1);
});
