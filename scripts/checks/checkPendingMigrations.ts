#!/usr/bin/env bun
/**
 * checkPendingMigrations.ts: pre-deploy destructive-migration gate.
 *
 * Scans the migrations directory, queries the target database's
 * `schema_migrations` table to determine which migrations are pending,
 * then inspects each pending up-migration for destructive SQL patterns
 * (DROP TABLE/COLUMN/CONSTRAINT/INDEX/TYPE, TRUNCATE, unfiltered DELETE,
 *  ALTER COLUMN ... TYPE).
 *
 * Exit codes:
 *   0: no pending migrations, or all pending migrations are non-destructive
 *   1: at least one pending migration contains a destructive pattern
 *   2: script error (DB connection failed, migrations dir missing, etc.)
 *
 * Usage:
 *   bun run scripts/checks/checkPendingMigrations.ts                       (DB-aware: pending only)
 *   bun run scripts/checks/checkPendingMigrations.ts --all                 (no DB: scan every up-migration)
 *   bun run scripts/checks/checkPendingMigrations.ts --changed-since REF   (no DB: only migrations added since REF)
 *
 * The CI deploy gate uses --changed-since because GitHub-hosted runners don't
 * hold production DB credentials at the pre-Terraform stage. Local pre-push
 * hooks can use --all for a no-DB sanity check.
 *
 * See docs/guides/safe-migration.md (the (Checkpoint) convention) for the
 * commit-message lever that satisfies this gate.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const MIGRATIONS_DIR = path.join(import.meta.dir, "..", "..", "src", "db", "migrations");
const MIGRATION_FILENAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

/**
 * Conservative regex matchers for destructive SQL patterns.
 * Case-insensitive; multiline. Each entry maps a label to its pattern.
 *
 * Notes on the choices:
 * - `DELETE FROM` is flagged only when no `WHERE` appears in the same statement.
 *   We approximate "same statement" as "before the next semicolon".
 * - `ALTER COLUMN ... TYPE` is flagged because changing a column type can
 *   silently truncate or fail to cast; routine ADD/RENAME is left alone.
 * - `DROP CONSTRAINT IF EXISTS` is flagged because even idempotent drops change
 *   schema shape and may invalidate dependent code.
 */
const DESTRUCTIVE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/i },
  { label: "DROP COLUMN", pattern: /\bDROP\s+COLUMN\b/i },
  { label: "DROP CONSTRAINT", pattern: /\bDROP\s+CONSTRAINT\b/i },
  { label: "DROP INDEX", pattern: /\bDROP\s+INDEX\b/i },
  { label: "DROP TYPE", pattern: /\bDROP\s+TYPE\b/i },
  { label: "DROP FUNCTION", pattern: /\bDROP\s+FUNCTION\b/i },
  { label: "TRUNCATE", pattern: /\bTRUNCATE\b/i },
  { label: "ALTER COLUMN ... TYPE", pattern: /\bALTER\s+COLUMN\s+\w+\s+(?:SET\s+DATA\s+)?TYPE\b/i },
];

/**
 * Strips SQL comments before pattern matching so a `-- DROP TABLE foo` line
 * in a doc comment doesn't trip the gate.
 */
function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "") // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ""); // block comments
}

/**
 * Detects unfiltered `DELETE FROM` (no WHERE clause before the next `;`).
 * Run separately from the regex map because the WHERE-presence check is
 * statement-scoped rather than a single pattern.
 */
function findUnfilteredDeletes(sql: string): string[] {
  const matches: string[] = [];
  const deleteRegex = /\bDELETE\s+FROM\s+([\w."]+)/gi;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration idiom
  while ((m = deleteRegex.exec(sql)) !== null) {
    const start = m.index;
    const nextSemicolon = sql.indexOf(";", start);
    const stmt = nextSemicolon === -1 ? sql.slice(start) : sql.slice(start, nextSemicolon);
    if (!/\bWHERE\b/i.test(stmt)) {
      matches.push(`DELETE FROM ${m[1]} (no WHERE)`);
    }
  }
  return matches;
}

interface PendingFile {
  name: string;
  filePath: string;
}

/**
 * Lists all up-migration files in the migrations dir, sorted by version.
 * Excludes `.down.sql` rollbacks and any file not matching the version-prefixed naming.
 */
async function listAllUpMigrations(): Promise<PendingFile[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files
    .filter((f) => MIGRATION_FILENAME.test(f) && !f.endsWith(".down.sql"))
    .sort()
    .map((name) => ({ name: name.replace(/\.sql$/, ""), filePath: path.join(MIGRATIONS_DIR, name) }));
}

/**
 * Queries the target DB for the set of already-applied migration names,
 * then filters the up-migration list down to pending entries only.
 * Imported lazily so `--all` mode never opens a DB connection.
 */
async function listPendingMigrationsViaDb(allUp: PendingFile[]): Promise<PendingFile[]> {
  const { sql } = await import("@/utils/db/client");
  try {
    const rows = await sql<{ name: string }[]>`SELECT name FROM schema_migrations`;
    const applied = new Set(rows.map((r) => r.name));
    return allUp.filter((m) => !applied.has(m.name));
  } catch (err) {
    // If the schema_migrations table doesn't exist yet, every up-migration is pending.
    // We surface the error so the operator knows the DB was untracked, but proceed.
    const msg = err instanceof Error ? err.message : String(err);
    if (/schema_migrations.*does not exist/i.test(msg)) {
      console.warn("schema_migrations table not found; treating ALL up-migrations as pending.");
      return allUp;
    }
    throw err;
  }
}

interface ScanResult {
  file: string;
  findings: string[];
}

async function scanForDestructive(files: PendingFile[]): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  for (const file of files) {
    const raw = await readFile(file.filePath, "utf8");
    const sql = stripComments(raw);
    const findings: string[] = [];

    for (const { label, pattern } of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(sql)) findings.push(label);
    }
    findings.push(...findUnfilteredDeletes(sql));

    if (findings.length > 0) {
      results.push({ file: file.name, findings });
    }
  }
  return results;
}

/**
 * Uses `git diff --diff-filter=A` to list up-migration files added between
 * `ref` and HEAD. Files renamed or modified are intentionally excluded because only
 * newly-added migrations matter to a pre-deploy gate.
 */
async function listMigrationsAddedSince(ref: string, allUp: PendingFile[]): Promise<PendingFile[]> {
  const proc = Bun.spawn(
    ["git", "diff", "--diff-filter=A", "--name-only", `${ref}...HEAD`, "--", "src/db/migrations/"],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`git diff failed (exit ${exitCode}): ${stderr.trim()}`);
  }
  const added = new Set(
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".sql") && !line.endsWith(".down.sql"))
      .map((line) => path.basename(line, ".sql")),
  );
  return allUp.filter((m) => added.has(m.name));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const useAll = argv.includes("--all");
  const sinceIdx = argv.indexOf("--changed-since");
  const sinceRef = sinceIdx >= 0 ? argv[sinceIdx + 1] : undefined;

  if (sinceIdx >= 0 && !sinceRef) {
    console.error("--changed-since requires a git ref argument (e.g. --changed-since HEAD~1)");
    process.exit(2);
  }

  const allUp = await listAllUpMigrations();
  const candidates = sinceRef
    ? await listMigrationsAddedSince(sinceRef, allUp)
    : useAll
      ? allUp
      : await listPendingMigrationsViaDb(allUp);

  if (candidates.length === 0) {
    console.log("No pending migrations to scan.");
    process.exit(0);
  }

  const modeLabel = sinceRef ? `added-since-${sinceRef}` : useAll ? "all" : "pending";
  console.log(`Scanning ${candidates.length} migration(s) [${modeLabel}] for destructive SQL...`);
  const destructive = await scanForDestructive(candidates);

  if (destructive.length === 0) {
    console.log("All migrations are non-destructive.");
    process.exit(0);
  }

  console.error("\nDestructive pending migrations detected:\n");
  for (const r of destructive) {
    console.error(`  ${r.file}`);
    for (const f of r.findings) console.error(`    - ${f}`);
  }
  console.error(
    "\nDeploy gate failed: this deploy contains destructive migrations without a snapshot.",
    "\nResolve by EITHER:",
    "\n  - adding '(Checkpoint)' to the deploy commit message (triggers an RDS/Cloud SQL snapshot before migration), OR",
    "\n  - dispatching the deploy workflow manually with create_db_snapshot=true.",
    "\nSee docs/guides/safe-migration.md for the full (Checkpoint) convention.",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("checkPendingMigrations: unexpected error:", err instanceof Error ? err.stack : err);
  process.exit(2);
});
