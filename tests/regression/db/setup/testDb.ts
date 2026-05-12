/**
 * Test database configuration for DB regression harness.
 *
 * Tests only run when the effective test DB name matches TEST_POSTGRES_DB
 * (default: "tomodb_test").
 * This prevents the harness from writing fixture data into a development or
 * production database when run without the correct environment.
 *
 * To run: POSTGRES_DB=tomodb_test bun test tests/regression/db/
 * Or:     bun --env-file=.env.test test tests/regression/db/
 */
import { SQL } from "bun";
import { initializeDatabase } from "@/utils/db/initializeDatabase";

const testDbName = process.env.TEST_POSTGRES_DB ?? "tomodb_test";
const effectiveHost = process.env.TEST_POSTGRES_HOST ?? process.env.POSTGRES_HOST ?? "localhost";
const effectivePort = process.env.TEST_POSTGRES_PORT ?? process.env.POSTGRES_PORT ?? "5432";
const effectiveUser = process.env.TEST_POSTGRES_USER ?? process.env.POSTGRES_USER ?? "postgres";
const effectivePassword = process.env.TEST_POSTGRES_PASSWORD ?? process.env.POSTGRES_PASSWORD;
const currentDbName = process.env.POSTGRES_DB ?? (process.env.TEST_POSTGRES_DB ? testDbName : "tomodb");

// Keep the application singleton DB client pointed at the same test database as
// the direct fixture client below. dbRead/dbWrite import the singleton lazily, so
// setting these at module load is early enough for the harness.
process.env.POSTGRES_HOST = effectiveHost;
process.env.POSTGRES_PORT = effectivePort;
process.env.POSTGRES_USER = effectiveUser;
process.env.POSTGRES_DB = currentDbName;
if (effectivePassword) process.env.POSTGRES_PASSWORD = effectivePassword;

/**
 * True only when the environment is pointing at the designated test database.
 * All regression describe blocks call describe.skipIf(!DB_TESTS_AVAILABLE).
 */
export const DB_TESTS_AVAILABLE = Boolean(effectivePassword) && currentDbName === testDbName;

/**
 * A direct SQL client for the test database, used exclusively for fixture
 * insertion and cleanup. Test assertions call the real dbRead/dbWrite functions
 * which use the global sql singleton from client.ts — those must also be pointed
 * at the test DB via POSTGRES_DB env var.
 */
export const testSql = new SQL({
  hostname: effectiveHost,
  port: Number(effectivePort),
  username: effectiveUser,
  password: effectivePassword ?? "dummy",
  database: testDbName,
});

/**
 * Bootstraps the test database schema (idempotent).
 * Uses the same initializeDatabase() path as the bot, so schema drift
 * between tests and production is structurally impossible.
 */
export async function setupTestDb(): Promise<void> {
  await initializeDatabase({ client: testSql, includeRag: false });
}
