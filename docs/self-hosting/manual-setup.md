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

- `DISCORD_TOKEN` — your Discord bot token (enable the `GuildMembers`, `MessageContent`, and
  `GuildPresences` privileged intents).
- `CRYPTO_SECRET` — a 32-character encryption key (used to encrypt stored API keys).
- PostgreSQL connection: `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`,
  `POSTGRES_PASSWORD`, `POSTGRES_DB`. (For Docker Compose, only `POSTGRES_PASSWORD` is
  required — the rest is auto-configured.)

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

## Maintenance, updating & backups

Once you're installed, the host-side scripts (`bun run update`, `bun run backup`,
`bun run restore-backup`, `bun run nuke-db`, `bun run rotate-keys`, …) and the update and
backup procedures all live on the [Maintenance & Backups](./maintenance) page. If you're about
to pull a new version, start with [Safe Migration](./safe-migration).

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
