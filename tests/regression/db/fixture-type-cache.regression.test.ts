import { describe, expect, it } from "bun:test";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("fixture type replacement", () => {
  it("binds an existing query against a recreated database type", async () => {
    await setupTestDb();
    const query = async (value: string) =>
      await testSql<Array<{ value: string }>>`SELECT ${value}::_rt_fixture_type AS value`;
    await testSql`CREATE TYPE _rt_fixture_type AS ENUM ('first')`;
    try {
      expect(await query("first")).toEqual([{ value: "first" }]);
      await testSql`DROP TYPE _rt_fixture_type`;
      await testSql`CREATE TYPE _rt_fixture_type AS ENUM ('second')`;
      await setupTestDb();
      expect(await query("second")).toEqual([{ value: "second" }]);
      await expect(query("first")).rejects.toThrow();
    } finally {
      await testSql`DROP TYPE _rt_fixture_type`;
    }
  });
});
