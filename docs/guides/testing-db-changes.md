<!-- ARCH-ALIGNMENT: prereq-phase-2 -->

# Testing DB Changes

This guide covers the DB regression harness introduced in Phase 2 (#4a). The harness protects the data-access layer during the repository migration (#4b) and any future DB-touching work.

## TL;DR

```bash
# Run all tests — DB tests run automatically when Postgres is reachable
bun run test
```

No manual database creation is required. `bun run test` detects a local Postgres connection, creates a disposable `tomoribot_test_<id>` database, runs the full test suite against it, and drops the database on exit.

## How automatic provisioning works

`bun run test` invokes `scripts/checks/runTests.ts`, which:

1. Looks for Postgres credentials in `POSTGRES_PASSWORD`, `DATABASE_URL`, or `POSTGRES_URL`.
2. If credentials exist, probes the connection (5-second timeout).
3. On success, creates a disposable `tomoribot_test_<id>` database via the `postgres` maintenance database.
4. Spawns `bun test tests/` with `TEST_DB_READY=1` and `POSTGRES_DB=<name>` injected into the child environment.
5. Drops the database on clean exit, `SIGINT` (Ctrl+C), or `SIGTERM`.

If no Postgres credentials are found or the connection probe fails, `bun test tests/` still runs — DB regression tests skip gracefully and unit tests still pass.

## Minimum setup

The only required environment variable is `POSTGRES_PASSWORD` (or a full `DATABASE_URL`). All other variables default to local Postgres:

| Variable | Default |
|---|---|
| `POSTGRES_PASSWORD` | *required* |
| `POSTGRES_HOST` | `localhost` |
| `POSTGRES_PORT` | `5432` |
| `POSTGRES_USER` | `postgres` |
| `POSTGRES_MAINTENANCE_DB` | `postgres` |

A minimal `.env` for contributors:

```env
POSTGRES_PASSWORD=your_local_postgres_password
```

## Running tests

```bash
# Run all tests (DB tests provisioned automatically when Postgres is reachable)
bun run test

# Run a single domain without the wrapper (requires TEST_DB_READY=1)
TEST_DB_READY=1 POSTGRES_DB=<existing-db> POSTGRES_PASSWORD=<pw> bun test tests/regression/db/persona.regression.test.ts

# Run only unit tests (no DB needed)
bun test tests/unit/
```

## How DB_TESTS_AVAILABLE works

`tests/regression/db/setup/testDb.ts` exports `DB_TESTS_AVAILABLE`, which is true only when:

- `POSTGRES_PASSWORD` (or `TEST_POSTGRES_PASSWORD`) is set, **and**
- `TEST_DB_READY=1` is present in the environment.

`TEST_DB_READY=1` is set exclusively by `runTests.ts` after it has successfully created and verified the disposable database. This prevents the harness from running against a development or production database if `bun test tests/regression/db/` is invoked directly.

All DB regression `describe` blocks call `describe.skipIf(!DB_TESTS_AVAILABLE)` so they skip cleanly instead of failing when run without the wrapper.

## Test file map

| File | Domain | Functions covered |
|---|---|---|
| `user.regression.test.ts` | UserRepository | `loadUserRow`, `registerUser`, `setPrivacyLevel`, `updateUser` |
| `persona.regression.test.ts` | PersonaRepository | `loadTomoriState`, `loadAllPersonasForServer`, `loadPersonaConfigRow`, `updateTomori` |
| `memory.regression.test.ts` | ServerMemory + PersonalMemory | `addServerMemoryByTomori`, `addPersonalMemoryByTomori`, `loadPersonalMemoriesForUserLineage` |
| `config.regression.test.ts` | ConfigRepository | `loadTomoriState` (config portion), split config updates, `updateCapabilitiesAndMemberPermissionsConfig` |
| `llm.regression.test.ts` | LlmRepository | `loadAvailableLlms`, `loadLlmById`, `getLlmsByIds`, `loadSmartestModel`, `loadUniqueProviders` |
| `server.regression.test.ts` | ServerRepository | `isBlacklisted`, blacklist write/clear cycle |
| `tool-rag.regression.test.ts` | ToolRepository + RagRepository | `getBraveApiKeyStatus`, guild MCP config read, `detectRagAvailability` |
| `cache-invalidation.regression.test.ts` | All caches | write → invalidate → re-read cycle for user cache and tomori state cache |

## Fixture data

The harness inserts minimal rows using the `_rt_` prefix (regression test) for all fixture Discord IDs:

| Fixture | Discord ID / value |
|---|---|
| Test server | `_rt_server_001` |
| Test user | `_rt_user_001` |
| Registration write test user | `_rt_user_reg_001` |
| Personal memory test user | `_rt_user_alt_001` |

Fixtures are inserted in `beforeAll` and cleaned up in `afterAll` via cascade deletes. Because the wrapper creates a fresh disposable database per run, each test run starts from a clean schema.

## Adding coverage for new functions

1. Find the domain file for the function (e.g., a new LLM write → `llm.regression.test.ts`).
2. Add a `it(...)` block that calls the function against the fixture data.
3. Assert on the return value, not just that it doesn't throw.
4. If the function reads after a write, add a second `it` block that calls the read function and confirms it reflects the change.

If the function belongs to a new repository not yet covered, add a new `*.regression.test.ts` file following the existing pattern.

## Command config mapping contracts

Split-config commands should also have pure unit coverage when they translate UI choices into repository write patches. Use `tests/unit/commands/configCommandMappings.test.ts` for checkbox or dynamic mapping contracts such as `/capabilities manage` and `/server member-permissions`.

Prefer extracting a typed write-plan helper from the command module over mocking Discord interactions. The unit test should assert both the repository method target and the table-owned patch shape, then DB regression tests should cover any mixed-table repository write that needs transaction protection.

## Verifying the harness catches regressions

Each test file has at least one `it.skip("[REGRESSION PROBE] ...")` block. To confirm the harness is catching real regressions:

1. Un-skip the probe test in the file you're modifying.
2. Introduce the described regression (e.g., add `WHERE 1=0` to the SELECT under test).
3. Run the file — the probe test must fail.
4. Revert the regression and re-run — the probe test must pass again.
5. Re-skip the probe test before committing.

## CI integration

CI sets `POSTGRES_PASSWORD` and `POSTGRES_HOST` in the job environment. `bun run test` detects the credentials, provisions a fresh disposable database per run, and drops it after tests complete — no static `tomodb_test` database or manual CI setup is required.

See `.github/workflows/validation.yml` for the current service container and env configuration.

## Safety guards

- The wrapper only creates/drops databases on local hosts (`localhost`, `127.0.0.1`, `::1`, `postgres`, `tomoribot-db`, `host.docker.internal`). Set `TOMORI_TESTS_ALLOW_NONLOCAL_DB=true` to override for a disposable remote instance.
- `RUN_ENV=production` causes the wrapper to abort immediately.
- If Postgres is unreachable (connection probe times out in 5 s), the wrapper falls back to skip mode — tests run without DB, 89 DB tests skip.
