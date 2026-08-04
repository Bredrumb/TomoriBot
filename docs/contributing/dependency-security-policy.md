---
title: "Dependency Security Policy"
---

TomoriBot pins, patches, and occasionally excuses third-party packages. This page explains which
of those three tools to reach for, where each security gate lives, and how an accepted advisory
gets recorded so it can be retired later.

Nearly every advisory TomoriBot sees is **transitive**: the vulnerable package is a dependency of a
dependency, so bumping our own `dependencies` block does nothing. The fix almost always belongs in
`overrides`.

## The three mechanisms

Reach for these in order. Stop at the first one that works.

### 1. `overrides` (the default)

An entry in the `overrides` block of `package.json` forces a transitive package to a patched
version for the whole tree. This resolves the large majority of advisories and is the only
mechanism that actually changes what `bun audit` and Trivy see, because both grade **resolved
lockfile versions**.

Two forms are available:

- Global: `"sanitize-html": ">=2.17.5"` applies everywhere.
- Scoped: `"body-parser>qs": "6.15.2"` applies to one parent only.

Prefer a floor (`>=`) over an exact pin so future patch releases arrive without another edit. Note
that a scoped override does not always win against a parent's exact pin. When it does not take,
bumping the parent is usually cleaner: `express-rate-limit` pinned `ip-address` to exactly `10.1.0`
until `8.6.1` widened it to `^10.2.0`, which let the patched version resolve normally.

An override can force a package past what its parent declares. That is the point, but it is also
how you break things, so verify afterwards (see [Verifying](#verifying-a-dependency-change)).

### 2. `patches/` (narrow, and never for logic)

A `patchedDependencies` entry edits an installed package in place. The existing patches define the
boundary: they bump a manifest, add a compatibility shim, or replace an unusable module with
lazy-throw stubs. **None of them reimplement library behavior**, and new ones should not either.

The useful line: patch when you are changing *metadata* or *failure behavior*. Do not patch when
the only fix would mean owning someone else's *algorithm*.

Rewriting a library's internals is how you introduce a worse bug than the one you set out to fix,
especially in security-relevant code such as address parsing or range math. A patch also does not
help with `bun audit`, which reads resolved versions from the lockfile and cannot see that the
installed files were modified. If the resolution still points at a flagged version, you will carry
the patch *and* still need an exception.

See `patches/README.md` for the per-patch justifications and the revert procedure.

### 3. Audit exceptions (last resort)

When no version combination is both patched and functional, record an exception. This is an
accepted risk, not a fix, so it requires a justification and a retirement condition below.

## Where the gates live

Four places run a security gate, and they do not share a mechanism:

| Gate | Command | Blocking | Ignore mechanism |
|---|---|---|---|
| `.github/workflows/validation.yml` | `bun audit --audit-level=high` | Yes, on every PR | `--ignore=<ID>` |
| `bun run audit:clean` | `bun audit --audit-level=high` | Yes, locally | `--ignore=<ID>` |
| `bun run vl` | `bun audit` | No, warning only | `--ignore=<ID>` |
| Deploy workflows (AWS, Azure, GCP) | Trivy container scan | Yes, at deploy | `.trivyignore` |

The two mechanisms are independent. `bun audit` never reads `.trivyignore`, and Trivy never reads
the `--ignore` flags. An advisory that trips both gates needs an entry in both places.

The three `bun audit` call sites share one list, `AUDIT_IGNORED_ADVISORIES` in
`scripts/checks/lib/auditIgnores.ts`, so a local run and CI cannot disagree. The workflow repeats
the flag inline because a YAML `run:` step cannot import TypeScript; keep it in sync.

Trivy only scans what ships in the image. The Dockerfile installs with `--production`, so
devDependency advisories never reach that gate, while any production dependency does.

### Identifiers

`.trivyignore` and `--ignore` both match on the advisory ID as reported. Many npm advisories have
no CVE assigned, in which case the GHSA ID is the identifier to use. Confirm with
`bun audit --json`, which prints the exact `url` and shows a `cvss.score` of `0` with a null
`vectorString` when no CVE exists.

## Active exceptions

### `GHSA-mwp4-54f8-5fhr` — ip-address Address4 octal parsing (high)

- **Path:** `matrix-appservice-bridge > ip-cidr > ip-address`
- **Why it cannot be fixed:** ip-address v10 removed `bigInteger()`, which ip-cidr depends on at
  20+ call sites for its range arithmetic. No ip-cidr release runs on a patched ip-address:
  v3 requires `^7.1.0` and v4 requires `^9.0.5`, and every version at or below 10.3.0 is
  vulnerable. Forcing v10 makes `new IPCIDR(...)` throw at construction.
- **Why the risk is low:** ip-cidr is used only by the bridge's `ProvisioningApi`, which
  `bridge.js` never imports and TomoriBot never constructs. TomoriBot uses `Bridge` and
  `AppServiceRegistration` only.
- **Retire when:** ip-cidr ships a release supporting ip-address >= 10.3.1. Then drop the entry
  from `auditIgnores.ts`, `validation.yml`, and `.trivyignore`.

### `CVE-2026-25128` — fast-xml-parser (Trivy only)

Required by AWS SDK v3, where upgrading to v5 breaks functionality. Input comes from trusted AWS
endpoints. Tracked alongside the `@aws-sdk/xml-builder` patch that pins a fixed version in the
transitive tree.

## Adding an exception

1. Prove no override or manifest bump works. Record what you tried and how it failed.
2. Establish reachability: name the code path, and whether TomoriBot executes it.
3. Add the ID to `AUDIT_IGNORED_ADVISORIES`, to the `validation.yml` flag list, and to
   `.trivyignore` if the package ships in the image.
4. Add an entry above with the path, the reason, the risk assessment, and the retirement
   condition.

`bun audit --ignore` matches by advisory ID across the **whole tree**, not per dependency path. An
entry keeps hiding the advisory even if a later change puts the package on a reachable path, so
keep the recorded path accurate and re-check it when the dependency moves.

## Verifying a dependency change

`bun install` can leave `node_modules` disagreeing with `bun.lock`, and it is worse on Windows,
where an interrupted install leaves a `.old_modules-*` directory behind and serves stale copies.
Because `bun audit` grades the lockfile rather than the tree, it can report clean while the
installed tree still holds a vulnerable version. Resync before trusting any result:

```bash
rm -rf node_modules && bun install
```

Then run the gates:

```bash
bun run check
bun test
bun run vl
bun audit
```

When an override pushes a package past what its parent declares, test the parent's actual entry
point rather than assuming semver compatibility. Resolve from the **consumer's** location, not the
project root, or you will read a hoisted copy that is not the one the consumer loads:

```ts
import { createRequire } from "node:module";

const require = createRequire("<path to the consumer's package.json>");
console.log(require("<forced-package>/package.json").version);
```
