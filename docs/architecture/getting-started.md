# 2. Getting Started with TomoriBot Development

This guide sets up TomoriBot locally with Bun + PostgreSQL.

## Prerequisites

- Bun
- PostgreSQL
- A Discord bot application with:
  - `bot` and `applications.commands` scopes
  - Privileged intents enabled in Discord Developer Portal:
    - `Server Members Intent`
    - `Message Content Intent`
  - `Presence Intent` is optional (used only outside production)

## 1. Install Dependencies

```bash
bun install
```

## 2. Create Local Environment File

```bash
cp .env.example .env
```

`.env.example` is intentionally minimal and only includes the required local setup values.

Minimum required values for local development:

```env
DISCORD_TOKEN=...
CRYPTO_SECRET=...
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=...
POSTGRES_PASSWORD=...
POSTGRES_DB=tomodb
RUN_ENV=development
```

Notes:

- Runtime uses `RUN_ENV` (not `NODE_ENV`) for production/dev branching.
- In production mode (`RUN_ENV=production`), secrets are fetched from AWS Secrets Manager (`tomoribot/production`) unless `TEST_PRODUCTION=true`.
- Additional tuning and feature flags live in `.env.optional.example`. Copy only the values you actually want into `.env`.

## 3. Prepare PostgreSQL

Create a DB/user, then ensure `.env` credentials match.

## 4. Start the Bot

```bash
bun run dev
```

Expected startup stages include:

- secrets loading
- encryption key manager init
- schema + seed verification
- tool registry init
- locale init
- cache warmup
- event handler setup
- Discord login

## 5. First-Time Discord Setup

Run in your test server:

```text
/config setup
```

`/config setup` normally captures your initial provider credentials.

If you are testing a server that should start in member-funded mode, `/config setup` also exposes a `None (User BYOK)` option. That bootstraps the server with no server-side text provider and immediately enables member BYOK, so users must configure their own personal providers.

If you want to use only a self-hosted or proxy-backed custom endpoint, `/config setup` now also exposes `Custom Endpoint (finish after setup)`. That bootstraps the server without enabling BYOK, then you finish the provider setup with:

```text
/config custom-endpoint add
/config model text
```

Later changes to that registration can be done in place with `/config custom-endpoint edit`.

If you want to save an additional provider afterward:

```text
/config provider add
```

Then use `/config provider switch` whenever you want to make one of your saved providers active.

Common saved providers:

- `provider:openrouter`
- `provider:novelai`

The old inline `custom` provider path is deprecated. Use `/config custom-endpoint add` instead.

## Common Development Commands

```bash
bun run dev
bun run build
bun run start
bun run lint
bun run check
bun run vl
bun run nuke-db
bun run backup
bun run purge-commands
bun run check-locales
bun run check-limits
```

## Quick Health Checks

- `/tool ping`
- `/tool status`
- Mention the bot or use trigger words in chat

## Troubleshooting

- Command registration issues: run `/tool refresh`
- Type errors: `bun run check`
- Formatting/lint: `bun run lint`
- Locales mismatch: `bun run check-locales`
