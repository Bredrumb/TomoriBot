/**
 * Migration rollback pairing check.
 *
 * Verifies that every up-migration (NNN_description.sql) in src/db/migrations/
 * has a corresponding rollback file (NNN_description.down.sql).
 *
 * Exits with code 1 if any up-migration is missing its rollback so CI catches
 * the gap before the migration reaches a shared environment.
 *
 * Usage:
 *   bun run check-migrations
 *   bun run scripts/db/check-migrations.ts
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

const MIGRATIONS_DIR = path.join(import.meta.dir, "..", "..", "src", "db", "migrations");
const MIGRATION_FILENAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

async function checkMigrationPairing(): Promise<void> {
  let files: string[];
  try {
    files = await readdir(MIGRATIONS_DIR);
  } catch {
    console.error(`[ERROR] Migrations directory not found: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  // Collect up-migration stems and rollback stems separately
  const upMigrations = new Set<string>();
  const downMigrations = new Set<string>();
  const unrecognised: string[] = [];

  for (const file of files) {
    if (file.endsWith(".down.sql")) {
      downMigrations.add(file.slice(0, -".down.sql".length));
      continue;
    }
    if (!file.endsWith(".sql")) continue;
    if (!MIGRATION_FILENAME.test(file)) {
      unrecognised.push(file);
      continue;
    }
    upMigrations.add(file.slice(0, -".sql".length));
  }

  let ok = true;

  // 1. Every up-migration must have a paired .down.sql
  for (const stem of [...upMigrations].sort()) {
    if (!downMigrations.has(stem)) {
      console.error(`[ERROR] Missing rollback file: ${stem}.down.sql`);
      ok = false;
    }
  }

  // 2. Warn about orphaned .down.sql files (down without an up)
  for (const stem of [...downMigrations].sort()) {
    if (!upMigrations.has(stem)) {
      console.warn(`[WARN]  Orphaned rollback file has no matching up-migration: ${stem}.down.sql`);
    }
  }

  // 3. Warn about files that don't match the naming convention
  for (const file of unrecognised) {
    console.warn(`[WARN]  File does not match NNN_description.sql convention: ${file}`);
  }

  if (ok) {
    console.log(`[OK]    All ${upMigrations.size} migration(s) have paired rollback files`);
    process.exit(0);
  } else {
    process.exit(1);
  }
}

checkMigrationPairing().catch((err) => {
  console.error("[ERROR] check-migrations failed:", err);
  process.exit(1);
});
