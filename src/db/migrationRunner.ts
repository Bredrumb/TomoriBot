import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { sql as defaultSql } from "@/utils/db/client";
import { splitSqlStatements } from "@/utils/db/sqlSplitter";
import { log } from "@/utils/misc/logger";
import type { SQL } from "bun";

const MIGRATIONS_DIR = path.join(import.meta.dir, "migrations");

// Deployment-specific migrations start at 900 and are absent from schema.sql, so fresh installs must still run them.
const DEPLOYMENT_MIGRATION_BAND_START = 900;

const MIGRATION_FILENAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

interface PendingMigration {
  version: number;
  name: string;
  filePath: string;
}

async function ensureMigrationsTable(client: SQL): Promise<void> {
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         SERIAL      PRIMARY KEY,
      name       TEXT        UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client: SQL): Promise<Set<string>> {
  const rows = await client<{ name: string }[]>`SELECT name FROM schema_migrations`;
  return new Set(rows.map((r) => r.name));
}

async function getPendingMigrations(applied: Set<string>, migrationsDir: string): Promise<PendingMigration[]> {
  let files: string[];
  try {
    files = await readdir(migrationsDir);
  } catch {
    log.warn("Migrations directory not found — skipping migration runner");
    return [];
  }

  const pending: PendingMigration[] = [];

  for (const file of files) {
    if (file.endsWith(".down.sql")) continue;
    if (!file.endsWith(".sql")) continue;

    const match = MIGRATION_FILENAME.exec(file);
    if (!match) {
      log.warn(`Migration file skipped — name does not match NNN_description.sql: ${file}`);
      continue;
    }

    const version = Number.parseInt(match[1], 10);
    const name = file.slice(0, -".sql".length);

    if (!applied.has(name)) {
      pending.push({ version, name, filePath: path.join(migrationsDir, file) });
    }
  }

  // Sort ties by code point rather than localeCompare so same-numbered migrations apply deterministically across host
  // locales.
  return pending.sort((a, b) => {
    if (a.version !== b.version) return a.version - b.version;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

// Fresh schema.sql installs already contain pre-900 migrations, so these are marked applied without running because
// replaying would query dropped legacy tables.
export async function markAllMigrationsApplied(
  client: SQL = defaultSql,
  migrationsDir: string = MIGRATIONS_DIR,
): Promise<void> {
  await ensureMigrationsTable(client);

  const migrations = await getPendingMigrations(new Set(), migrationsDir);
  const historicalMigrations = migrations.filter((migration) => migration.version < DEPLOYMENT_MIGRATION_BAND_START);
  for (const migration of historicalMigrations) {
    await client`
      INSERT INTO schema_migrations (name)
      VALUES (${migration.name})
      ON CONFLICT (name) DO NOTHING
    `;
  }

  log.success(
    `Database migrations: ${historicalMigrations.length} historical migration marker(s) recorded for fresh schema`,
  );
}

// Comment-only marker migrations such as 001_baseline intentionally yield zero statements, so recording them without
// executing SQL is expected.
async function applyMigration(client: SQL, migration: PendingMigration): Promise<void> {
  const sqlText = await readFile(migration.filePath, "utf-8");
  const statements = splitSqlStatements(sqlText);

  // Record schema_migrations only after every statement succeeds so a partial failure retries on the next boot.
  for (const stmt of statements) {
    await client.unsafe(stmt);
  }

  await client`INSERT INTO schema_migrations (name) VALUES (${migration.name})`;
}

export async function runMigrations(client: SQL = defaultSql, migrationsDir: string = MIGRATIONS_DIR): Promise<void> {
  await ensureMigrationsTable(client);

  const applied = await getAppliedMigrations(client);
  const pending = await getPendingMigrations(applied, migrationsDir);

  if (pending.length === 0) {
    log.success("Database migrations: up to date");
    return;
  }

  log.info(`Running ${pending.length} pending migration(s)...`);

  for (const migration of pending) {
    log.info(`Applying migration: ${migration.name}`);
    try {
      await applyMigration(client, migration);
      log.success(`Migration applied: ${migration.name}`);
    } catch (error) {
      log.error(`Migration failed: ${migration.name}`, error);
      throw error;
    }
  }

  log.success(`${pending.length} migration(s) applied successfully`);
}
