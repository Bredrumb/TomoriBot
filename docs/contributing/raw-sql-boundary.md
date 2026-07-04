---
title: "Raw SQL Boundary"
---

All raw SQL in TomoriBot must live in the repository layer: `src/utils/db/repositories/`.
Application code (commands, events, tools, context builders, caches) must call a repository
method instead of writing `sql\`…\`` directly. This keeps queries, their validation, and their
cache invalidation in one place, and keeps the rest of the codebase decoupled from the schema.

This rule is enforced automatically — see [Enforcement](#enforcement) below.

## What counts as a violation

A violation is any raw `sql`/`tx` tagged template literal **outside** the repository layer and
outside the allow-listed paths:

```ts
// ❌ In a command / event / tool / util — NOT allowed
const [row] = await sql`SELECT * FROM users WHERE user_disc_id = ${id}`;
```

```ts
// ✅ The same query, moved into a repository method, called from anywhere
const user = await userRepository.loadByDiscordId(id);
```

The scanner detects:

- `sql\`…\`` and `await sql\`…\`` template literals
- Typed forms including nested generics, e.g. `sql<Array<{ id: number }>>\`…\``
- Transaction callbacks written as `tx\`…\`` inside `sql.transaction(async (tx) => …)`

It deliberately does **not** flag:

- SQL written inside `//` line comments or `/* … */` block comments
- Plain strings that merely contain SQL text (only tagged templates count)
- Identifiers that merely end in `sql`/`tx` (e.g. `mysql\``, `someSql\``)
- `sql.transaction(…)` / `sql.begin(…)` orchestration itself (only the query literals inside count) —
  so a util may open a transaction and hand `tx` to a repository method without tripping the gate

## Moving a query into a repository

1. Pick the repository that owns the table (e.g. `users` → `UserRepository`,
   `server_model_configs` → `ConfigRepository`, `personas` → `PersonaRepository`). The repositories
   are singletons exported from `src/utils/db/repositories/index.ts`.

2. Add a method that holds the query. Reads return typed rows; writes own their cache invalidation
   (invalidate **after** a successful write, in the same code path — never before, never on failure):

   ```ts
   // src/utils/db/repositories/UserRepository.ts
   async setSomething(userId: number, value: string): Promise<UserRow | null> {
     const user = await this.update(userId, { some_column: value });
     // update() already invalidates the user cache on success
     return user;
   }
   ```

3. Call the method from the application code, deleting the inline SQL and its now-unused
   `import { sql } from "@/utils/db/client"`:

   ```ts
   import { userRepository } from "@/utils/db/repositories";
   const user = await userRepository.setSomething(userId, value);
   ```

4. Before inventing a new method, check whether one already exists — duplicated reference-count and
   lookup queries are a common source of accidental violations.

## Exemptions

Two allow-lists in `scripts/checks/lib/sqlAudit.ts` let SQL live outside `repositories/`:

- **`IGNORE_PATHS`** — paths skipped entirely. These are the legitimate homes of raw SQL plumbing:
  the repository layer itself, the DB client, migrations, the migration runner, DB init, and
  `src/types/` (which may embed SQL only in doc comments / string types). You should rarely touch this.

- **`EXEMPT_PATHS`** — individual files allowed to keep raw SQL, each paired with a justification.
  Hits on these are reported as `EXEMPTIONS` rather than violations. Current entries are observability/
  status helpers, security primitives (crypto/key rotation), the logger, and the RAG service facade.

Prefer moving SQL into a repository. Only add an `EXEMPT_PATHS` entry when a repository genuinely does
not fit (e.g. a security primitive that must own its own table access), and always include a clear
reason string:

```ts
// scripts/checks/lib/sqlAudit.ts
export const EXEMPT_PATHS = new Map<string, string>([
  // …existing entries…
  ["src/utils/security/myPrimitive.ts", "security primitive; owns its own key table access"],
]);
```

## Enforcement

The detector is shared by the CLI gate and a unit test, so they can never disagree:

- **`scripts/checks/lib/sqlAudit.ts`** — the scanner (single source of truth).
- **`bun run audit-sql`** — prints `WRITES` / `READS` / `EXEMPTIONS` and **exits non-zero** when any
  violation exists.
- **`tests/unit/db/rawSqlBoundary.test.ts`** — a unit test asserting zero violations on the real tree,
  plus synthetic tests proving the detector has no false positives (comments/strings) or false
  negatives (real literals).

Both run as part of `bun run vl`: `audit-sql` is the "SQL Audit" item under Code Quality, and the unit
test runs in the Unit Tests group.

## Quality Gate

```bash
bun run audit-sql   # raw-SQL boundary report; non-zero on violations
bun run check       # TypeScript strict mode (catches unused sql imports, etc.)
bun run lint        # Biome formatting
bun run vl          # full validation suite (includes both of the above)
```

## Related Docs

- [`docs/architecture/subsystems/database-schema.md`](../subsystems/database-schema) — schema reference and column index
- [`docs/architecture/subsystems/caching.md`](../subsystems/caching) — cache map and invalidation APIs
- [`contributor-guides/adding-db-column.md`](./adding-db-column) — adding a column and wiring repository usage
- [`contributor-guides/testing-db-changes.md`](./testing-db-changes) — running the DB test harness
