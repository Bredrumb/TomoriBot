import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { executeMaintenanceSql } from "../../../deploy/azure/sql-maintenance";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("SQL maintenance transaction", () => {
  beforeAll(async () => {
    await setupTestDb();
    await testSql`CREATE TABLE _rt_maintenance (value INTEGER NOT NULL)`;
  });
  afterAll(async () => {
    await testSql`DROP TABLE IF EXISTS _rt_maintenance`;
  });

  it("commits the complete file, including dollar-quoted blocks", async () => {
    expect(
      await executeMaintenanceSql(
        testSql,
        "INSERT INTO _rt_maintenance VALUES (1); DO $$ BEGIN INSERT INTO _rt_maintenance VALUES (2); END $$;",
      ),
    ).toBe(2);
    expect(await testSql<Array<{ value: number }>>`SELECT value FROM _rt_maintenance ORDER BY value`).toEqual([
      { value: 1 },
      { value: 2 },
    ]);
  });

  it("rolls earlier statements back when any statement fails", async () => {
    await expect(
      executeMaintenanceSql(testSql, "DROP TABLE _rt_maintenance; SELECT * FROM _rt_maintenance;"),
    ).rejects.toBeDefined();
    expect(await testSql<Array<{ value: number }>>`SELECT value FROM _rt_maintenance ORDER BY value`).toEqual([
      { value: 1 },
      { value: 2 },
    ]);
  });

  it("rejects file-owned transaction control before executing statements", async () => {
    for (const command of ["COMMIT", "-- leading comment\nROLLBACK", "/* leading comment */ BEGIN"]) {
      await expect(executeMaintenanceSql(testSql, `DELETE FROM _rt_maintenance; ${command};`)).rejects.toBeDefined();
    }
    expect(await testSql<Array<{ value: number }>>`SELECT value FROM _rt_maintenance ORDER BY value`).toEqual([
      { value: 1 },
      { value: 2 },
    ]);
  });
});
