// bun audit --ignore suppresses IDs across the whole tree even if a path becomes reachable, so mirror edits in ci.yml
// and document retirement.
export const AUDIT_IGNORED_ADVISORIES: readonly string[] = [
  "GHSA-vfj7-8cjw-p6xm",
  "GHSA-w5hq-g745-h8pq",
  "GHSA-gcqx-w48m-w2h4",
];
