import { sql } from "bun";
import { log } from "@/utils/misc/logger";
import { config } from "dotenv";

config();

const args = new Set(process.argv.slice(2));
const skipPrompt = args.has("--yes") && process.env.TOMORI_NUKE_CONFIRM === "NUKE DATABASE";

// Construct DATABASE_URL from individual POSTGRES_* vars if not explicitly set.
// Bun's sql tag reads DATABASE_URL from the environment — without this, it falls
// back to its default connection (postgres / no password) and fails.
if (!process.env.DATABASE_URL) {
  const host = process.env.POSTGRES_HOST || "localhost";
  const port = process.env.POSTGRES_PORT || "5432";
  const user = process.env.POSTGRES_USER || "postgres";
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DB || "tomodb";

  if (!password) {
    log.error("POSTGRES_PASSWORD (or DATABASE_URL) is required but not set in .env");
    process.exit(1);
  }

  process.env.DATABASE_URL = `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

/**
 * Destroys the entire TomoriBot database by dynamically discovering and
 * dropping all tables in the public schema.
 *
 * Uses pg_tables to enumerate tables at runtime so this script never goes
 * stale when new tables are added to the schema.
 *
 * DANGER: This is irreversible. Run `bun run backup` first.
 */
async function nukeDatabase(): Promise<void> {
  log.section("⚠️ DATABASE DESTRUCTION SCRIPT ⚠️");
  log.info("This will DELETE ALL TABLES and DATA in the connected PostgreSQL database.");
  log.info("Run `bun run backup` first if you want to preserve your data.");

  // 1. Discover all tables in the public schema at runtime
  const tableRows = await sql<{ tablename: string }[]>`
		SELECT tablename
		FROM pg_tables
		WHERE schemaname = 'public'
		ORDER BY tablename
	`;

  if (tableRows.length === 0) {
    log.info("No tables found in the public schema. Database is already empty.");
    return;
  }

  const tableNames = tableRows.map((r) => r.tablename);
  log.info(`Tables found (${tableNames.length}): ${tableNames.join(", ")}`);

  if (!skipPrompt) {
    log.info("Type 'NUKE DATABASE' (all caps) to confirm deletion:");

    // 2. Require explicit confirmation before proceeding
    const response = await new Promise<string>((resolve) => {
      process.stdin.resume();
      process.stdin.once("data", (data) => {
        resolve(data.toString().trim());
        process.stdin.pause();
      });
    });

    if (response !== "NUKE DATABASE") {
      log.info("Aborted. Your database is safe.");
      return;
    }
  } else {
    log.warn("Non-interactive confirmation accepted from TOMORI_NUKE_CONFIRM.");
  }

  log.info("Confirmation received. Starting database nuke process...");

  try {
    // 3. Disable FK checks so tables can be dropped in any order
    await sql`SET session_replication_role = 'replica';`;

    // 4. Drop each discovered table
    for (const table of tableNames) {
      try {
        await sql`DROP TABLE IF EXISTS ${sql(table)} CASCADE;`;
        log.success(`Dropped table: ${table}`);
      } catch (err) {
        log.error(`Failed to drop table ${table}:`, err);
      }
    }

    // 5. Re-enable FK checks
    await sql`SET session_replication_role = 'origin';`;

    log.section("Database successfully nuked! 💣");
    log.info("To restore from a backup:  bun run restore-backup --latest");
    log.info("To start completely fresh: bun run dev  (bot auto-initializes the schema)");
  } catch (error) {
    log.error("Error during database nuke process:", error);
  }
}

nukeDatabase()
  .catch((error) => {
    log.error("Database nuke failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
