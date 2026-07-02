---
title: "Setup Wizard"
sidebar:
  label: "Setup Wizard"
  order: 1
---

`bun run setup` is the recommended self-host setup path for local TomoriBot installs.
It is safe to re-run: existing real `.env` values are kept unless you choose to
reconfigure them.

## Base Install

Choose **Base Install** first. It handles the minimum required pieces:

1. Checks for Node.js, `psql`, Docker, and Python.
2. Creates `.env` from `.env.example` when missing.
3. Generates a 32-character `CRYPTO_SECRET` when the value is blank or still a placeholder.
4. Prompts for your Discord bot token and reminds you to enable the required privileged intents.
5. Configures PostgreSQL using either native/local PostgreSQL or the repo's Docker Compose database.
6. Runs `bun install`.
7. Offers to download tokenizer assets for model-aware logit bias.

For local/native PostgreSQL, the wizard can create or update the TomoriBot database
role as a superuser. This is intended for local/dev self-hosting only. Do not use a
superuser app role for shared production databases.

For scripted repeat tests, `bun run setup --defaults` runs Base Install with safe
defaults and fails when required information has no default. `--yes` is still
accepted as an alias, but `--defaults` is the clearer setup flag.

If `psql` is missing or provisioning fails, the wizard prints the SQL to run manually.
TomoriBot still initializes the application schema, seeds, migrations, `pgcrypto`, and
RAG schema automatically on startup.

## Optional Modules

The menu groups optional setup by category:

| Category | Modules |
|---|---|
| Database | `pgvector`, `pg_cron` |
| AI tools | tokenizer assets, MCP Fetch Python package |
| Voice | Chatterbox TTS, Qwen3-TTS, IrodoriTTS, WhisperX STT |
| Web sidecars | SearXNG, Crawl4AI |
| Monitoring | local Grafana |
| Integrations | Matrix bridge checklist |

Some modules are fully automated. Others are guided because they require OS package
installs, service restarts, Discord-side configuration, or Matrix homeserver changes.
Guided modules print exact commands and link to the relevant docs.

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
