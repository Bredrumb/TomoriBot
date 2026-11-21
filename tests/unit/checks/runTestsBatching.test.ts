import { describe, expect, it } from "bun:test";
import { buildFileBatches, MAX_TEST_BATCH_ARG_CHARS, planLanes } from "../../../scripts/checks/runTests";

describe("runTests batching", () => {
  it("splits shared unit and regression file lists within the command-line budget while keeping order", async () => {
    const unitFiles = Array.from(
      { length: 450 },
      (_, index) => `tests/unit/feature/exampleSuiteNumber_${String(index).padStart(3, "0")}.test.ts`,
    );
    const dbFiles = Array.from(
      { length: 450 },
      (_, index) => `tests/regression/db/exampleRegression_${String(index).padStart(3, "0")}.regression.test.ts`,
    );

    const lanes = await planLanes([...unitFiles, ...dbFiles]);
    const unitLane = lanes.find((lane) => lane.id === "unit");
    const dbLane = lanes.find((lane) => lane.id === "db");

    expect(unitLane).toBeDefined();
    expect(dbLane).toBeDefined();
    expect(unitLane?.batches.length).toBeGreaterThan(1);
    expect(dbLane?.batches.length).toBeGreaterThan(1);

    for (const lane of [unitLane, dbLane]) {
      for (const batch of lane?.batches ?? []) {
        const quotedChars = batch.files.reduce((sum, file) => sum + file.length + 3, 0);
        expect(quotedChars).toBeLessThanOrEqual(MAX_TEST_BATCH_ARG_CHARS);
      }
    }

    expect(unitLane?.batches.flatMap((batch) => batch.files)).toEqual(unitFiles);
    expect(dbLane?.batches.flatMap((batch) => batch.files)).toEqual(dbFiles);
  });

  it("keeps an oversized single path in its own batch without looping or dropping files", () => {
    const oversized = `tests/unit/${"a".repeat(MAX_TEST_BATCH_ARG_CHARS)}.test.ts`;
    const normal = "tests/unit/small.test.ts";

    const batches = buildFileBatches([normal, oversized, normal]);

    expect(batches).toEqual([{ files: [normal] }, { files: [oversized] }, { files: [normal] }]);
  });

  it("returns no batches for an empty file list", () => {
    expect(buildFileBatches([])).toEqual([]);
  });
});
