---
title: "Dependency Security Policy"
sidebar:
  order: 40
---

How to fix a dependency advisory, where each security gate runs, and how to record an advisory you
accept. Almost every advisory is transitive (a dependency of a dependency), so bumping a package in
`dependencies` rarely fixes it.

## Choose a fix

Try these in order and stop at the first that works.

1. **`overrides` in `package.json`.** Forces a transitive package to a patched version across the
   tree. It is the only fix `bun audit` and Trivy can see, because both read resolved lockfile
   versions. Use a floor (`"sanitize-html": ">=2.17.7"`) rather than an exact pin, or scope it to one
   parent (`"body-parser>qs": "6.15.2"`). A scoped override can lose to a parent's exact pin; then bump
   the parent instead, as `express-rate-limit@8.6.1` did by widening its `ip-address` range.
2. **`patches/`** (`patchedDependencies`). Only to change metadata or failure behavior: bump a manifest,
   add a compatibility shim, or replace an unusable module with stubs that throw when called. Never
   rewrite a library's logic; owning someone else's parsing or range math breaks more than it fixes. A
   patch does not change the lockfile, so `bun audit` still flags it. Reasons and revert steps for each
   patch are in `patches/README.md`.
3. **An audit exception**, when no version is both patched and working. See below.

## Gates

| Where | Command | Blocks | Ignore list |
|---|---|---|---|
| Deploy workflows, `security-dependencies` job | `bun run audit:clean` | Yes, the release | `AUDIT_IGNORED_ADVISORIES` |
| Deploy workflows, `security-container` job | Trivy image scan | Yes, the release | `.github/.trivyignore` |
| `bun run audit:clean` locally | `bun audit --audit-level=high` | Yes | `AUDIT_IGNORED_ADVISORIES` |
| `.github/workflows/validation.yml` | `bun audit --audit-level=high` | No: a PR's merge lockfile can carry advisories its author cannot fix | Inline `--ignore` flags |
| `bun run vl` | `bun audit` | No, warning | `AUDIT_IGNORED_ADVISORIES` |

`AUDIT_IGNORED_ADVISORIES` in `scripts/checks/lib/auditIgnores.ts` feeds `audit:clean` and `vl`.
`validation.yml` cannot import TypeScript, so it repeats the IDs; keep it in sync. `bun audit` never
reads `.trivyignore` and Trivy never reads `--ignore`, so an advisory caught by both needs both
entries. The image installs with `--production`, so Trivy never sees devDependency advisories.

Both lists match the advisory ID exactly as reported. Many npm advisories have no CVE, and then the
GHSA ID is the one to use: `bun audit --json` shows the `url`, and a missing CVE appears as a
`cvss.score` of `0` with a null `vectorString`.

## Active exceptions

**`CVE-2026-25128`, fast-xml-parser (Trivy only).** Required by AWS SDK v3; upgrading to v5 breaks it.
Its input comes only from AWS endpoints. The `@aws-sdk/xml-builder` patch pins a fixed version in the
transitive tree.

## Adding an exception

1. Show that no override or parent bump works, and record what you tried.
2. Name the code path that reaches the package and whether TomoriBot runs it.
3. Add the ID to `AUDIT_IGNORED_ADVISORIES` and the `validation.yml` flags, and to
   `.github/.trivyignore` if the package ships in the image.
4. Add an entry under Active exceptions with the path, reason, risk, and the condition for removing it.

An ignored ID is hidden everywhere in the tree, including dependency paths added later. If a change
puts the package on a reachable path, the exception keeps hiding it, so re-check the recorded path
whenever the dependency moves.

## Verifying a change

`bun audit` reads the lockfile, not `node_modules`, so it can pass while the installed tree still
holds the old version. On Windows an interrupted install also leaves a `.old_modules-*` folder that
serves stale copies. Reinstall before trusting any result:

```bash
rm -rf node_modules && bun install
bun run check
bun test
bun run vl
bun audit
```

When an override forces a package past its parent's declared range, test the parent's entry point.
Resolve from the parent's location, since the project root may hold a different hoisted copy:

```ts
import { createRequire } from "node:module";

const require = createRequire("<path to the consumer's package.json>");
console.log(require("<forced-package>/package.json").version);
```
