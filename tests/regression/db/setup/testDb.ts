import { SQL } from "bun";
import { readFile } from "node:fs/promises";
import { initializeDatabase } from "@/utils/db/initializeDatabase";
import { splitSqlStatements } from "@/utils/db/sqlSplitter";
import { keyManager } from "@/utils/security/keyManager";
import { resetDatabaseConnection, sql } from "@/utils/db/client";

const effectiveHost = process.env.TEST_POSTGRES_HOST ?? process.env.POSTGRES_HOST ?? "localhost";
const effectivePort = process.env.TEST_POSTGRES_PORT ?? process.env.POSTGRES_PORT ?? "5432";
const effectiveUser = process.env.TEST_POSTGRES_USER ?? process.env.POSTGRES_USER ?? "postgres";
const effectivePassword = process.env.TEST_POSTGRES_PASSWORD ?? process.env.POSTGRES_PASSWORD;
const effectiveDatabase = process.env.POSTGRES_DB ?? "tomodb";

// Set env before lazy dbRead/dbWrite imports so the app singleton targets the same test database as fixtureClient.
process.env.POSTGRES_HOST = effectiveHost;
process.env.POSTGRES_PORT = effectivePort;
process.env.POSTGRES_USER = effectiveUser;
process.env.POSTGRES_DB = effectiveDatabase;
if (effectivePassword) process.env.POSTGRES_PASSWORD = effectivePassword;

// TEST_DB_READY=1 is required alongside credentials so bare test runs never write fixture rows into a development or
// production database.
export const DB_TESTS_AVAILABLE = Boolean(effectivePassword) && process.env.TEST_DB_READY === "1";

function createFixtureClient(): SQL {
  return new SQL({
    hostname: effectiveHost,
    port: Number(effectivePort),
    username: effectiveUser,
    password: effectivePassword ?? "dummy",
    database: effectiveDatabase,
    idleTimeout: 180,
    maxLifetime: 1800,
  });
}

let fixtureClient = createFixtureClient();

// Repositories retain this client at module load, so the proxy must survive pool replacement.
export const testSql = new Proxy(
  ((strings: TemplateStringsArray, ...values: unknown[]) => fixtureClient(strings, ...values)) as unknown as SQL,
  {
    get(_target, property) {
      const value = Reflect.get(fixtureClient, property, fixtureClient);
      return typeof value === "function" ? value.bind(fixtureClient) : value;
    },
  },
);

export async function executeTestSqlFile(filePath: string): Promise<void> {
  const sqlText = await readFile(filePath, "utf-8");
  const statements = splitSqlStatements(sqlText);
  const executableStatements = statements.filter((statement) => {
    const command = statement
      .replace(/^\s*(?:--[^\r\n]*(?:\r?\n|$)\s*)*/g, "")
      .trim()
      .replace(/;$/, "")
      .toUpperCase();
    return command !== "BEGIN" && command !== "COMMIT";
  });

  await testSql.begin(async (tx) => {
    for (const statement of executableStatements) {
      await tx.unsafe(statement);
    }
  });
}

let bootstrapPromise: Promise<void> | null = null;

// Bootstrap is memoized across every beforeAll in the process because replaying schema, migrations, and catalogs is slow.
export async function setupTestDb(): Promise<void> {
  bootstrapPromise ??= bootstrap();
  await bootstrapPromise;
  // Schema restores invalidate prepared type and result metadata in both pools.
  await sql.close();
  resetDatabaseConnection();
  await fixtureClient.close();
  fixtureClient = createFixtureClient();
}

// Fallback CRYPTO_SECRET initializes keyManager before encrypted repository writes, because an uninitialized version
// 0 singleton fails silently inside catches.
async function bootstrap(): Promise<void> {
  process.env.CRYPTO_SECRET ??= "tomoribot_regression_harness_crypto_secret";
  keyManager.initialize();
  await initializeDatabase({ client: testSql, includeRag: false });
}
