/**
 * Advisory IDs `bun audit` is told to skip, shared by `auditClean.ts` and `vl.ts` so a local run
 * and the `validation.yml` gate never disagree about what blocks. The same list is mirrored as a
 * `run:` flag in `.github/workflows/validation.yml`, and container-scan equivalents live in
 * `.trivyignore`.
 *
 * Every entry needs a justification and a retirement condition in
 * `docs/contributing/dependency-security-policy.md`. `bun audit --ignore` matches by advisory ID
 * across the WHOLE tree, not per dependency path, so an entry keeps hiding the advisory even if a
 * later dependency change puts the package on a reachable path.
 */
export const AUDIT_IGNORED_ADVISORIES: readonly string[] = [
  // ip-address Address4 octal/SSRF. Reached only via matrix-appservice-bridge > ip-cidr, and no
  // ip-cidr release runs on a patched ip-address: v10 removed `bigInteger()`, which ip-cidr needs
  // at 20+ call sites (v3 requires ip-address ^7.1.0, v4 requires ^9.0.5, both vulnerable).
  // Retire when ip-cidr ships a release supporting ip-address >= 10.3.1.
  "GHSA-mwp4-54f8-5fhr",
];
