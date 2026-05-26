# Adding a DB Column

This guide walks through adding a new column to an existing TomoriBot database table.

## Steps

1. Add an idempotent migration to `src/db/schema.sql`.
   Use `add_column_if_not_exists` or an `IF NOT EXISTS` guard so the migration is safe to re-run:

   ```sql
   SELECT add_column_if_not_exists('table_name', 'column_name', 'TEXT DEFAULT NULL');
   ```

2. Update the Zod schema and TypeScript types in `src/types/db/schema.ts` to include the new field.

3. Wire read/write usage in the relevant `src/utils/db/` module. Use Bun SQL template literals:

   ```ts
   const rows = await sql`SELECT column_name FROM table_name WHERE id = ${id}`;
   ```

4. Invalidate any affected caches **after** successful writes — never before, never on failure.
   Keep the invalidation call in the same code path as the write:

   ```ts
   await sql`UPDATE table_name SET column_name = ${value} WHERE id = ${id}`;
   someCache.delete(cacheKey); // only reached if update didn't throw
   ```

## Quality Gate

```bash
bun run check    # TypeScript strict mode
bun run lint     # Biome formatting
bun run db:lifecycle  # full schema lifecycle test (requires local PostgreSQL)
```

`bun run db:lifecycle` creates and drops its own temporary database and runs fresh initialization plus backup/restore scripts. It requires a local disposable PostgreSQL target with CREATE/DROP database permission.

## Related Docs

- [`docs/subsystems/database-schema.md`](../subsystems/database-schema.md) — full schema reference and column index
- [`docs/subsystems/caching.md`](../subsystems/caching.md) — cache map and invalidation APIs
