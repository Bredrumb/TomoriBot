---
title: "Setup Wizard"
sidebar:
  label: "Setup Wizard"
  order: 1
---

`bun run setup` is the recommended self-host setup path for local Bun-based
TomoriBot installs. Docker Compose users should skip this wizard and use
`docker compose up --build` with the Docker `.env` values from the README.
It is safe to re-run: existing real `.env` values are kept unless you choose to
reconfigure them.
When an existing `.env` is found, "Use current .env without changes" means the
wizard will trust the file exactly as written. It does not apply defaults, and it
is only available when all required values are already set.

The wizard intentionally has two paths:

| Path | Use When | What It Does |
|---|---|---|
| Full Install | You want the recommended setup with lightweight extras. | Runs Base Install, then tries `pgvector`, `pg_cron`, tokenizer assets, and URL Fetch MCP. |
| Base Install | You want only the minimum working bot setup. | Creates/configures `.env`, Discord token, PostgreSQL, and dependencies. |

Sidecars and heavier integrations such as SearXNG, Crawl4AI, local voice servers,
Grafana, and Matrix stay in their dedicated docs because they usually require
service-specific decisions.

## Base Install

Base Install handles the minimum required pieces:

1. Checks for Node.js, `psql`, `pg_dump`, Docker, and Python.
2. Creates `.env` from `.env.example` when missing.
3. Generates a 32-character `CRYPTO_SECRET` when the value is blank or still a placeholder.
4. Prompts for your Discord bot token and reminds you to enable the required privileged intents.
5. Configures PostgreSQL using either native/local PostgreSQL or the bundled Docker PostgreSQL container.
6. Runs `bun install`.

Choosing the bundled Docker database in this wizard only runs PostgreSQL in Docker.
TomoriBot, startup backups, `bun run backup`, and `restore-backup` still run through
host Bun and host PostgreSQL client tools.
The wizard recommends installed PostgreSQL when `psql` is available,
and recommends bundled Docker PostgreSQL only as the simpler fallback when it is
missing.

For local/native PostgreSQL, the wizard can create or update the TomoriBot database
role as a superuser. This is intended for local/dev self-hosting only. Do not use a
superuser app role for shared production databases.
The wizard requires the PostgreSQL admin user's password for this step.

For scripted repeat tests, use `bun run setup --full --defaults` for Full Install
or `bun run setup --base --defaults` for Base Install. `bun run setup --defaults`
still runs Base Install for compatibility. `--yes` is accepted as an alias, but
`--defaults` is the clearer setup flag.

If `psql` is missing or provisioning fails, the wizard prints the SQL to run manually.
TomoriBot still initializes the application schema, seeds, migrations, `pgcrypto`, and
RAG schema automatically on startup.

## Full Install

Full Install runs Base Install first, then attempts these extras:

| Extra | Purpose |
|---|---|
| `pgvector` | Enables vector search support for document/RAG memory when the extension is installed. |
| `pg_cron` | Enables optional scheduled cooldown cleanup support when PostgreSQL supports it. |
| Tokenizer assets | Downloads local tokenizer assets for model-aware logit bias. |
| URL Fetch MCP | Installs the Python `mcp-server-fetch` package for the bundled `fetch_url` fallback. |

DuckDuckGo/Felo web search is separate from URL Fetch MCP. It is installed by the
normal `bun install` dependency step and is used behind the unified `web_search`
tool without a separate setup module.

Extras are best-effort. If an OS package, PostgreSQL extension, tokenizer download,
or Python setup is missing, Full Install prints the command or guide to finish
manually and continues.

Use non-interactive Full Install with:

```bash
bun run setup --full --defaults
```

## Starting After Setup

For the bot only:

```bash
bun run dev
```

For sidecars plus the bot:

```bash
bun run launch --searxng --crawl4ai
bun run launch --qwen3tts
```

When the bot is online, run `/config setup` in Discord.

## Updating

Use the backup-first updater:

```bash
bun run update
```

It runs `bun run backup`, then `git pull --rebase --autostash`, then `bun install`.
Use `bun run update --build` if you run from `dist/`, or `bun run update --docker`
for Docker Compose.
