/**
 * Raw-SQL boundary audit (CLI).
 *
 * Reports every raw `sql`/`tx` template literal found outside the repository
 * layer and EXITS NON-ZERO when any genuine violation exists, so the
 * `bun run vl` "SQL Audit" gate enforces the standard (it previously only
 * printed and always passed). The actual scan lives in
 * `scripts/checks/lib/sqlAudit.ts` — shared with the unit test so the two can
 * never disagree.
 *
 * Run via `bun run audit-sql`.
 */

import { auditRawSqlBoundary, normalizePath } from "./lib/sqlAudit";

async function run() {
  const { violations, exemptions } = await auditRawSqlBoundary();

  const writes = violations.filter((v) => v.kind === "WRITE");
  const reads = violations.filter((v) => v.kind === "READ");

  console.log("=== WRITES ===");
  writes.forEach((w) => console.log(`${normalizePath(w.file)}:${w.line}`));
  console.log("\n=== READS ===");
  reads.forEach((r) => console.log(`${normalizePath(r.file)}:${r.line}`));
  console.log("\n=== EXEMPTIONS ===");
  exemptions.forEach((e) => console.log(`exempt: ${normalizePath(e.file)}:${e.line} (${e.kind}; ${e.reason})`));

  if (violations.length > 0) {
    console.error(
      `\n❌ Found ${violations.length} raw SQL ${violations.length === 1 ? "query" : "queries"} outside ` +
        "src/utils/db/repositories/. Move them into a repository method, or add a justified exemption " +
        "in scripts/checks/lib/sqlAudit.ts (EXEMPT_PATHS).",
    );
    process.exit(1);
  }

  console.log("\n✅ No raw SQL outside the repository layer.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
