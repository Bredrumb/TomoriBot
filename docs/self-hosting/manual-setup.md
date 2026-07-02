---
title: "Manual Setup"
sidebar:
  order: 2
---

This is the manual install procedure for technical users who'd rather not use the guided
wizard. If you want the hand-held path, use the [setup wizard](./setup-wizard) instead — it
creates `.env`, generates a safe `CRYPTO_SECRET`, configures PostgreSQL, and runs the install
for you.

## Prerequisites

- [Bun](https://bun.sh/)
- Node.js v20+ (used for MCP tooling)
- PostgreSQL **or** Docker

PostgreSQL schema, `pgcrypto`, seeds, and migrations initialize automatically on first bot
start — you don't run migrations by hand.

## 1. Install

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
bun install
```

## 2. Configure

Create your environment file from the example and fill in the required values:

```sh
cp .env.example .env
```

Required:

- `DISCORD_TOKEN` — your Discord bot token.
- `CRYPTO_SECRET` — a 32-character encryption key (used to encrypt stored API keys).
- PostgreSQL connection settings (e.g. `POSTGRES_PASSWORD` and the related `POSTGRES_*` /
  `DATABASE_URL` values for your database).

Optional tuning lives in `.env.optional.example` — copy over any values you want to
customize (limits, timeouts, feature toggles, sidecar URLs, etc.).

## 3. Run

```sh
bun run dev
```

When you see `TomoriBot up and running!`, go to Discord and run `/config setup` in your
server to add your AI provider key and initialize the bot. See the
[Quickstart](/introduction/quickstart/) for the in-Discord side.

Want optional sidecars (SearXNG, Crawl4AI, local TTS/STT) launched alongside the bot? Use
`bun run launch` instead of `bun run dev`:

```sh
bun run launch --searxng --crawl4ai
bun run launch --help        # see all flags
```

## Maintenance Scripts

| Command | Description |
|---|---|
| `bun run setup` | Open the setup wizard for base install and optional modules. |
| `bun run update` | Back up first, then pull latest code and install dependencies. |
| `bun run backup` | Create a bundle in `backups/` with your DB dump and `.env`. |
| `bun run restore-backup` | Restore `.env` and database from a bundle (`--latest` or `--from backups/<dir>`). |
| `bun run backup:personas` | Export ONLY personas (with server memories); re-import via `/persona import`. |
| `bun run nuke-db` | Drop all tables (start the bot afterward to reinitialize). |
| `bun run purge-commands` | Clear all registered Discord slash commands. |
| `bun run rotate-keys` | Re-encrypt all encrypted fields to the current key version. |

`bun run backup` and `bun run update` require PostgreSQL client tools (`pg_dump`, `psql`) in
your PATH.

## Updating

Stop the running bot first, then use the backup-first updater:

```sh
bun run update
```

This runs `bun run backup`, then `git pull --rebase --autostash`, then `bun install`. Manual
fallback:

```sh
bun run backup
git pull --rebase --autostash
bun install
```

Running from `dist/`? Use `bun run update --build`. Running Docker Compose? Use
`bun run update --docker`.

## Alternative: Docker Compose

For a containerized deployment, start from `.env.example` and set at minimum:

- `DISCORD_TOKEN`
- `CRYPTO_SECRET`
- `POSTGRES_PASSWORD`

```sh
docker compose build   # first time or after code changes
docker compose up      # bot + database
```

Docker Compose auto-configures the database connection (the PostgreSQL service runs in
development mode with no SSL on the internal Docker network). Optional sidecars are opt-in via
Compose profiles:

```sh
docker compose --profile searxng --profile fetch-crawl4ai up
```

See [SearXNG](./setup-searxng), [Crawl4AI](./setup-crawl4ai), and
[Local Monitoring](./local-monitoring) for sidecar details.
