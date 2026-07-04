---
title: "Maintenance & Backups"
sidebar:
  order: 5
---

Day-to-day operation of a self-hosted instance: the maintenance scripts, how to update, and
how to back up and restore your database. These are host-side operations — you run them from a
shell, not from Discord. For the in-Discord, per-user export/import/delete flows, see
[Data Handling](/features/knowledge/data-handling/) instead.

If you're about to `git pull` a new version, read [Safe Migration](./safe-migration) first —
it covers backing up *before* the on-boot migration runner touches your schema.

## Maintenance scripts

| Command | Description |
|---|---|
| `bun run setup` | Open the setup wizard for base install and optional modules. |
| `bun run update` | Back up first, then pull latest code and install dependencies. |
| `bun run backup` | Create a bundle in `backups/` with your DB dump and `.env` — contains all of your data. |
| `bun run restore-backup` | Restore `.env` and database from a bundle (`--latest` or `--from backups/<dir>`). |
| `bun run backup:personas` | Export ONLY personas (with server memories) across all servers; re-import via `/persona import`. |
| `bun run nuke-db` | Drop all tables (start the bot afterward to reinitialize). |
| `bun run purge-commands` | Clear all registered Discord slash commands. |
| `bun run rotate-keys` | Re-encrypt all encrypted fields to the current key version. |

`bun run backup` and `bun run update` require the PostgreSQL client tools (`pg_dump`, `psql`)
in your PATH.

## Updating

Stop the running bot first, then use the backup-first updater:

```sh
bun run update
```

This runs `bun run backup`, then `git pull --rebase --autostash`, then `bun install`. The
backup bundle is written to `backups/` and includes both the database dump and `.env`. Add
`--skip-backup` to skip the pre-update backup. Manual fallback:

```sh
bun run backup
git pull --rebase --autostash
bun install
```

Running from `dist/`? Use `bun run update --build`. Running Docker Compose? Use
`bun run update --docker`.

## Backups & restore

`bun run backup` creates a timestamped bundle in `backups/` (or your `TOMORI_BACKUP_DIR` if
overridden in `.env`) containing your entire PostgreSQL database plus `.env`. Restore the
latest bundle with:

```sh
bun run restore-backup --latest
```

Or restore a specific bundle:

```sh
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

`bun run backup:personas` is a narrower export — persona presets and per-persona server
memories only, across all servers. It **must** be re-imported manually via `/persona import`
and **cannot** be used with `restore-backup` (that would cause primary-key conflicts).

TomoriBot also takes **automatic startup backups** in non-production environments, and a full
restore requires the `pgvector` extension to be present on the target database. Both are
covered in detail under [Safe Migration](./safe-migration), along with a manual `pg_dump` /
`pg_restore` procedure if you prefer to drive the tooling directly.

## Docker Compose backups

Docker Compose supports automatic startup backups inside the app container. Bundles are
written to the host `backups/` directory because Compose mounts it into the container.

For a manual Docker backup:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

For a Docker restore:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

Host-side scripts such as `bun run backup`, `bun run update`, and `bun run nuke-db` do not
automatically run through Docker. To run host scripts against the Compose database instead,
run them on the host with Bun plus the PostgreSQL client tools installed, and set:

```env
POSTGRES_HOST=localhost
POSTGRES_PORT=15432
POSTGRES_USER=tomori
POSTGRES_PASSWORD=your_password
POSTGRES_DB=tomodb
```

## Clean reinstall

`bun run nuke-db` drops all tables; starting the bot afterward reinitializes the schema,
seeds, and migrations from scratch. Use it together with a fresh `bun run backup` when you
want a clean slate you can still roll back from — never run it without a current backup.

## See also

- [Safe Migration](./safe-migration) — backing up before pulling, and the `pgvector` restore prerequisite
- [Data Handling](/features/knowledge/data-handling/) — per-user, in-Discord export/import/delete
- [Setup Wizard](./setup-wizard) — the guided `bun run setup` install
