import { describe, expect, it } from "bun:test";
import { buildIntegerParameterList } from "@/utils/db/parameterBinding";

describe("buildIntegerParameterList", () => {
  it("numbers placeholders from $1 for every distinct id, in first-seen order", () => {
    const { values, placeholders } = buildIntegerParameterList([9, 3, 9, 12]);

    expect(values).toEqual([9, 3, 12]);
    expect(placeholders).toBe("$1, $2, $3");
  });

  it("keeps the placeholder count equal to the bound parameter count", () => {
    // The two halves are consumed separately (query text and bind array), so a mismatch here is a
    // protocol-level failure rather than a wrong result.
    for (const ids of [[], [1], [1, 2, 3], [5, 5, 5, 5, 6]]) {
      const { values, placeholders } = buildIntegerParameterList(ids);
      const placeholderCount = placeholders.length === 0 ? 0 : placeholders.split(", ").length;
      expect(placeholderCount).toBe(values.length);
    }
  });

  it("leaves an empty list with no placeholders so the caller can skip the query", () => {
    expect(buildIntegerParameterList([])).toEqual({ values: [], placeholders: "" });
  });
});
