import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { log } from "@/utils/misc/logger";

export type DataBackupType = "manual" | "automatic";

export interface DataBackupOptions {
  backupType?: DataBackupType;
  triggerReasons?: string[];
  botVersion?: string;
}

export interface DataBackupResult {
  bundleDir: string;
  manifest: DataBackupManifest;
}

export interface DataBackupManifest {
  createdAt: string;
  botVersion: string;
  backupType: DataBackupType;
  triggerReasons: string[];
  files: string[];
}

interface ExistingBackupManifest {
  createdAt?: string;
  botVersion?: string;
  backupType?: string;
  triggerReasons?: unknown;
  files?: unknown;
}

interface DataBackupBundle {
  name: string;
  bundleDir: string;
  createdAtMs: number;
  manifest: ExistingBackupManifest;
  backupType: DataBackupType;
}

const DEFAULT_AUTO_BACKUP_INTERVAL_HOURS = 24;
const DEFAULT_AUTO_BACKUP_MAX = 5;

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

export function resolveEnvPath(): string {
  return process.env.TOMORI_ENV_FILE ? resolve(process.env.TOMORI_ENV_FILE) : join(process.cwd(), ".env");
}

export function resolveBackupsRoot(): string {
  return process.env.TOMORI_BACKUP_DIR ? resolve(process.env.TOMORI_BACKUP_DIR) : join(process.cwd(), "backups");
}

/**
 * Resolves a PostgreSQL connection URL from environment variables.
 * Prefers DATABASE_URL/POSTGRES_URL if set, otherwise constructs it from POSTGRES_* vars.
 */
function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;

  const host = process.env.POSTGRES_HOST || "localhost";
  const port = process.env.POSTGRES_PORT || "5432";
  const user = process.env.POSTGRES_USER || "postgres";
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DB || "tomodb";

  if (!password) {
    throw new Error("POSTGRES_PASSWORD, DATABASE_URL, or POSTGRES_URL is required but not set.");
  }

  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

function getCurrentBotVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
  if (!isRecord(parsed) || typeof parsed.version !== "string" || parsed.version.trim().length === 0) {
    throw new Error("package.json is missing a string version field.");
  }
  return parsed.version;
}

function createTimestamp(): string {
  return new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "").replace("T", "_");
}

function createBundleDirectory(backupsRoot: string, backupType: DataBackupType): string {
  const timestamp = createTimestamp();
  const typeSuffix = backupType === "automatic" ? "_auto" : "";
  const baseName = `backup_${timestamp}${typeSuffix}`;

  for (let attempt = 0; attempt < 100; attempt++) {
    const suffix = attempt === 0 ? "" : `_${attempt + 1}`;
    const bundleDir = join(backupsRoot, `${baseName}${suffix}`);
    if (!existsSync(bundleDir)) {
      mkdirSync(bundleDir, { recursive: false });
      return bundleDir;
    }
  }

  throw new Error(`Could not create a unique backup bundle directory for timestamp ${timestamp}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readManifest(bundleDir: string): ExistingBackupManifest | null {
  const manifestPath = join(bundleDir, "bundle_info.json");
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (!isRecord(parsed)) {
      return null;
    }

    return {
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : undefined,
      botVersion: typeof parsed.botVersion === "string" ? parsed.botVersion : undefined,
      backupType: typeof parsed.backupType === "string" ? parsed.backupType : undefined,
      triggerReasons: parsed.triggerReasons,
      files: parsed.files,
    };
  } catch (error) {
    log.warn(`Skipping unreadable backup manifest at ${manifestPath}: ${error}`);
    return null;
  }
}

function resolveBackupType(name: string, manifest: ExistingBackupManifest): DataBackupType {
  if (manifest.backupType === "automatic") {
    return "automatic";
  }
  if (manifest.backupType === "manual") {
    return "manual";
  }
  return name.includes("_auto") ? "automatic" : "manual";
}

function resolveCreatedAtMs(bundleDir: string, manifest: ExistingBackupManifest): number {
  if (manifest.createdAt) {
    const parsed = Date.parse(manifest.createdAt);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return statSync(bundleDir).mtime.getTime();
}

function listDataBackups(): DataBackupBundle[] {
  const backupsRoot = resolveBackupsRoot();
  if (!existsSync(backupsRoot)) {
    return [];
  }

  return readdirSync(backupsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("backup_"))
    .map((entry) => {
      const bundleDir = join(backupsRoot, entry.name);
      const manifest = readManifest(bundleDir) ?? {};
      return {
        name: entry.name,
        bundleDir,
        createdAtMs: resolveCreatedAtMs(bundleDir, manifest),
        manifest,
        backupType: resolveBackupType(entry.name, manifest),
      };
    })
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return defaultValue;
  }
  if (["false", "0", "no", "off"].includes(value)) {
    return false;
  }
  if (["true", "1", "yes", "on"].includes(value)) {
    return true;
  }
  return defaultValue;
}

function readNonNegativeNumberEnv(name: string, defaultValue: number): number {
  const value = process.env[name]?.trim();
  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

function readPositiveIntegerEnv(name: string, defaultValue: number): number {
  const value = process.env[name]?.trim();
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function isPathInside(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function pruneAutomaticBackups(maxAutomaticBackups: number): void {
  const backupsRoot = resolveBackupsRoot();
  const automaticBackups = listDataBackups()
    .filter((backup) => backup.backupType === "automatic")
    .sort((a, b) => a.createdAtMs - b.createdAtMs);

  const backupsToDelete = automaticBackups.slice(0, Math.max(0, automaticBackups.length - maxAutomaticBackups));
  if (backupsToDelete.length === 0) {
    return;
  }

  for (const backup of backupsToDelete) {
    const target = resolve(backup.bundleDir);
    if (!isPathInside(backupsRoot, target)) {
      throw new Error(`Refusing to delete backup outside backup root: ${target}`);
    }
    rmSync(target, { recursive: true, force: true });
    log.info(`Pruned old automatic backup: ${backup.name}`);
  }
}

export async function runDataBackup(options: DataBackupOptions = {}): Promise<DataBackupResult> {
  const backupType = options.backupType ?? "manual";
  const triggerReasons = options.triggerReasons ?? [];
  const botVersion = options.botVersion ?? getCurrentBotVersion();

  log.section(backupType === "automatic" ? "Automatic Data Backup" : "Transfer Backup");
  log.info("Creating a migration bundle with your database and config...");

  const envPath = resolveEnvPath();
  if (!existsSync(envPath)) {
    throw new Error(`Environment file not found: ${envPath}. Cannot bundle config.`);
  }

  const backupsRoot = resolveBackupsRoot();
  if (!existsSync(backupsRoot)) {
    mkdirSync(backupsRoot, { recursive: true });
  }

  const bundleDir = createBundleDirectory(backupsRoot, backupType);
  const dbDumpPath = join(bundleDir, "database.sql");
  const envBackupPath = join(bundleDir, "config.env");
  const manifestPath = join(bundleDir, "bundle_info.json");

  log.info(`Bundle directory: ${bundleDir}`);

  const dbUrl = resolveDatabaseUrl();
  log.info("Running pg_dump...");
  try {
    await runExternalCommand("pg_dump", [dbUrl, "--clean", "--if-exists", "-f", dbDumpPath]);
    log.success("Database dump completed.");
  } catch (error) {
    await log.error("pg_dump failed. Ensure pg_dump is installed and in your PATH.", error);
    log.info("  Windows: install PostgreSQL from https://www.postgresql.org/download/windows/");
    log.info("  macOS:   brew install postgresql");
    log.info("  Linux:   sudo apt-get install postgresql-client");
    throw error;
  }

  copyFileSync(envPath, envBackupPath);
  log.success("Config (.env) copied.");

  const manifest: DataBackupManifest = {
    createdAt: new Date().toISOString(),
    botVersion,
    backupType,
    triggerReasons,
    files: ["database.sql", "config.env"],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  log.section("Bundle Created");
  log.info(`Location:    ${bundleDir}`);
  log.info("Contents:");
  log.info("  database.sql     - PostgreSQL dump (restore with: bun run restore-backup)");
  log.info("  config.env       - Copy of your .env (review before restoring!)");
  log.info("  bundle_info.json - Bundle metadata");
  log.info("");
  log.info("To restore on a new install:");
  log.info(`  bun run restore-backup --from ${bundleDir}`);

  return { bundleDir, manifest };
}

export async function runAutomaticDataBackupIfNeeded(): Promise<void> {
  if (!readBooleanEnv("TOMORI_AUTO_BACKUP_ENABLED", true)) {
    log.info("Automatic startup backups disabled by TOMORI_AUTO_BACKUP_ENABLED.");
    return;
  }

  const botVersion = getCurrentBotVersion();
  const intervalHours = readNonNegativeNumberEnv(
    "TOMORI_AUTO_BACKUP_INTERVAL_HOURS",
    DEFAULT_AUTO_BACKUP_INTERVAL_HOURS,
  );
  const maxAutomaticBackups = readPositiveIntegerEnv("TOMORI_AUTO_BACKUP_MAX", DEFAULT_AUTO_BACKUP_MAX);
  const backups = listDataBackups();
  const latestBackup = backups[0];
  const triggerReasons: string[] = [];

  if (!latestBackup) {
    triggerReasons.push("no_previous_data_backup");
  } else {
    if (latestBackup.manifest.botVersion !== botVersion) {
      triggerReasons.push(`version_changed:${latestBackup.manifest.botVersion ?? "unknown"}->${botVersion}`);
    }

    const ageMs = Date.now() - latestBackup.createdAtMs;
    const intervalMs = intervalHours * 60 * 60 * 1000;
    if (ageMs >= intervalMs) {
      triggerReasons.push(`older_than_${intervalHours}_hours`);
    }
  }

  if (triggerReasons.length === 0 && latestBackup) {
    log.info(
      `Automatic startup backup skipped; latest data backup ${latestBackup.name} matches version ${botVersion} ` +
        `and is newer than ${intervalHours} hour(s).`,
    );
    return;
  }

  log.info(`Automatic startup backup required: ${triggerReasons.join(", ")}`);
  await runDataBackup({
    backupType: "automatic",
    botVersion,
    triggerReasons,
  });
  pruneAutomaticBackups(maxAutomaticBackups);
}
