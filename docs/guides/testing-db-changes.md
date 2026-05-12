<!-- ARCH-ALIGNMENT: prereq-phase-2 -->

# Testing DB Changes

This guide covers the DB regression harness introduced in Phase 2 (#4a). The harness protects the data-access layer during the repository migration (#4b) and any future DB-touching work.

## TL;DR

```bash
# Create the test database (one-time)
createdb tomodb_test

# Run the DB regression harness
POSTGRES_DB=tomodb_test bun test tests/regression/db/

# Or keep test DB credentials separate
bun --env-file=.env.test test tests/regression/db/
```

## Why a separate test database?

The harness inserts and deletes rows during each run. Running it against your development database would corrupt live data. The `POSTGRES_DB` env var guard in `tests/regression/db/setup/testDb.ts` prevents the tests from running unless the database name matches `TEST_POSTGRES_DB` (default: `tomodb_test`).

## Setup

### 1. Create the test database

```bash
# PostgreSQL must be running and your POSTGRES_USER must have CREATE DATABASE rights
createdb -U postgres tomodb_test
```

### 2. Environment variables

The harness inherits all `POSTGRES_*` env vars from your shell. You can also provide `TEST_POSTGRES_*` values so the bot's normal `.env` can keep pointing at the development database while the harness points at the disposable test database.

| Variable | Required | Default |
|---|---|---|
| `POSTGRES_PASSWORD` or `TEST_POSTGRES_PASSWORD` | Yes | — |
| `POSTGRES_DB` | Yes unless `TEST_POSTGRES_DB` is set | `tomodb` |
| `TEST_POSTGRES_DB` | No | `tomodb_test` |
| `POSTGRES_HOST` or `TEST_POSTGRES_HOST` | No | `localhost` |
| `POSTGRES_PORT` or `TEST_POSTGRES_PORT` | No | `5432` |
| `POSTGRES_USER` or `TEST_POSTGRES_USER` | No | `postgres` |

Example `.env.test`:

```env
TEST_POSTGRES_HOST=localhost
TEST_POSTGRES_PORT=5432
TEST_POSTGRES_USER=postgres
TEST_POSTGRES_PASSWORD=your_password
TEST_POSTGRES_DB=tomodb_test
```

### 3. Schema bootstrap

The harness calls `initializeDatabase()` in each `beforeAll` — the same function the bot calls at startup. If the test database is empty, the schema is created automatically on first run.

## Running the tests

```bash
# Run only DB regression tests
POSTGRES_DB=tomodb_test bun test tests/regression/db/

# Run with a dedicated test env file
bun --env-file=.env.test test tests/regression/db/

# Run all tests (DB tests skip automatically when POSTGRES_DB != tomodb_test)
bun test tests/

# Run a single domain
POSTGRES_DB=tomodb_test bun test tests/regression/db/user.regression.test.ts
```

## Test file map

| File | Domain | Functions covered |
|---|---|---|
| `user.regression.test.ts` | UserRepository | `loadUserRow`, `registerUser`, `setPrivacyLevel`, `updateUser` |
| `persona.regression.test.ts` | PersonaRepository | `loadTomoriState`, `loadAllPersonasForServer`, `loadPersonaConfigRow`, `updateTomori` |
| `memory.regression.test.ts` | ServerMemory + PersonalMemory | `addServerMemoryByTomori`, `addPersonalMemoryByTomori`, `loadPersonalMemoriesForUserLineage` |
| `config.regression.test.ts` | ConfigRepository | `loadTomoriState` (config portion), `updateTomoriConfig` |
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

Fixtures are inserted in `beforeAll` and cleaned up in `afterAll` via cascade deletes. The `setup/fixtures.ts` module returns internal DB IDs (`FixtureRefs`) for tests that need them.

## Adding coverage for new functions

1. Find the domain file for the function (e.g., a new LLM write → `llm.regression.test.ts`).
2. Add a `it(...)` block that calls the function against the fixture data.
3. Assert on the return value, not just that it doesn't throw.
4. If the function reads after a write, add a second `it` block that calls the read function and confirms it reflects the change.

If the function belongs to a new repository not yet covered, add a new `*.regression.test.ts` file following the existing pattern.

## Verifying the harness catches regressions

Each test file has at least one `it.skip("[REGRESSION PROBE] ...")` block. To confirm the harness is catching real regressions:

1. Un-skip the probe test in the file you're modifying.
2. Introduce the described regression (e.g., add `WHERE 1=0` to the SELECT under test).
3. Run the file — the probe test must fail.
4. Revert the regression and re-run — the probe test must pass again.
5. Re-skip the probe test before committing.

## CI integration

The test database configuration in CI (`.github/workflows/`) should set:

```yaml
env:
  POSTGRES_DB: tomodb_test
  POSTGRES_PASSWORD: ${{ secrets.TEST_POSTGRES_PASSWORD }}
```

Equivalent CI setups may use `TEST_POSTGRES_DB` and `TEST_POSTGRES_PASSWORD` instead; the harness maps those to the runtime `POSTGRES_*` variables before the DB client is created.

The `bun test tests/` command then auto-discovers and runs the regression harness alongside unit tests.
