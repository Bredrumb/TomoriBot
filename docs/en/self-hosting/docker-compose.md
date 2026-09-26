---
title: "Docker Compose"
sidebar:
  order: 3
---

Docker Compose builds and runs TomoriBot **plus** PostgreSQL as containers. It's the
third install path alongside the [setup wizard](/self-hosting/setup-wizard/) and
[manual setup](/self-hosting/manual-setup/): pick it when you'd rather run everything in Docker than
install Bun and PostgreSQL on the host. It does **not** use the setup wizard; the database
connection is auto-configured for you.

:::caution[Host tools for updates]
`bun run update --docker` needs host Bun and Git to pull the checkout. Its database backup runs
inside the app image. Manual backup and restore can also run through Compose; see
[Maintenance & Backups](/self-hosting/maintenance/).
:::

## 1. Get the code

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 2. Required `.env` values

Start from the example file:

```sh
cp .env.example .env
```

Then set at minimum:

| Variable | Value |
|---|---|
| `DISCORD_TOKEN` | Your Discord bot token (enable the `GuildMembers`, `MessageContent`, and `GuildPresences` privileged intents). |
| `CRYPTO_SECRET` | A 32-character encryption key used to encrypt stored API keys. |
| `POSTGRES_PASSWORD` | The database password. Every other `POSTGRES_*` value is auto-configured. |

Generate a random 32-character value for `CRYPTO_SECRET` using Docker, then copy it into `.env`:

```sh
docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"
```

Generate a separate value for `POSTGRES_PASSWORD`. Optional tuning values can be copied from
`.env.optional.example`.

:::note[Database connection is automatic]
The Compose PostgreSQL service runs in development mode (no SSL) on the internal Docker
network, and the bundled image already has `pgvector` and `pg_cron` configured, so
document/RAG memory and scheduled cleanup work out of the box. Don't set `POSTGRES_HOST`,
`POSTGRES_PORT`, `POSTGRES_USER`, or `POSTGRES_DB` for Compose; they're managed for you.
:::

On Linux, create the host directories and give the container user (UID 1001) ownership before the
first start. Docker creates missing bind-mount directories as root, which prevents the bot from
writing backups, logs, or uploaded data.

```sh
mkdir -p backups logs data
sudo chown 1001:1001 backups logs data
```

## 3. Build and run

```sh
docker compose build   # first time, or after code/dependency changes
docker compose up      # bot + database
```

For later starts, `docker compose up` alone is enough unless you changed code or
dependencies. When the bot is online, run `/setup` in Discord to add your AI
provider key: see the [Quickstart](/introduction/quickstart/) for the in-Discord side.

Compose uses `RUN_ENV=development` so `.env` secrets and local HTTP endpoints work. The app
healthcheck reports whether its process is running; it does not test Discord connectivity.
`RUN_ENV=production` loads secrets from a secret manager or mounted JSON file and enforces HTTPS
and private-network URL restrictions. It also changes command registration and enables the health
HTTP server and metrics collector. The Compose configuration pins development mode.

## 4. Optional local servers (Compose profiles)

Local servers are opt-in via Compose profiles, so you only run what you need:

```sh
# SearXNG (private web search) + Crawl4AI (browser-rendered fetch)
docker compose --profile searxng --profile fetch-crawl4ai up
```

Set `SEARXNG_BASE_URL=http://searxng:8080/` in `.env` when enabling the SearXNG profile.
Leave it unset otherwise. Set `SEARXNG_SECRET` to a separate random value for the SearXNG
signing key.

See [SearXNG](/self-hosting/local-endpoints/setup-searxng/), [Crawl4AI](/self-hosting/local-endpoints/setup-crawl4ai/),
and [Local Monitoring](/self-hosting/local-monitoring/) for per-server details.

## Maintenance, updating & backups

Use `bun run update --docker` for the backup-first update procedure on a Compose
deployment. Backing up and restoring the Compose database is covered on the
[Maintenance & Backups](/self-hosting/maintenance/) page. Before pulling a
new version, start with [Safe Migration](/self-hosting/safe-migration/).
