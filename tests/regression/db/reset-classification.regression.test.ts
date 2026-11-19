import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  PERSONAL_IDENTITY_AUDIT_COLUMNS,
  PERSONAL_SINGLETON_RESET_TABLES,
  SERVER_COLLECTION_RESET_TABLES,
  SERVER_IDENTITY_AUDIT_COLUMNS,
  SERVER_SINGLETON_RESET_TABLES,
  type SingletonResetClassification,
} from "@/utils/db/repositories/ResetRepository";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

interface ColumnRow {
  table_name: string;
  column_name: string;
  column_default: string | null;
  is_nullable: "YES" | "NO";
}

const columnsByTable = new Map<string, ColumnRow[]>();

// PostgreSQL resolves `DEFAULT` to `NULL` on nullable columns without an explicit default, so only `NOT NULL` columns
// without a default fail reset at runtime.
function isDefaultAssignable(column: ColumnRow): boolean {
  return column.column_default !== null || column.is_nullable === "YES";
}

function classifiedTableNames(): string[] {
  return [
    ...SERVER_SINGLETON_RESET_TABLES.map((entry) => entry.table),
    ...PERSONAL_SINGLETON_RESET_TABLES.map((entry) => entry.table),
    ...SERVER_COLLECTION_RESET_TABLES,
  ];
}

describe.skipIf(!DB_TESTS_AVAILABLE)("Reset classification: regression", () => {
  beforeAll(async () => {
    await setupTestDb();
    // Filtered in TypeScript rather than by `= ANY($1)`: Bun SQL binds a JS array as one scalar
    // parameter, which Postgres rejects as a malformed array literal.
    const wanted = new Set(classifiedTableNames());
    const rows = await testSql<ColumnRow[]>`
      SELECT table_name, column_name, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `;
    for (const row of rows) {
      if (!wanted.has(row.table_name)) continue;
      const existing = columnsByTable.get(row.table_name);
      if (existing) existing.push(row);
      else columnsByTable.set(row.table_name, [row]);
    }
  });

  afterAll(() => {
    columnsByTable.clear();
  });

  it("classifies exactly 19 server singleton tables", () => {
    expect(SERVER_SINGLETON_RESET_TABLES).toHaveLength(19);
  });

  it("classifies exactly 13 server collection tables", () => {
    expect(SERVER_COLLECTION_RESET_TABLES).toHaveLength(13);
  });

  it("classifies exactly 2 personal singleton tables", () => {
    expect(PERSONAL_SINGLETON_RESET_TABLES).toHaveLength(2);
  });

  it("names each classified table exactly once", () => {
    const names = classifiedTableNames();
    expect([...new Set(names)]).toHaveLength(names.length);
  });

  const singletonCases: Array<[SingletonResetClassification, readonly string[]]> = [
    ...SERVER_SINGLETON_RESET_TABLES.map(
      (entry) => [entry, SERVER_IDENTITY_AUDIT_COLUMNS] as [SingletonResetClassification, readonly string[]],
    ),
    ...PERSONAL_SINGLETON_RESET_TABLES.map(
      (entry) => [entry, PERSONAL_IDENTITY_AUDIT_COLUMNS] as [SingletonResetClassification, readonly string[]],
    ),
  ];

  for (const [entry, identityAudit] of singletonCases) {
    describe(entry.table, () => {
      it("exists in the migrated database", () => {
        expect(columnsByTable.get(entry.table) ?? []).not.toHaveLength(0);
      });

      it("classifies every column the migrated database actually has", () => {
        const classified = new Set([...entry.reset, ...entry.preserved, ...identityAudit]);
        const unclassified = (columnsByTable.get(entry.table) ?? [])
          .map((column) => column.column_name)
          .filter((name) => !classified.has(name))
          .map((name) => `${entry.table}.${name}`);
        expect(unclassified).toEqual([]);
      });

      it("classifies no column the migrated database lacks", () => {
        const live = new Set((columnsByTable.get(entry.table) ?? []).map((column) => column.column_name));
        const phantom = [...entry.reset, ...entry.preserved]
          .filter((name) => !live.has(name))
          .map((name) => `${entry.table}.${name}`);
        expect(phantom).toEqual([]);
      });

      it("never classifies a column as both reset and preserved", () => {
        const preserved = new Set(entry.preserved);
        const overlap = entry.reset.filter((name) => preserved.has(name)).map((name) => `${entry.table}.${name}`);
        expect(overlap).toEqual([]);
      });

      it("keeps identity and audit columns out of both classifications", () => {
        const identity = new Set(identityAudit);
        const leaked = [...entry.reset, ...entry.preserved]
          .filter((name) => identity.has(name))
          .map((name) => `${entry.table}.${name}`);
        expect(leaked).toEqual([]);
      });

      it("can assign SQL DEFAULT to every reset column", () => {
        const byName = new Map((columnsByTable.get(entry.table) ?? []).map((column) => [column.column_name, column]));
        const unassignable = entry.reset
          .filter((name) => {
            const column = byName.get(name);
            return column !== undefined && !isDefaultAssignable(column);
          })
          .map((name) => `${entry.table}.${name}`);
        expect(unassignable).toEqual([]);
      });
    });
  }

  for (const table of SERVER_COLLECTION_RESET_TABLES) {
    it(`${table} exists and is deletable by server_id`, () => {
      const names = (columnsByTable.get(table) ?? []).map((column) => column.column_name);
      expect(names).toContain("server_id");
    });
  }

  it("defaults users.language_pref to the locale the localizer resolves", () => {
    const languagePref = (columnsByTable.get("users") ?? []).find((column) => column.column_name === "language_pref");
    expect(languagePref?.column_default).toContain("en-US");
  });

  // Fresh databases take defaults from schema.sql without replaying migrations, so only this test exercises migration
  // 079 for existing databases.
  it("migrates the users.language_pref default in both directions", async () => {
    const readDefault = async (): Promise<string | null> => {
      const [row] = await testSql<Array<{ column_default: string | null }>>`
        SELECT column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'language_pref'
      `;
      return row?.column_default ?? null;
    };

    const migrationsDir = join(import.meta.dir, "..", "..", "..", "src", "db", "migrations");

    // Every DB regression file shares one disposable database, and sibling fixtures insert `users`
    // rows that rely on this default. Re-applying the up migration from `finally` keeps a failed
    // assertion here from surfacing as an unrelated failure in a later file.
    await executeTestSqlFile(join(migrationsDir, "079_language_pref_default_en_us.down.sql"));
    try {
      const rolledBack = await readDefault();
      expect(rolledBack).toContain("'en'");
      expect(rolledBack).not.toContain("en-US");
    } finally {
      await executeTestSqlFile(join(migrationsDir, "079_language_pref_default_en_us.sql"));
    }
    expect(await readDefault()).toContain("en-US");
  });
});
