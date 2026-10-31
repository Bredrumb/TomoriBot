---
title: "Setup Wizard"
aiGenerated: false
sidebar:
  label: "Setup Wizard"
  order: 1
---

:::note
Users who want to use Docker Compose should skip this wizard, see
[Docker Compose](/self-hosting/docker-compose/) for the containerized install path.
:::

`bun run setup` is the recommended self-host path for local Bun-based installs. The command installs the dependencies from `bun.lock` before loading the wizard, including on a fresh clone. The wizard creates your `.env`, generates a `CRYPTO_SECRET`, asks for your Discord bot token, asks whether to [allow private networks](#private-networks), and configures PostgreSQL. It's safe
to re-run; existing `.env` values are kept unless you choose to reconfigure them.


## What to have ready

- **[Bun](https://bun.sh/)** to run the bot and the wizard itself.
- **A Discord bot token** with the `GuildMembers`, `MessageContent`, and `GuildPresences`
  privileged intents enabled.
- **PostgreSQL installed.** TomoriBot stores everything in PostgreSQL. You don't set it up by hand as
  the wizard does it for you: it'll use PostgreSQL if you already have it installed, or run
  one for you in [Docker](https://www.docker.com/) if you don't. Just make sure one of the
  two is installed before you start. TomoriBot initializes its schema, seeds, migrations, `pgcrypto`, and RAG schema
automatically on first startup.

## Get the code

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## Run the wizard

Run the setup wizard using:

```bash
bun run setup
```

Once you run the command, you'll pick one of two paths:


| Path | Use When | What It Does |
|---|---|---|
| Full Install | You want the recommended setup with lightweight extras. | Runs Base Install, then attempts the extras below. |
| Base Install | You want only the minimum working bot. | Creates/configures `.env`, Discord token, PostgreSQL, and dependencies. |


### Private networks
<!-- anchor: private-networks -->

The wizard asks whether TomoriBot may reach `localhost` and your LAN, and saves the answer as
`ALLOW_PRIVATE_NETWORK` in `.env`. Outside production TomoriBot won't start until it is set, so a
setup made by hand needs the line too. Any member who can add a custom endpoint or MCP server can
reach whatever you allow here, so pick by who uses the bot:

| Value | Choose it when |
|---|---|
| `true` | Only you or a trusted Discord community uses the bot. Local models and MCP servers on `localhost` or your LAN work, including over plain HTTP. |
| A `host:port` list, such as `localhost:5001,localhost:8188` | You share local servers, such as KoboldCPP or ComfyUI, with members you don't fully trust. Only the listed servers work, so their endpoints can't reach anything else on your network. |
| `false` | Untrusted members use the bot and you share no local server. |

Public HTTPS endpoints, such as hosted OpenAI-compatible APIs, work with every value. So does a local
model behind an HTTPS tunnel such as Cloudflare Tunnel or ngrok.

A list matches the address exactly as an endpoint is registered, so `localhost:5001` doesn't cover
`127.0.0.1:5001`; list each spelling you use. A listed server is still open to every member, on any
path, so keep its own admin features behind a password (for KoboldCPP, `--adminpassword`).

Tailscale addresses and `*.ts.net` names count as private, so they need `true` or a list; with
`false`, only Tailscale Funnel works.

Images, files, and link previews that members post never reach private addresses, whatever you
choose. The `fetch_url` tool has its own setting, `FETCH_URL_ALLOW_PRIVATE_NETWORK` (off by default).

### Full Install extras

Full Install runs Base Install first, then tries to install the extras below. If any fails, it
prints the command or guide to finish manually and keeps going:

| Extra | Purpose |
|---|---|
| `pgvector` | Vector search for document/RAG memory. |
| `pg_cron` | Optional scheduled cooldown/reminder-row cleanup. |
| Tokenizer assets | Local tokenizer assets for model-aware logit bias. |

To install any of these by hand, see the
[Manual Setup extras](/self-hosting/manual-setup/#optional-extras-the-manual-full-install).

## After setup

```bash
bun run dev                          # bot only
bun run launch --searxng --crawl4ai  # bot + local servers (see bun run launch --help)
```

When the bot is online, run `/setup` in Discord. It walks you through connecting an AI provider or to your custom endpoint.

## Updating

Use the backup-first updater command: `bun run update` 

This runs `bun run backup`, then
`git pull --rebase --autostash`, then `bun install --frozen-lockfile`. Add `--build` if you run from `dist/`,
or `--docker` for a Compose deployment. Full details on the
[Maintenance & Backups](/self-hosting/maintenance/) page.
