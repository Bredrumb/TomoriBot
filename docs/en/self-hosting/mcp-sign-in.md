---
title: "MCP Sign-In Setup"
description: "Let your self-hosted TomoriBot add MCP servers that ask for an account sign-in."
sidebar:
  order: 9
---

Some MCP servers ask admins to sign in to an account instead of pasting a token. A self-hosted bot
offers that sign-in only when `TOMORI_PUBLIC_BASE_URL` is set. Without it, only MCP servers that
take a token in `Auth Token` work.

If you use the [public deployed bot](https://discord.com/oauth2/authorize?client_id=841644102059556915),
you do not need this page; see [MCP servers](/features/capabilities/tools-and-extensions/mcp-servers/).

## Choose a base URL

Set `TOMORI_PUBLIC_BASE_URL` in `.env` to an address with no path, then restart the bot:

| Value | Use when |
|---|---|
| `http://127.0.0.1:8080` or `http://localhost:8080` | Sign-in finishes in a browser on the bot's own machine. No domain or tunnel is needed. |
| `https://<your-host>` | Admins sign in from their own computers. You need a public HTTPS address that forwards to the bot. |

Setting the variable starts the bot's HTTP server on `PORT` (default `8080`), and that server listens
on every network interface. A sign-in in progress lives in memory, so restarting the bot during one
means starting it again from Discord.

## Loopback address

- Use the port in `PORT`. The bot logs a warning at startup when they differ.
- Finish sign-in in a browser on the bot's machine. From another computer, forward the port over
  SSH first, then choose `Sign In` in that computer's browser:

  ```sh
  ssh -L 8080:127.0.0.1:8080 <user>@<bot-host>
  ```

- Each service decides whether it accepts a loopback address. If one refuses, use an HTTPS address
  or a token instead.

## HTTPS address

Forward these paths from your public address to the bot's `PORT`:

- `GET /oauth/callback`
- `GET /oauth/mcp/start`
- `POST /oauth/mcp/confirm`
- `GET /oauth/client.json`

Services identify your bot by `https://<your-host>/oauth/client.json`, so choose the host name
before the first sign-in and keep it.

## Docker Compose

Compose does not publish the bot's port. Create `docker-compose.override.yaml` next to
`docker-compose.yaml`:

```yaml
services:
  tomoribot:
    ports:
      - "127.0.0.1:8080:8080"
```

Keep the `127.0.0.1:` prefix, because without it every computer on your network can reach the
bot's HTTP server. A reverse proxy or tunnel running on the same machine can still forward to this
port.
