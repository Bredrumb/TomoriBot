/**
 * Manual migration rollback runner.
 *
 * Applies the paired NNN_description.down.sql rollback files in DESCENDING
 * version order, then removes the matching rows from schema_migrations so the
 * forward runner will re-apply them on the next boot.
 *
 * Unlike the forward runner (which executes automatically at startup via
 * initializeDatabase.ts), rollback is ALWAYS manual and never runs on boot —
 * down migrations are typically lossy (DROP TABLE / DROP COLUMN), so undoing a
 * migration must be a deliberate, explicit act.
 *
 * IMPORTANT — run this while still checked out on the branch that introduced the
 * migration. The rollback reads NNN_description.down.sql from disk; once you
 * switch branches those files disappear and the rollback can no longer execute.
 *
 * Usage:
 *   bun run migrate:down <version>        # roll back this migration + all newer applied ones
 *   bun run migrate:down 034              # e.g. undo 035 then 034, leaving 033 as head
 *   bun run migrate:down --last           # roll back only the most recently applied migration
 *   bun run migrate:down --last=2         # roll back the 2 most recently applied migrations
 *
 * By default the command performs a DRY RUN and only prints the ordered plan.
 * Re-run with --yes (or -y) to actually execute the rollback.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { sql } from "@/utils/db/client";
import { splitSqlStatements } from "@/utils/db/sqlSplitter";
import { log } from "@/utils/misc/logger";

config();

// Mirror migrate.ts: derive DATABASE_URL from POSTGRES_* when not explicitly set
// so this script behaves identically regardless of which env style is configured.
if (!process.env.DATABASE_URL) {
  const host = process.env.POSTGRES_HOST || "localhost";
  const port = process.env.POSTGRES_PORT || "5432";
  const user = process.env.POSTGRES_USER || "postgres";
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DB || "tomodb";

  if (!password) {
    log.error("POSTGRES_PASSWORD (or DATABASE_URL) is required but not set");
    process.exit(1);
  }

  process.env.DATABASE_URL = `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

/** Absolute path to the migrations directory (shared with the forward runner). */
const MIGRATIONS_DIR = path.join(import.meta.dir, "..", "..", "src", "db", "migrations");

/** Up-migration filename pattern: NNN_description.sql (capture group 1 = version). */
const MIGRATION_FILENAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

interface MigrationFile {
  version: number;
  /** Stem without extension, e.g. "034_stm_customization". The schema_migrations key. */
  name: string;
  /** Absolute path to the paired NNN_description.down.sql rollback file. */
  downPath: string;
}

/**
 * Scans the migrations directory and returns every up-migration on disk keyed by
 * its tracking name, along with the path to its paired rollback file.
 */
async function scanMigrationFiles(): Promise<Map<string, MigrationFile>> {
  const files = await readdir(MIGRATIONS_DIR);
  const byName = new Map<string, MigrationFile>();

  for (const file of files) {
    // Only consider up-migrations; .down.sql files are resolved by derived name.
    if (file.endsWith(".down.sql")) continue;
    const match = MIGRATION_FILENAME.exec(file);
    if (!match) continue;

    const name = file.slice(0, -".sql".length);
    byName.set(name, {
      version: Number.parseInt(match[1], 10),
      name,
      downPath: path.join(MIGRATIONS_DIR, `${name}.down.sql`),
    });
  }

  return byName;
}

/**
 * Returns the tracking names of every migration currently recorded as applied.
 * Returns an empty set if the schema_migrations table does not exist yet.
 */
async function getAppliedNames(): Promise<Set<string>> {
  const exists = await sql<{ exists: boolean }[]>`
    SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists
  `;
  if (!exists[0]?.exists) return new Set();

  const rows = await sql<{ name: string }[]>`SELECT name FROM schema_migrations`;
  return new Set(rows.map((r) => r.name));
}

/**
 * Executes a single rollback file and removes its schema_migrations row.
 *
 * Statements run in file order (down files are authored to undo in the correct
 * sequence) and outside an explicit transaction, mirroring the forward runner's
 * applyMigration so behaviour is symmetric between up and down.
 */
async function rollbackOne(migration: MigrationFile): Promise<void> {
  const sqlText = await readFile(migration.downPath, "utf-8");
  const statements = splitSqlStatements(sqlText);

  for (const stmt of statements) {
    await sql.unsafe(stmt);
  }

  // Remove the tracking row so the forward runner re-applies this migration on
  // the next boot (the file is still on disk while you remain on the branch).
  await sql`DELETE FROM schema_migrations WHERE name = ${migration.name}`;
}

/**
 * Parses CLI arguments into a rollback request.
 *
 * @returns target selection (`lastCount` for --last, or `fromVersion` for a
 *          positional version/name) plus the confirmation flag.
 */
function parseArgs(): { lastCount?: number; fromVersion?: number; confirmed: boolean } {
  const argv = process.argv.slice(2);
  const confirmed = argv.includes("--yes") || argv.includes("-y");

  // --last or --last=N : roll back the N most recently applied migrations.
  const lastArg = argv.find((a) => a === "--last" || a.startsWith("--last="));
  if (lastArg) {
    const eq = lastArg.indexOf("=");
    const count = eq === -1 ? 1 : Number.parseInt(lastArg.slice(eq + 1), 10);
    if (!Number.isFinite(count) || count < 1) {
      log.error("--last requires a positive integer (e.g. --last=2)");
      process.exit(1);
    }
    return { lastCount: count, confirmed };
  }

  // Positional version or full name stem (e.g. "034" or "034_stm_customization").
  const positional = argv.find((a) => !a.startsWith("-"));
  if (!positional) {
    log.error("Provide a target version (e.g. 034) or --last[=N]. See script header for usage.");
    process.exit(1);
  }

  // Accept a bare number, a zero-padded number, or a full stem; extract the version.
  const numeric = /^\d+$/.test(positional)
    ? Number.parseInt(positional, 10)
    : Number.parseInt(MIGRATION_FILENAME.exec(`${positional}.sql`)?.[1] ?? "", 10);

  if (!Number.isFinite(numeric)) {
    log.error(`Could not parse a migration version from "${positional}".`);
    process.exit(1);
  }

  return { fromVersion: numeric, confirmed };
}

async function main(): Promise<void> {
  const { lastCount, fromVersion, confirmed } = parseArgs();

  const filesByName = await scanMigrationFiles();
  const appliedNames = await getAppliedNames();

  // 1. Resolve applied migrations that also still have files on disk (rollback
  //    needs the .down.sql), sorted DESCENDING so dependents undo before deps.
  const appliedWithFiles = [...appliedNames]
    .map((name) => filesByName.get(name))
    .filter((m): m is MigrationFile => m !== undefined)
    .sort((a, b) => b.version - a.version);

  // 2. Select the rollback set from the parsed target.
  let targets: MigrationFile[];
  if (lastCount !== undefined) {
    targets = appliedWithFiles.slice(0, lastCount);
  } else {
    targets = appliedWithFiles.filter((m) => m.version >= (fromVersion ?? Number.POSITIVE_INFINITY));
  }

  if (targets.length === 0) {
    log.success("No applied migrations match the target — nothing to roll back.");
    process.exit(0);
  }

  // 3. Verify every target actually has a rollback file before touching anything.
  for (const t of targets) {
    const exists = await readFile(t.downPath).then(
      () => true,
      () => false,
    );
    if (!exists) {
      log.error(`Missing rollback file for ${t.name}: ${t.downPath}`);
      log.error("Are you still checked out on the branch that introduced it?");
      process.exit(1);
    }
  }

  // 4. Print the ordered plan. Down migrations are typically destructive, so make
  //    the consequence explicit before any execution.
  log.section(`Rollback plan (${targets.length} migration(s), newest first):`);
  for (const t of targets) {
    log.info(`  ↓ ${t.name}`);
  }

  if (!confirmed) {
    log.warn("DRY RUN — no changes made. Re-run with --yes to execute this rollback.");
    log.warn("This will run the .down.sql files above (often DROP TABLE/COLUMN) and may delete data.");
    process.exit(0);
  }

  // 5. Execute in descending version order.
  for (const t of targets) {
    log.info(`Rolling back: ${t.name}`);
    try {
      await rollbackOne(t);
      log.success(`Rolled back: ${t.name}`);
    } catch (error) {
      log.error(`Rollback failed: ${t.name}`, error);
      throw error;
    }
  }

  log.success(`${targets.length} migration(s) rolled back successfully`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    log.error("Rollback run failed:", error);
    process.exit(1);
  });
