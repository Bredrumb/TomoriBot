# Safe Migration Guide for Self-Hosters

When you `git pull` new code and restart TomoriBot, the bot automatically runs database schema migrations on boot. This is powerful — it means you don't have to manually manage SQL updates — but it also means destructive operations can silently affect your data. This guide shows you how to protect yourself before pulling.

## Why this matters

TomoriBot's migration runner (in `src/db/migrationRunner.ts`) executes all unapplied migrations in version order. Migrations are **forward-only**: if something goes wrong, the runner does not auto-rollback. Most migrations are safe expansions (new columns, new tables), but per the project's [design policy (OD-R-6)](../../plans/refactor/shared/open-decisions.md), destructive operations such as `DROP COLUMN` or `DROP TABLE` are permitted. If a destructive migration runs without a backup, you lose data permanently. When in doubt, back up first.

## Pre-pull checklist

Follow these steps BEFORE running `git pull`:

1. **Stop the bot** — shut down the TomoriBot process so no active database connections interfere with the backup.
2. **Back up the database** — use one of the two methods below.
3. **Note the current commit** — run `git rev-parse HEAD` and save the output in case rollback is needed.
4. **Pull and restart** — once the backup is safely on disk, you're safe to pull and restart.

### Option A: Use the project's backup script

TomoriBot includes three backup scripts, each targeting different data:

- **`bun run backup`** — Full database schema + data dump (personas, memories, configs, everything)
- **`bun run backup:personas`** — Persona presets and per-persona server memories only
- **`bun run backup:memories`** — Personal memories across all users

For a safe migration, use the **full backup**:

```bash
bun run backup
```

This creates a timestamped bundle in `backups/` (or your `TOMORI_BACKUP_DIR` if overridden in `.env`) containing the entire PostgreSQL database in a compressed format. To restore later, run:

```bash
bun run restore-backup --latest
```

Or restore from a specific bundle:

```bash
bun run restore-backup --from backups/transfer_2024_01_15_14-30-45
```

### Option B: Direct `pg_dump`

If you prefer manual control, use PostgreSQL's built-in `pg_dump` utility with TomoriBot's own environment variables:

```bash
pg_dump \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -F c \
  -f "tomoribot-backup-$(date +%Y%m%d-%H%M%S).dump"
```

This saves a custom-format binary dump (more compact than SQL text). The environment variables match your `.env`:

- `POSTGRES_HOST` — default `localhost`
- `POSTGRES_PORT` — default `5432`
- `POSTGRES_USER` — your DB user
- `POSTGRES_DB` — default `tomodb`

To restore:

```bash
pg_restore \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  tomoribot-backup-20240115-143045.dump
```

**Note:** `pg_restore` will prompt for your password unless you set it in a `.pgpass` file (PostgreSQL's built-in credential file).

## For contributors deploying via CI: the `(Checkpoint)` convention

If you maintain a fork that deploys to AWS or GCP via the workflows in `.github/workflows/deploy-tomoribot-{aws,gcp}.yml`, those pipelines support an **opt-in pre-deploy snapshot**: when a commit message contains the literal token `(Checkpoint)`, the workflow runs `aws rds create-db-snapshot` (or the GCP Cloud SQL equivalent) **before** any code is deployed and before the migration runner touches the database on boot.

Use it when:

- You're shipping a migration that drops a column, drops a table, alters a column type, or otherwise loses data (the OD-R-6 destructive-migration policy).
- You're shipping a release-bundle commit that combines several migrations and want a single rollback point.
- You're not sure whether a queued migration is safe — when in doubt, checkpoint.

Skip it for routine non-destructive deploys (new columns, new indexes, additive seed data) — the snapshot has a real cost and the routine path doesn't need it.

Example commit message:

```
Refactor | Phase 7 closeout (Checkpoint)

Drops the deprecated tomori_configs table after Phase 6 backfill.
Snapshot is required because the migration is destructive.
```

The `(Checkpoint)` token can appear anywhere in the subject or body — it's matched case-sensitively against the head commit's message. Manual workflow dispatch with `create_db_snapshot: true` is the same lever for ad-hoc cases.

## What to do if a migration fails partway

If the bot crashes or hangs during migration:

1. **Stop the bot immediately** — do not let it retry migrations blindly.

2. **Check the logs** — TomoriBot logs to stdout/stderr by default (captured by your process manager or Docker logs). Look for an error message naming the migration that failed. Example output:

   ```
   Migration failed: 042_drop_old_column, error: column "old_column" does not exist
   ```

3. **Decide whether to restore** — if the error is unrecoverable (e.g., the migration tried to drop a column that doesn't exist), restore from your backup:

   ```bash
   # Option A restore
   bun run restore-backup --latest

   # Or Option B restore
   pg_restore \
     -h "$POSTGRES_HOST" \
     -p "$POSTGRES_PORT" \
     -U "$POSTGRES_USER" \
     -d "$POSTGRES_DB" \
     tomoribot-backup-20240115-143045.dump
   ```

4. **Roll back the code** — revert to the last working commit:

   ```bash
   git reset --hard <previous-commit-hash>
   ```

   Use the hash you saved in step 3 of the pre-pull checklist, or find it with:

   ```bash
   git log --oneline | head -20
   ```

5. **Report the bug** — file an issue at [github.com/Bredrumb/TomoriBot/issues](https://github.com/Bredrumb/TomoriBot/issues) with:
   - Failed migration filename (from logs)
   - Full error message
   - Last successful commit hash
   - Your OS, Bun version (`bun --version`), and PostgreSQL version

## What is NOT auto-recoverable

Per the project's design (OD-R-6), **destructive migrations cannot be rolled back** by the migration runner. Examples:

- `DROP COLUMN name_here` — deleted rows are lost forever; no SQL script can recover them
- `DROP TABLE old_table` — entire table is gone
- Type narrowing (e.g., `VARCHAR(255) → VARCHAR(100)`) — values longer than 100 characters are truncated

For these operations, **the only recovery is your backup**. Always back up before pulling if you're on an older version and a new refactor has shipped.

The migration runner's forward-only design is intentional: rollback files (`.down.sql`) exist for developer safety during testing, but production recovery relies on backups, not re-execution of undoable operations.

## See also

- [Database schema documentation](../systems/database-schema.md) — learn the current schema structure
- [Design Decision OD-R-6 (Down-migration shape)](../../plans/refactor/shared/open-decisions.md#od-r-6-down-migration-shape) — technical rationale for migration safety policy
- [Bun documentation](https://bun.sh) — learn Bun runtime fundamentals
