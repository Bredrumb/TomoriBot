---
title: "Safe Migration Guide"
sidebar:
  order: 6
aiGenerated: true
---

TomoriBot applies pending database migrations when it starts. Some migrations can remove data, and
they do not roll back automatically. Back up before updating or starting a different branch.

## Before updating

1. Stop all bot instances.
2. Back up the database with `bun run backup` and save the media files described below. Docker users
   can follow [Docker Compose backups](/self-hosting/maintenance/#docker-compose-backups).
3. Keep all required encryption keys in separate protected storage and test recovery on a disposable
   database. Database backups do not include the keys.
4. Record the current commit with `git rev-parse HEAD`, then update and restart.

See [Maintenance & Backups](/self-hosting/maintenance/#database-backups-and-recovery-keys) for
restoring and checking encryption keys. A persona-only export cannot restore the whole database.

## Custom expression media backups
<!-- anchor: custom-expression-media-backups -->

Database backups contain expression references. Back up uploaded media separately. Stop the bot and back up the
local `data/` directory, including avatars, voice samples, and `data/custom-expressions/`, alongside
the database. Restore files to the same paths.

For GCS or S3 expressions, back up the `custom-expressions/` objects and restore their keys in the
same configured bucket. Keep `EXPRESSION_STORAGE_BACKEND` and `EXPRESSION_STORAGE_BUCKET` consistent
with those references. Linked expressions depend on their external hosts.

## Restore requirements

### Prerequisite: the `pgvector` extension

The target database needs the extensions used by the backup, including `pgvector` for document
memory. Install the package for your PostgreSQL version, for example on PostgreSQL 16:

```sh
sudo apt-get install -y postgresql-16-pgvector
```

Check that it is available:

```sh
psql -c "SELECT name, default_version FROM pg_available_extensions WHERE name = 'vector';"
```

Use `bun run restore-backup --latest` for a TomoriBot backup, or specify a bundle with `--from`.
Restore can change or remove existing data, so stop every bot instance and follow the
[recovery procedure](/self-hosting/maintenance/#database-backups-and-recovery-keys). If using `psql`
to restore a SQL dump manually, enable `ON_ERROR_STOP=1`; otherwise errors can leave an incomplete
database.

## Automatic startup backups

In non-production environments, TomoriBot takes a full database backup before initialization if the
latest backup is from a different bot version or is at least `TOMORI_AUTO_BACKUP_INTERVAL_HOURS` old
(default `24`). It retains the newest `TOMORI_AUTO_BACKUP_MAX` automatic backups (default `5`).
Set `TOMORI_AUTO_BACKUP_ENABLED=false` to disable this check. These backups do not replace separate
media and encryption-key backups.

## Cloud deployments

The AWS and legacy GCP deployment workflows support a pre-deploy snapshot when the head commit
contains `(Checkpoint)`, or when the backup option is selected for a manual run.

The Azure `release` workflow requires a recovery point for migrations that can lose rows. Add
`(Checkpoint)` to the commit or set `create_db_backup=true` for a manual run. Deploy the new reader
and backfill before removing a table or column the running bot still uses. If the workflow cannot
confirm compatibility, it stops the bot during migration; a failed migration can leave it stopped.

On Azure's Burstable tier, the workflow records a point-in-time restore target. Backup data can lag
behind that target, so take a logical dump when you need a stronger recovery point.

## If a migration fails

Stop the bot and check the logs for the failed migration. If recovery requires restoring, follow the
[backup recovery procedure](/self-hosting/maintenance/#database-backups-and-recovery-keys) before
returning to the previous code version. Report the migration name, error, previous commit, and your
OS, Bun, and PostgreSQL versions in a [GitHub issue](https://github.com/Bredrumb/TomoriBot/issues).

## Testing a branch

Use a separate database when testing a branch. Switching Git branches does not undo migrations that
ran when the bot started; returning to `main` may fail if the branch changed or removed data it needs.

For a disposable database, `bun run migrate:down --last` previews rollback and
`bun run migrate:down --last --yes` executes it. Run it while the branch's `.down.sql` files are
still present. Rollbacks can delete data; back up anything you need to keep first.
