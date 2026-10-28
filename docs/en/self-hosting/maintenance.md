---
title: "Maintenance & Backups"
sidebar:
  order: 5
aiGenerated: true
---

Manage your self-hosted TomoriBot instance using CLI maintenance scripts to update code, back up or restore data, rotate encryption keys, and inspect environment variables. Run these commands from your host terminal or Docker environment. For in-Discord data exports and deletions, see [Data Handling](/features/knowledge/data-handling/).

If you are updating with `git pull`, review [Safe Migration](/self-hosting/safe-migration/) first to create a backup before the on-boot migration runner applies schema changes.

## Maintenance scripts

| Command | Description |
|---|---|
| `bun run setup` | Open the setup wizard for base install and optional modules. |
| `bun run update` | Back up first, then pull latest code and install dependencies. |
| `bun run backup` | Create a bundle in `backups/` with your database dump and required encryption-version metadata. Secrets stay separate. |
| `bun run restore-backup` | Restore the database using separately provisioned encryption keys (`--latest` or `--from backups/<dir>`). |
| `bun run backup:personas` | Export ONLY personas (with server memories) across all servers; re-import via `/persona import`. |
| `bun run nuke-db` | Drop all tables (start the bot afterward to reinitialize). |
| `bun run purge-commands` | Clear all registered Discord slash commands. |
| `bun run rotate-keys --bot-stopped` | Re-encrypt all encrypted fields to the current key version. |
| `bun run env-doctor` | Read-only check of your configuration: lists `.env` entries that nothing reads (names only, never values) and where each variable is used. |

Host `bun run backup` needs `pg_dump`, and host `bun run restore-backup` needs `psql` in your PATH. `bun run update` needs `pg_dump` for its backup. The `--docker` update path runs the backup in the container, so it needs host Bun, Git, and Docker but no host PostgreSQL tools.

For local avatars, keep TomoriBot's managed webhooks: deleting them prevents the bot from editing
older webhook messages. See [Safe Migration](/self-hosting/safe-migration/) for media backups.

## Database backups and recovery keys

Database bundles contain private data and an inventory of required encryption versions. They do not
contain `.env` or media. Protect the bundle and keep every required encryption key separately;
without an old key, credentials encrypted with it cannot be recovered.

To restore a trusted backup:

1. Stop every bot instance. Configure the target database, Discord token, and original encryption keys.
2. Install `psql` and the required database extensions, including `pgvector`. The database account
   must be able to enable `pgcrypto`, or an administrator must enable it first.
3. Run `bun run restore-backup --latest` or `bun run restore-backup --from backups/<bundle-directory>`.
   Check the target and confirm the prompts. Restore checks the keys before destructive SQL.
4. Run `bun run audit-keys` and `bun run rotate-keys --dry-run` before restarting. If credentials need
   migration, run `bun run rotate-keys --bot-stopped` and audit again. If restore fails, keep the bot
   stopped: earlier SQL statements may already have changed the database.

Older bundles can contain secrets in `config.env`. Restore does not load it; review it privately and
supply the required keys through your normal secret source.

## Rotating encryption keys

1. Back up the database and keep all existing keys in protected storage. Test recovery on a
   disposable database before retiring any key.
2. Generate a new key with `openssl rand -base64 32`. Add it to the bot's secret source as
   `CRYPTO_SECRET_V<version>` and select it with `CRYPTO_SECRET_CURRENT`. Keep older versions;
   `CRYPTO_SECRET` is V1.
3. Stop every bot instance and credential writer. Use the same secret source and database settings
   as the bot; production scripts also need `RUN_ENV=production`.
4. Run `bun run audit-keys` and `bun run rotate-keys --dry-run`. Both must succeed before proceeding.
5. Run `bun run rotate-keys --bot-stopped`, then `bun run audit-keys`. If either fails, keep the bot
   stopped and all key versions available while you fix the failure.
6. Test a restored disposable database with the retained current key. Test older backups with their
   archived keys before removing old versions from the live secret source. Keep archived keys as
   long as their backups exist, then restart the bot.

`--bot-stopped` records your confirmation; it cannot detect another running instance or clear its
credential cache.

## Updating

Stop the running bot first, then use the backup-first updater:

```sh
bun run update
```

The updater backs up the database, pulls the code, and installs dependencies. Use `--build` if you
run from `dist/`. For Compose, see [Docker Compose](/self-hosting/docker-compose/#maintenance-updating-and-backups).
Back up media and encryption keys separately.

### Environment changes

Run `bun run env-doctor` to find unused settings in `.env`. Command cooldowns use
`COMMAND_COOLDOWN_SCALE` (default `1`; `0` disables cooldowns).

Local TTS servers no longer authenticate requests with the former bearer-token settings. Review
[Network access](/self-hosting/local-endpoints/text-to-speech/#network-access) before exposing them
beyond your machine. Each engine uses its own port setting.

## Backups and restore

```sh
bun run backup
bun run restore-backup --latest
# Or choose a bundle:
bun run restore-backup --from backups/<bundle-directory>
```

Bundles are stored in `backups/` or `TOMORI_BACKUP_DIR`. Follow the
[recovery steps](#database-backups-and-recovery-keys) before restoring. `bun run backup:personas`
exports personas and server memories for `/persona import`; it cannot restore a database.

## Docker Compose backups

Docker Compose supports automatic startup backups inside the app container. Bundles are written to the host `backups/` directory because Compose mounts it into the container.

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

## Clean reinstall

`bun run nuke-db` drops all tables; starting the bot afterward reinitializes the schema, seeds, and migrations from scratch. Use it together with a fresh `bun run backup` when you want a clean slate you can still roll back from: never run it without a current backup.

