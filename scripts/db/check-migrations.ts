/**
 * Migration rollback pairing + numbering-uniqueness check.
 *
 * Verifies two invariants over src/db/migrations/:
 *   - Every up-migration (NNN_description.sql) has a corresponding rollback
 *      file (NNN_description.down.sql).
 *   - No two up-migrations share the same NNN prefix. Two open PRs can each
 *      pick the next free number off `main` and merge without a git conflict
 *      (different descriptions), silently landing two NNN_* files. This gate
 *      turns that into a loud failure for whichever PR merges second, whose
 *      fix is a one-line rename.
 *
 * Exits with code 1 if either invariant is violated so CI/`bun run vl` catches
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

  // Every up-migration must have a paired .down.sql
  for (const stem of [...upMigrations].sort()) {
    if (!downMigrations.has(stem)) {
      console.error(`[ERROR] Missing rollback file: ${stem}.down.sql`);
      ok = false;
    }
  }

  for (const stem of [...downMigrations].sort()) {
    if (!upMigrations.has(stem)) {
      console.warn(`[WARN]  Orphaned rollback file has no matching up-migration: ${stem}.down.sql`);
    }
  }

  // Uniqueness: no two up-migrations may share an NNN prefix.
  //    A duplicate number means the runner has to tie-break two migrations
  //    that were each authored as "the next one" — an ordering hazard and a
  //    review-clarity hazard. Group stems by their 3-digit prefix and fail on
  //    any group with more than one member.
  const byNumber = new Map<string, string[]>();
  for (const stem of upMigrations) {
    const num = stem.slice(0, 3); // "043" from "043_description"
    const group = byNumber.get(num) ?? [];
    group.push(stem);
    byNumber.set(num, group);
  }
  for (const [num, stems] of [...byNumber].sort()) {
    if (stems.length > 1) {
      console.error(`[ERROR] Duplicate migration number ${num}: ${stems.sort().join(", ")}`);
      console.error("        Rename the newer file(s) to the next free number so ordering stays unambiguous.");
      ok = false;
    }
  }

  for (const file of unrecognised) {
    console.warn(`[WARN]  File does not match NNN_description.sql convention: ${file}`);
  }

  if (ok) {
    console.log(`[OK]    All ${upMigrations.size} migration(s) have paired rollbacks and unique numbers`);
    process.exit(0);
  } else {
    process.exit(1);
  }
}

checkMigrationPairing().catch((err) => {
  console.error("[ERROR] check-migrations failed:", err);
  process.exit(1);
});
