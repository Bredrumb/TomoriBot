import { describe, expect, it } from "bun:test";
import {
  auditRawSqlBoundary,
  classifyQuery,
  EXEMPT_PATHS,
  scanFileForSqlQueries,
} from "../../../scripts/checks/lib/sqlAudit";

/**
 * Enforces TomoriBot's raw-SQL boundary standard: every `sql`/`tx` template
 * literal must live inside `src/utils/db/repositories/` (or a small, explicitly
 * justified exemption list). The detector itself is shared with the
 * `bun run audit-sql` CLI (scripts/checks/lib/sqlAudit.ts) so the gate and this
 * test can never disagree.
 *
 * The synthetic-input tests below exist specifically to prove the detector has
 * NO false positives (it ignores SQL in comments and plain strings) and NO false
 * negatives (it still catches real tagged-template literals), so the headline
 * "zero violations" assertion is trustworthy rather than vacuously green.
 */

describe("scanFileForSqlQueries — true positives", () => {
  it("detects a single-line awaited sql literal", () => {
    const hits = scanFileForSqlQueries("const a = await sql`SELECT 1`;");
    expect(hits).toHaveLength(1);
    expect(hits[0].query).toBe("SELECT 1");
  });

  it("detects a multi-line literal and reports the opening line", () => {
    const src = ["const r = await sql`", "  UPDATE users", "  SET x = 1", "`;"].join("\n");
    const hits = scanFileForSqlQueries(src);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
    expect(hits[0].query).toContain("UPDATE users");
  });

  it("detects a typed (generic) sql literal", () => {
    const hits = scanFileForSqlQueries("const [row] = await sql<Array<{ id: number }>>`SELECT id FROM t`;");
    expect(hits).toHaveLength(1);
    expect(hits[0].query).toBe("SELECT id FROM t");
  });

  it("detects a transaction `tx` literal inside a callback", () => {
    const hits = scanFileForSqlQueries("await tx`INSERT INTO t (a) VALUES (1)`;");
    expect(hits).toHaveLength(1);
    expect(hits[0].query).toContain("INSERT INTO t");
  });
});

describe("scanFileForSqlQueries — false-positive guards", () => {
  it("ignores SQL inside a // line comment", () => {
    expect(scanFileForSqlQueries("// await sql`SELECT secret FROM users`")).toEqual([]);
  });

  it("ignores SQL inside a single-line block comment", () => {
    expect(scanFileForSqlQueries("/* await sql`DELETE FROM users` */ const x = 1;")).toEqual([]);
  });

  it("ignores SQL inside a multi-line block comment", () => {
    const src = ["/*", " * Example: await sql`UPDATE users SET x = 1`", " */", "const x = 1;"].join("\n");
    expect(scanFileForSqlQueries(src)).toEqual([]);
  });

  it("ignores a plain string that merely contains SQL text", () => {
    // Not a tagged template: just a string. Must not be flagged.
    expect(scanFileForSqlQueries('const note = "SELECT * FROM users";')).toEqual([]);
  });

  it("ignores identifiers that merely end in sql/tx", () => {
    // Word-boundary guard: `mysql`/`someSql`/`htx` are not the `sql`/`tx` tag.
    expect(scanFileForSqlQueries("const c = mysql`SELECT 1`;")).toEqual([]);
    expect(scanFileForSqlQueries("const c = someSql`SELECT 1`;")).toEqual([]);
  });
});

describe("classifyQuery", () => {
  it("treats a pure SELECT as a READ", () => {
    expect(classifyQuery("SELECT * FROM users WHERE id = 1")).toBe("READ");
  });

  it("does not misread a column that merely contains a keyword (updated_at)", () => {
    // `updated_at` contains "UPDATE" as a substring, so must still classify as READ.
    expect(classifyQuery("SELECT MAX(updated_at) AS last_updated FROM server_emojis")).toBe("READ");
  });

  it("treats INSERT/UPDATE/DELETE (and mixed) as WRITE", () => {
    expect(classifyQuery("INSERT INTO t (a) VALUES (1)")).toBe("WRITE");
    expect(classifyQuery("UPDATE t SET a = 1")).toBe("WRITE");
    expect(classifyQuery("DELETE FROM t")).toBe("WRITE");
    // A CTE that selects then writes is a WRITE.
    expect(classifyQuery("WITH x AS (SELECT 1) UPDATE t SET a = 1")).toBe("WRITE");
  });
});

describe("raw-SQL boundary (real source tree)", () => {
  it("has zero raw SQL outside the repository layer", async () => {
    const { violations } = await auditRawSqlBoundary();
    // Surface the offending locations in the failure message for fast triage.
    const detail = violations.map((v) => `${v.file}:${v.line} (${v.kind})`).join("\n");
    expect(violations, `Raw SQL found outside src/utils/db/repositories/:\n${detail}`).toEqual([]);
  });

  it("scanner is alive: known exempt files still produce classified hits", async () => {
    // Guards against a false-green where the detector silently stops matching:
    // if the scanner found nothing at all, `violations` would be trivially empty.
    const { exemptions } = await auditRawSqlBoundary();
    expect(exemptions.length).toBeGreaterThan(0);
    for (const hit of exemptions) {
      expect(EXEMPT_PATHS.has(hit.file)).toBe(true);
    }
  });
});
