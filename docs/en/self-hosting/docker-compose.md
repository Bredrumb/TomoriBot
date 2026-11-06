---
title: "Docker Compose"
sidebar:
  order: 3
---

Docker Compose runs TomoriBot and PostgreSQL together in containers. It is the third install option alongside the [setup wizard](/self-hosting/setup-wizard/) and [manual setup](/self-hosting/manual-setup/): choose it when you want to run everything in Docker without installing Bun or PostgreSQL on your host system. It bypasses the interactive setup wizard and configures the database connection automatically.

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

Set these required variables in `.env`:

| Variable | Value |
|---|---|
| `DISCORD_TOKEN` | Your Discord bot token (enable the `GuildMembers`, `MessageContent`, and `GuildPresences` privileged intents). |
| `CRYPTO_SECRET` | A 32-character encryption key used to encrypt stored API keys. |
| `POSTGRES_PASSWORD` | The database password. Every other `POSTGRES_*` value is auto-configured. |
| `ALLOW_PRIVATE_NETWORK` | `true` lets custom endpoints and MCP servers on your machine or LAN work, a `host:port` list allows only those servers, and `false` blocks them. The bot won't start until this is set. See [Private networks](/self-hosting/setup-wizard/#private-networks) to choose. |

Generate a random 32-character value for `CRYPTO_SECRET` using Docker, then copy it into `.env`:

```sh
docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"
```

Generate a separate password for `POSTGRES_PASSWORD`. You can copy optional tuning settings from `.env.optional.example`.

:::note[Database connection is automatic]
 Do not set `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, or `POSTGRES_DB` in `.env`; Compose configures them automatically.
:::

On Linux, the bot container runs as UID 1001 and needs write access to the host's `backups/`,
`logs/`, and `data/` directories. If they aren't already writable by UID 1001, create them and
assign ownership before the first start:

```sh
mkdir -p backups logs data
sudo chown 1001:1001 backups logs data
```

If you already ran Compose and Docker created the directories as root, you can run these commands
afterward. They do not change ownership of files already inside the directories.

## 3. Build and run

```sh
docker compose build   # first time, or after code/dependency changes
docker compose up      # bot + database
```

For later starts, `docker compose up` alone is enough unless you change code or dependencies. Once the bot connects to Discord, run `/setup` in any server channel to add your AI provider key. See the [Quickstart](/introduction/quickstart/) for setup options in Discord.

Compose pins `RUN_ENV=development` in its service definition so `.env` secrets and local HTTP endpoints work. Local endpoints such as `http://host.docker.internal:11434` need `ALLOW_PRIVATE_NETWORK` to allow them (`true`, or a list containing `host.docker.internal:11434`); Compose maps that name to your machine on Linux too. After changing `.env`, run `docker compose up -d` so the container rereads it. The container healthcheck reports whether the bot process is running; it does not test Discord gateway connectivity.

## Optional shard configuration on one host

Leave `SHARD_COUNT` and `SHARD_IDS` unset for the default: one process owns all shards recommended
by Discord at startup. Small installations normally receive one shard. This mode uses no shard
leases or cache invalidation listener. Several shards can share the same process.

To run four shards in the existing service, add `SHARD_COUNT=4` to `.env` and leave `SHARD_IDS`
unset. Add this service override in `compose.override.yaml` to allow bounded shutdown to finish:

```yaml
services:
  tomoribot:
    stop_grace_period: 40s
```

Recreate the service with `docker compose up -d --build tomoribot`. If a script calls `docker stop`
or supplies its own Compose stop timeout, allow at least 40 seconds there too. Auto selection does
not change the shard count while running; changing the total requires a coordinated restart.

Optional static subsets require a separate service per group with the same explicit `SHARD_COUNT`
and disjoint `SHARD_IDS`, for example `0,1` and `2,3` with total `4`. Give services distinct stable
names, container names, and any published health ports. The application derives stable metric
labels from each group. Keep one database, run the existing `bun run src/db/initializeCli.ts`
one-shot with schema-management credentials before gateway startup, and set
`DATABASE_SCHEMA_MANAGEMENT_ENABLED=false` on every gateway process. Do not start the original
all-owner service alongside those groups. Stop old owners before changing the total or partition.

Subset mode refuses a fully configured Matrix bridge. Per-user turn and upload limits remain
per process, so decide whether their multiplied allowance is acceptable before enabling a second
process. Installations using release-only supporter billing also require shared spend admission
and reconcile coordination before serving funded requests from multiple processes. See
[sharding and process ownership](/architecture/subsystems/sharding/) for safety and health limits.

## 4. Optional local servers (Compose profiles)

Run optional local helper servers with Compose profiles so you only start what you need:

```sh
# SearXNG (private web search) + Crawl4AI (browser-rendered fetch)
docker compose --profile searxng --profile fetch-crawl4ai up
```

When enabling SearXNG, set `SEARXNG_BASE_URL=http://searxng:8080/` in `.env`. Leave it unset otherwise. Set `SEARXNG_SECRET` to a separate random value for SearXNG request signing.

See [SearXNG](/self-hosting/local-endpoints/setup-searxng/), [Crawl4AI](/self-hosting/local-endpoints/setup-crawl4ai/), and [Local Monitoring](/self-hosting/local-monitoring/) for server-specific setup.

## Maintenance, updating, and backups

Before updating, stop the bot and back up your database and media; see
[Maintenance & Backups](/self-hosting/maintenance/).
Then pull the new code and rebuild the container:

```sh
git pull
docker compose up -d --build
```
