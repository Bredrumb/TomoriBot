import { sql } from "bun";
import { log } from "@/utils/misc/logger";
import { config } from "dotenv";
import { resolveBackupsRoot, runDataBackup } from "@/utils/backup/dataBackup";
import { existsSync, copyFileSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

config();

// scripts/devtools/backupData.ts
//   bun run backup                            → create a bundle in backups/
//   bun run restore-backup --latest           → restore from the newest bundle
//   bun run restore-backup --from <dir>       → restore from a specific bundle

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


async function runExternalCommand(
  command: string,
  args: string[],
  options: { stdout?: "inherit" | "ignore" } = {},
): Promise<void> {
  const subprocess = Bun.spawn([command, ...args], {
    stdout: options.stdout ?? "inherit",
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


async function runBackup(): Promise<void> {
  await runDataBackup({ backupType: "manual" });
}


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

  // Resolve and pin the target before restoring config from the source bundle.
  // The bundled config may contain source-machine POSTGRES_* values, but both the
  // preflight query and psql must continue targeting the database selected when
  // this process started (including values injected by runWithSecrets.ts).
  const targetDatabaseUrl = resolveDatabaseUrl();
  process.env.DATABASE_URL = targetDatabaseUrl;

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

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
    createdAt: string;
    botVersion: string;
  };
  log.info(`Bundle created: ${manifest.createdAt}`);
  log.info(`Bot version:    ${manifest.botVersion}`);
  log.info(`Bundle path:    ${bundleDir}`);

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

  const localEnvPath = resolveEnvPath();
  const envAlreadyExists = existsSync(localEnvPath);
  if (envAlreadyExists) {
    const backupEnvPath = `${localEnvPath}.bak`;
    copyFileSync(localEnvPath, backupEnvPath);
    log.info(`Existing environment file backed up to: ${backupEnvPath}`);
  }
  copyFileSync(envBackupPath, localEnvPath);
  log.success(".env restored from bundle.");

  log.info("Restoring database from dump (running psql)...");
  try {
    const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
    await runExternalCommand("psql", [
      "--quiet",
      "-o",
      nullDevice,
      targetDatabaseUrl,
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      dbDumpPath,
    ]);
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
  log.info("  2. Run `bun install --frozen-lockfile` to restore the locked dependencies.");
  log.info("  3. Start the bot with `bun run dev` or `bun run start`.");
}


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


let entryPromise: Promise<void>;

if (mode === "--backup") {
  entryPromise = runBackup();
} else {
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
