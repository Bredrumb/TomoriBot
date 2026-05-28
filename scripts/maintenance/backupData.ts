import { sql } from "bun";
import { log } from "@/utils/misc/logger";
import { config } from "dotenv";
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

config();

// ---------------------------------------------------------------------------
// scripts/maintenance/backupData.ts
//   bun run backup                            → create a bundle in backups/
//   bun run restore-backup --latest           → restore from the newest bundle
//   bun run restore-backup --from <dir>       → restore from a specific bundle
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const mode = args[0];
const restoreConfirmed = process.env.TOMORI_RESTORE_CONFIRM === "RESTORE";
const forceNonEmptyRestore = process.env.TOMORI_RESTORE_FORCE_NONEMPTY === "RESTORE ANYWAY";

if (mode !== "--backup" && mode !== "--restore") {
  log.error("Usage:");
  log.info("  bun run backup");
  log.info("  bun run restore-backup --latest");
  log.info("  bun run restore-backup --from <bundle-dir>");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Shared helper: build DATABASE_URL from .env vars
// ---------------------------------------------------------------------------

async function runExternalCommand(command: string, args: string[]): Promise<void> {
  const subprocess = Bun.spawn([command, ...args], {
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(`${command} exited with code ${exitCode}`);
  }
}

function resolveEnvPath(): string {
  return process.env.TOMORI_ENV_FILE ? resolve(process.env.TOMORI_ENV_FILE) : join(process.cwd(), ".env");
}

function resolveBackupsRoot(): string {
  return process.env.TOMORI_BACKUP_DIR ? resolve(process.env.TOMORI_BACKUP_DIR) : join(process.cwd(), "backups");
}

/**
 * Resolves a PostgreSQL connection URL from environment variables.
 * Prefers DATABASE_URL if set, otherwise constructs it from POSTGRES_* vars.
 */
function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const host = process.env.POSTGRES_HOST || "localhost";
  const port = process.env.POSTGRES_PORT || "5432";
  const user = process.env.POSTGRES_USER || "postgres";
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DB || "tomodb";

  if (!password) {
    log.error("POSTGRES_PASSWORD (or DATABASE_URL) is required but not set.");
    process.exit(1);
  }

  // URL-encode the password to safely handle special characters (@, /, #, etc.)
  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

// ---------------------------------------------------------------------------
// --backup mode
// ---------------------------------------------------------------------------

/**
 * Creates a timestamped transfer bundle containing:
 *   - database.sql   — full pg_dump of the current database
 *   - config.env     — copy of the current .env file
 *   - bundle_info.json — metadata for validation on restore
 *
 * Output directory: backups/backup_YYYY-MM-DD_HH-MM-SS/
 */
async function runBackup(): Promise<void> {
  log.section("📦 TRANSFER BACKUP");
  log.info("Creating a migration bundle with your database and config...");

  // 1. Locate the .env file
  const envPath = resolveEnvPath();
  if (!existsSync(envPath)) {
    log.error(`Environment file not found: ${envPath}. Cannot bundle config.`);
    process.exit(1);
  }

  // 2. Create the backups/ output directory
  const backupsRoot = resolveBackupsRoot();
  if (!existsSync(backupsRoot)) {
    mkdirSync(backupsRoot, { recursive: true });
  }

  // 3. Build a timestamped bundle directory name
  const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "").replace("T", "_");
  const bundleDir = join(backupsRoot, `backup_${timestamp}`);
  mkdirSync(bundleDir, { recursive: true });

  const dbDumpPath = join(bundleDir, "database.sql");
  const envBackupPath = join(bundleDir, "config.env");
  const manifestPath = join(bundleDir, "bundle_info.json");

  log.info(`Bundle directory: ${bundleDir}`);

  // 4. Dump the database
  const dbUrl = resolveDatabaseUrl();
  log.info("Running pg_dump...");
  try {
    await runExternalCommand("pg_dump", [dbUrl, "--clean", "--if-exists", "-f", dbDumpPath]);
    log.success("Database dump completed.");
  } catch (_error) {
    log.error("pg_dump failed. Ensure pg_dump is installed and in your PATH.");
    log.info("  Windows: install PostgreSQL from https://www.postgresql.org/download/windows/");
    log.info("  macOS:   brew install postgresql");
    log.info("  Linux:   sudo apt-get install postgresql-client");
    process.exit(1);
  }

  // 5. Copy .env
  copyFileSync(envPath, envBackupPath);
  log.success("Config (.env) copied.");

  // 6. Write bundle manifest
  const { version } = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as {
    version: string;
  };
  const manifest = {
    createdAt: new Date().toISOString(),
    botVersion: version,
    files: ["database.sql", "config.env"],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  log.section("✅ Bundle Created!");
  log.info(`Location:    ${bundleDir}`);
  log.info("Contents:");
  log.info("  database.sql     — PostgreSQL dump (restore with: bun run restore-backup)");
  log.info("  config.env       — Copy of your .env (review before restoring!)");
  log.info("  bundle_info.json — Bundle metadata");
  log.info("");
  log.info("To restore on a new install:");
  log.info(`  bun run restore-backup --from ${bundleDir}`);
}

// ---------------------------------------------------------------------------
// --restore mode
// ---------------------------------------------------------------------------

/**
 * Restores a TomoriBot install from a transfer bundle created by --backup.
 * Steps:
 *   1. Validates the bundle directory and its required files.
 *   2. Shows the bundle manifest so the user can verify what they're restoring.
 *   3. Checks whether the target database is non-empty and warns before proceeding.
 *   4. Asks for final confirmation before touching any local files.
 *   5. Overwrites the local .env with config.env from the bundle.
 *   6. Restores the database from database.sql using psql.
 *
 * @param bundlePath - Absolute or relative path to the transfer bundle directory.
 */
async function runRestore(bundlePath: string): Promise<void> {
  log.section("♻️ TRANSFER RESTORE");

  // 1. Ensure DATABASE_URL is set so the sql tag can connect for the pre-restore check
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = resolveDatabaseUrl();
  }

  // 2. Validate bundle directory
  const bundleDir = resolve(bundlePath);
  if (!existsSync(bundleDir)) {
    log.error(`Bundle directory not found: ${bundleDir}`);
    process.exit(1);
  }

  const dbDumpPath = join(bundleDir, "database.sql");
  const envBackupPath = join(bundleDir, "config.env");
  const manifestPath = join(bundleDir, "bundle_info.json");

  for (const [label, path] of [
    ["database.sql", dbDumpPath],
    ["config.env", envBackupPath],
    ["bundle_info.json", manifestPath],
  ] as [string, string][]) {
    if (!existsSync(path)) {
      log.error(`Missing required bundle file: ${label}`);
      log.info("This bundle may be corrupt or was not created by `bun run backup`.");
      process.exit(1);
    }
  }

  // 2. Show bundle manifest
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
    createdAt: string;
    botVersion: string;
  };
  log.info(`Bundle created: ${manifest.createdAt}`);
  log.info(`Bot version:    ${manifest.botVersion}`);
  log.info(`Bundle path:    ${bundleDir}`);

  // 3. Check whether the target database already has tables
  const existingTables = await sql<{ tablename: string }[]>`
		SELECT tablename FROM pg_tables WHERE schemaname = 'public'
	`;

  if (existingTables.length > 0) {
    log.section("🛑 TARGET DATABASE IS NOT EMPTY");
    log.info(`Found ${existingTables.length} existing table(s) in the database.`);
    log.info("Restoring into a non-empty database will cause conflicts:");
    log.info("  - CREATE TABLE statements will fail (tables already exist).");
    log.info("  - INSERT statements will fail on duplicate primary keys.");
    log.info("  - psql continues past errors, leaving the database in a mixed state.");
    log.info("");
    log.info("Recommended: run `bun run nuke-db` first, then re-run restore.");
    let forceResponse = "";
    if (forceNonEmptyRestore) {
      log.warn("Non-interactive non-empty restore confirmation accepted from TOMORI_RESTORE_FORCE_NONEMPTY.");
      forceResponse = "RESTORE ANYWAY";
    } else {
      log.info("Type 'RESTORE ANYWAY' to force restore into the existing database,");
      log.info("or anything else to abort:");

      forceResponse = await new Promise<string>((resolve) => {
        process.stdin.resume();
        process.stdin.once("data", (data) => {
          resolve(data.toString().trim());
          process.stdin.pause();
        });
      });
    }

    if (forceResponse !== "RESTORE ANYWAY") {
      log.info("Aborted. Run `bun run nuke-db` first for a clean restore.");
      process.exit(0);
    }

    log.info("Proceeding with forced restore into non-empty database...");
  }

  // 4. Warn about remaining side effects and ask for final confirmation
  log.section("⚠️ WARNING — Read before continuing");
  log.info("Restoring will:");
  log.info("  1. Overwrite your local .env with the bundled config.env.");
  log.info("     ➜ After restore, update POSTGRES_HOST/PORT/USER/PASSWORD/DB in your .env");
  log.info("       if this machine's database credentials differ from the source machine.");
  log.info("  2. Restore the bundled database dump into your current DB connection.");
  let response = "";
  if (restoreConfirmed) {
    log.warn("Non-interactive restore confirmation accepted from TOMORI_RESTORE_CONFIRM.");
    response = "RESTORE";
  } else {
    log.info("Type 'RESTORE' (all caps) to proceed:");

    response = await new Promise<string>((resolve) => {
      process.stdin.resume();
      process.stdin.once("data", (data) => {
        resolve(data.toString().trim());
        process.stdin.pause();
      });
    });
  }

  if (response !== "RESTORE") {
    log.info("Aborted. Nothing was changed.");
    process.exit(0);
  }

  // 4. Restore .env
  const localEnvPath = resolveEnvPath();
  const envAlreadyExists = existsSync(localEnvPath);
  if (envAlreadyExists) {
    // Back up existing .env before overwriting
    const backupEnvPath = `${localEnvPath}.bak`;
    copyFileSync(localEnvPath, backupEnvPath);
    log.info(`Existing environment file backed up to: ${backupEnvPath}`);
  }
  copyFileSync(envBackupPath, localEnvPath);
  log.success(".env restored from bundle.");

  // Re-load env so DATABASE_URL picks up the restored values
  config({ override: true });

  // 5. Restore database
  const dbUrl = resolveDatabaseUrl();
  log.info("Restoring database from dump (running psql)...");
  try {
    await runExternalCommand("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-f", dbDumpPath]);
    log.success("Database restored successfully.");
  } catch (_error) {
    log.error("psql restore failed. Ensure psql is installed and in your PATH.");
    log.info("  Windows: install PostgreSQL from https://www.postgresql.org/download/windows/");
    log.info("  macOS:   brew install postgresql");
    log.info("  Linux:   sudo apt-get install postgresql-client");
    process.exit(1);
  }

  log.section("✅ Restore Complete!");
  log.info("Next steps:");
  log.info("  1. Update POSTGRES_*, DISCORD_TOKEN, and CRYPTO_SECRET in .env if they differ on this machine.");
  log.info("  2. Run `bun install` to ensure dependencies are up to date.");
  log.info("  3. Start the bot with `bun run dev` or `bun run start`.");
}

// ---------------------------------------------------------------------------
// --latest helper: resolve the most recent bundle in backups/
// ---------------------------------------------------------------------------

/**
 * Scans the backups/ directory and returns the path of the most recently
 * created bundle. Bundle folders are named backup_YYYY-MM-DD_HH-MM-SS so
 * a descending lexicographic sort reliably picks the newest one.
 *
 * @returns Absolute path to the latest bundle directory.
 */
function resolveLatestBundle(): string {
  const backupsRoot = resolveBackupsRoot();

  if (!existsSync(backupsRoot)) {
    log.error("No backups/ directory found. Run `bun run backup` first.");
    process.exit(1);
  }

  // Filter to only transfer_* subdirectories and sort descending by name
  const bundles = readdirSync(backupsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("backup_"))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  if (bundles.length === 0) {
    log.error("No bundles found in backups/. Run `bun run backup` first.");
    process.exit(1);
  }

  const latest = join(backupsRoot, bundles[0]);
  log.info(`Using latest bundle: ${bundles[0]}`);
  return latest;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

let entryPromise: Promise<void>;

if (mode === "--backup") {
  entryPromise = runBackup();
} else {
  // --restore mode: accept either --latest or --from <dir>
  const useLatest = args.includes("--latest");
  const fromIndex = args.indexOf("--from");

  if (!useLatest && (fromIndex === -1 || !args[fromIndex + 1])) {
    log.error("Provide either --latest or --from <bundle-dir>.");
    log.info("  bun run restore-backup --latest");
    log.info("  bun run restore-backup --from backups/backup_2025-01-01_12-00-00");
    process.exit(1);
  }

  const bundlePath = useLatest ? resolveLatestBundle() : args[fromIndex + 1];
  entryPromise = runRestore(bundlePath);
}

entryPromise
  .catch((error) => {
    log.error("Script failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
