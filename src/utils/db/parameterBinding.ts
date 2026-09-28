/**
 * Parameter binding helpers for Bun's SQL client.
 *
 * Kept separate from `sqlSecurity.ts`, which validates identifiers that go into a query's text.
 * These helpers only produce positional placeholders for values that are still bound as
 * parameters, so nothing here becomes part of the SQL string.
 */

/** A positional parameter list and the placeholders that bind it. */
export interface PositionalParameterList {
  /**
   * Input values with duplicates removed, in first-seen order.
   *
   * Deduplicating keeps both the placeholder list and the bound parameter array proportional to
   * the distinct values rather than to how many times a caller repeated one.
   */
  values: number[];
  /** `$1, $2, ...` placeholders, one per entry in {@link values}. */
  placeholders: string;
}

/**
 * Builds a parameter list for an `IN (...)` predicate over integer ids.
 *
 * `ANY($1)` with an integer-array parameter is what this avoids: Bun SQL can intermittently fail
 * on that binding with protocol error `08P01`, and it fails on a query that works on every retry,
 * so it surfaces as sporadic repository failures rather than as a reproducible bug.
 *
 * @param ids - Integer ids to match; duplicates are collapsed
 */
export function buildIntegerParameterList(ids: readonly number[]): PositionalParameterList {
  const values = Array.from(new Set(ids));
  return { values, placeholders: values.map((_, index) => `$${index + 1}`).join(", ") };
}
