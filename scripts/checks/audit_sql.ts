import { isVerboseOutput } from "./lib/gateOutput";
import { auditRawSqlBoundary, normalizePath } from "./lib/sqlAudit";

async function run() {
  const { violations, exemptions } = await auditRawSqlBoundary();

  const writes = violations.filter((v) => v.kind === "WRITE");
  const reads = violations.filter((v) => v.kind === "READ");

  // Omit exemption details on a clean quiet run because readers only need them when investigating violations or under
  // --verbose.
  if (writes.length > 0) {
    console.log("=== WRITES ===");
    for (const w of writes) console.log(`${normalizePath(w.file)}:${w.line}`);
  }
  if (reads.length > 0) {
    console.log("=== READS ===");
    for (const r of reads) console.log(`${normalizePath(r.file)}:${r.line}`);
  }
  if (exemptions.length > 0 && (violations.length > 0 || isVerboseOutput())) {
    console.log("=== EXEMPTIONS ===");
    for (const e of exemptions) console.log(`exempt: ${normalizePath(e.file)}:${e.line} (${e.kind}; ${e.reason})`);
  }

  if (violations.length > 0) {
    console.error(
      `\n❌ Found ${violations.length} raw SQL ${violations.length === 1 ? "query" : "queries"} outside ` +
        "src/utils/db/repositories/. Move them into a repository method, or add a justified exemption " +
        "in scripts/checks/lib/sqlAudit.ts (EXEMPT_PATHS).",
    );
    process.exit(1);
  }

  console.log(
    "✅ No raw SQL outside the repository layer " +
      `(${writes.length} writes, ${reads.length} reads, ${exemptions.length} exemptions).`,
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
