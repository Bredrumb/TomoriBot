/**
 * Test runner wrapper for the TomoriBot regression harness.
 *
 * Behavior:
 *  1. Detect whether a valid local Postgres connection is available.
 *  2. If yes:  create a disposable `tomoribot_test_<id>` database, inject
 *              TEST_DB_READY=1 + POSTGRES_DB=<name> into the child env, run
 *              `bun test tests/`, then drop the database on any exit path
 *              (clean finish, uncaught error, SIGINT, or SIGTERM).
 *  3. If no:   run `bun test tests/` without DB env vars so the 89 DB
 *              regression tests skip gracefully instead of erroring.
 *
 * Invoke via `bun run test` (package.json) — not `bun test tests/` directly.
 */

import { SQL } from "bun";
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
 * Optional JUnit reporter flags. When `BUN_TEST_JUNIT_OUTFILE` is set (the `vl`
 * checklist sets it), `bun test` also writes a JUnit XML file so the caller can
 * reliably enumerate every test file with pass/fail/skip counts — piped console
 * output omits per-file headers for files that log nothing.
 */
function junitReporterArgs(): string[] {
  const outfile = process.env.BUN_TEST_JUNIT_OUTFILE;
  return outfile ? ["--reporter=junit", `--reporter-outfile=${outfile}`] : [];
}

/** Spawns `bun test tests/` and returns the child exit code. */
async function spawnBunTest(extraEnv: Record<string, string> = {}): Promise<number> {
  const proc = Bun.spawn(["bun", "test", "tests/", ...junitReporterArgs()], {
    env: { ...process.env, ...extraEnv },
    stdout: "inherit",
    stderr: "inherit",
  });
  return (await proc.exited) ?? 1;
}

async function main(): Promise<void> {
  if (process.env.RUN_ENV === "production") {
    throw new Error("[test-runner] Refusing to run with RUN_ENV=production.");
  }

  const params = getConnectionParams();

  // 1. No credentials found — run tests in skip mode.
  if (!params) {
    console.log("[test-runner] No Postgres credentials found. DB regression tests will be skipped.");
    process.exit(await spawnBunTest());
  }

  // 2. Non-local host detected — fall back to skip mode to avoid touching remote DBs.
  if (!isLocalHost(params)) {
    console.warn(
      `[test-runner] Postgres host "${params.host}" is not local. Skipping DB provisioning.\n` +
        "Set TOMORI_TESTS_ALLOW_NONLOCAL_DB=true to override.",
    );
    process.exit(await spawnBunTest());
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
    process.exit(await spawnBunTest());
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

    proc = Bun.spawn(["bun", "test", "tests/", ...junitReporterArgs()], {
      env: { ...process.env, ...testEnv },
      stdout: "inherit",
      stderr: "inherit",
    });

    exitCode = (await proc.exited) ?? 1;
    proc = null;
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
