---
title: "Development Tasks"
---

Quick navigation for common TomoriBot implementation tasks and coding conventions.

## Task Index

Each guide below is self-contained with steps, notes, and a quality gate.

| Task | Guide |
|---|---|
| Add a slash command | [`adding-slash-command.md`](/contributing/adding-slash-command/) |
| Add an event handler | [`adding-event-handler.md`](/contributing/adding-event-handler/) |
| Add a built-in tool | [`adding-builtin-tool.md`](/contributing/adding-builtin-tool/) |
| Add a DB column | [`adding-db-column.md`](/contributing/adding-db-column/) |
| Add a Full Install setup module | [`adding-setup-module.md`](/contributing/adding-setup-module/) |
| Add a locale | [`adding-locale/`](/contributing/adding-locale/) |
| Add a new AI provider | [`adding-new-provider.md`](/contributing/adding-new-provider/) |
| Add a feature flag-controlled tool | [`adding-feature-flag-tool.md`](/contributing/adding-feature-flag-tool/) |
| Add a persona preset | [`adding-persona-preset.md`](/contributing/adding-persona-preset/) |
| Add an environment variable | [`adding-env-variable.md`](/contributing/adding-env-variable/) |
| Add or move docs pages | [`docs-authoring.md`](/contributing/docs-authoring/) |
| Localize the docs site or READMEs | [`docs-site-localization.md`](/contributing/docs-site-localization/) |
| Write or review code comments | [`comment-policy.md`](/contributing/comment-policy/) |

## Development Checklist

Run these before merging any change:

```bash
bun run check           # TypeScript strict mode
bun run lint            # Biome lint/format
bun run check-locales   # locale keys (when locale keys or command metadata changed); non-English parity is advisory
bun run find-stale-translations --reason=unfollowed --base=origin/main  # branch follow-up, advisory
bun run db:lifecycle    # schema lifecycle test (when schema.sql changed; needs local PostgreSQL)
```

`bun run lint` applies fixes in place, so it can leave your working tree changed after it reports
success. Commit whatever it rewrites: CI runs `bun run lint:ci`, which is the same Biome check
without `--fix`, and that one fails on formatting instead of silently correcting it.

`bun run db:lifecycle` requires a local disposable PostgreSQL target with CREATE/DROP database
permission. It creates and drops its own temporary database, then tests fresh initialization plus
backup/restore and DB maintenance scripts.

To run selected regression files through the same disposable-database harness, pass their paths to
the test script:

```bash
bun run test tests/regression/db/llm.regression.test.ts
```

### One command for every gate

`bun run vl` runs the whole check suite and prints one verdict per gate, so it is the fastest way to
answer "is this branch green" without remembering each script name:

```bash
bun run vl
```

Its last line is machine readable, which matters when a wrapper or an agent reads the result rather
than a person:

```
vl-status: PASS exit=0 pass=<n> warn=<n> fail=<n> skip=<n>
```

**Output is quiet by default.** No flag means quiet; `--verbose` is opt-in. A gate that passes prints
nothing, and its row in the results block carries the verdict. A gate that fails always prints its full
detail, so quiet mode can never hide a finding; it only removes the passing noise around one. Advisory
detail, such as locale parity or the lockfile-wide `bun audit` listing, collapses to a count or to the
entries that changed the verdict.

Pass `--verbose` to restore every line each gate would otherwise print:

```bash
bun run vl --verbose
```

`--no-verbose` is the explicit spelling of the default rather than a mode of its own: it produces the
same output as passing nothing. It exists so `vl` can force quiet onto the checks it invokes, and it
wins over `--verbose` regardless of the order the two appear in. It is never required.

Individual gates accept both flags, and `vl` forwards one to them. Redirect the output to a file
if you want to keep the exit code while reading selectively, and never pipe a gate through `grep` or
`tail`: the pipeline reports the filter's exit status instead of the gate's.

```bash
bun run vl > /tmp/vl.log 2>&1; echo "VL_EXIT=$?" >> /tmp/vl.log
```

---

## Coding Conventions

These rules apply to all TomoriBot source code regardless of task type.

### Formatting and Style

- Use 2 spaces for indentation (Biome project setting).
- Use double quotes for strings.
- Write comments that explain rationale, constraints, or non-obvious behavior. See the
  [`comment policy`](./comment-policy).
- Run `bun run lint` after edits.

### TypeScript and Validation

- Keep TypeScript strict; avoid `any`.
- Prefer explicit shared types under `src/types/`.
- Use Zod/runtime validation for untrusted external input.
- Add concise JSDoc for exported/public functions when behavior is non-obvious.

### File Organization and Imports

- Use `camelCase` file names.
- Use `@/*` path aliases for `src/*` imports.
- Use `node:` protocol for Node built-ins (`node:path`, `node:fs`, etc.).

### Configuration and Magic Numbers

- Give a magic number a name: a constant in the module that owns it, with a comment when the value
  was measured or comes from an external limit.
- Promote a value to an environment variable only when it is a deployment boundary: host resources,
  network behavior, external service credentials or quotas, or an operator choice that reasonably
  varies between installations. Internal probabilities, parser lookbacks, UI geometry, and algorithm
  tuning stay constants unless a concrete deployment use case proves otherwise.
- One variable per setting. Do not add an engine-specific variable plus a shared fallback for the
  same value.
- Settings a server or user changes at runtime belong in the database, not the environment.
- See [`adding-env-variable.md`](./adding-env-variable) for placement and naming once a variable
  passes this test.

### Database and Migrations

- Use Bun SQL template literals for queries.
- Keep schema migrations idempotent (`IF NOT EXISTS`, helper functions, guarded blocks).
- For DB model details, see [`docs/en/architecture/subsystems/database-schema.md`](../subsystems/database-schema).

### Cache-Safe Write Pattern

When a write affects cached reads:

1. Perform the DB write successfully.
2. Then invalidate affected cache key(s).

Do not invalidate before failed writes, and do not manually mutate cached objects.
See [`docs/en/architecture/subsystems/caching.md`](../subsystems/caching) for the cache map and invalidation APIs.

### Logging and Error Handling

- Use `log` from `src/utils/misc/logger.ts`.
- Include useful context metadata (`errorType`, IDs, action context).
- Treat startup-critical failures differently from recoverable runtime failures.

### Discord Command Rules

- Slash commands only (no legacy prefix command surface).
- All user-facing text must be localized via `localizer()`.
- Follow interaction timing patterns in [`docs/en/architecture/subsystems/command-system.md`](../subsystems/command-system).

---

## Proportionality

Every test, variable, CI job, abstraction, and comment has a maintenance cost. Add one when it
prevents a named failure, not because a category of change usually has one.

### Reuse and abstraction

- Search for an existing helper, registry, or pattern before writing a new one, and extend it.
- Extract a shared helper when a second real caller exists, not for an anticipated one.
- Fix a bug in the shared function after checking every caller.
- Do not add compatibility shims, fallback paths, or options for states the code cannot reach.
  Validate at trust boundaries and trust typed internal values.
- File size alone does not justify a split. Name the maintenance or correctness problem.

### Tests

- Test behavior, regression risk, or an interface other code depends on (an exported API, a stored
  data shape, a Discord limit). A bug fix gets the regression test that would have caught it.
- Do not test that wiring or a helper merely exists.
- Loop locales or panels inside one test that collects every failure, instead of generating one test
  per locale. `expectForEveryLocale` and `collectCaseFailures` in `tests/helpers/localeCases.ts` do
  the collecting.
- Assert localized copy by key, never by quoting its English. Use `localizedCopy(locale, key)`, or
  `localizedProse` when panel formatting may wrap the line. Both fail on an unknown key, so a copy
  edit passes while a wrong or deleted key does not. Quote a literal only for an identifier, such
  as a command name, or for text the test itself supplied.
- Assert an exact count or a complete member list only when that exact count or list is what must
  not change. Otherwise assert stable IDs, uniqueness, or that the required members are present.
- Optional local servers (`servers/`), installers, and devtools do not get dedicated test suites or
  CI jobs by default.
- A function whose only remaining caller is a test is dead code; delete both.
- Add CI coverage only when unattended enforcement is valuable and the environment is supportable.
- Before a broad audit, write the candidate filter and the decision rubric.

### Review findings

Give every finding, from an agent or a human, one disposition before implementation:

| Disposition | Meaning |
|---|---|
| Accept now | Fix it in this change. |
| Defer | Record the concrete trigger that will make it worth doing. |
| Not worth it | Real, but the fix costs more to carry than the risk it removes. |
| Reject | The premise is false or already handled. |

Severity describes impact if the finding is real. It does not make a fix mandatory. A
recommendation states its expected value, its implementation and maintenance cost, and the source
evidence for its premise. Implement only accepted findings.
