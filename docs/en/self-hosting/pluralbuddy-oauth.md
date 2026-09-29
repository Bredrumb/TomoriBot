---
title: "PluralBuddy OAuth Setup"
description: "Authorize your self-hosted TomoriBot to verify messages from the official PluralBuddy service."
sidebar:
  order: 8
---

TomoriBot needs one operator-authorized PluralBuddy application to verify webhook reposts. People
using your bot select PluralBuddy in Discord; they do not create applications or supply tokens.

## Before you start

- Run the current TomoriBot version against a migrated PostgreSQL database.
- Use a computer with a browser and access to that database and TomoriBot's encryption key. The
  authorization helper listens on that computer's loopback address. If the database is remote,
  arrange temporary, restricted access from this computer.
- Choose an unused local port and register one exact callback URL in the developer portal, for
  example `http://127.0.0.1:<port>/oauth/callback`. Record this URL; you will use it in every
  step below.

## Authorize the official instance

1. Sign into the [PluralBuddy developer portal](https://pluralbuddy.app/developers/applications)
   and create an OAuth application. Use a separate application for testing. Select `profile` and
   `offline_access`. Register your callback exactly as chosen above. Keep the client ID and secret
   private. The PluralBuddy bot's Discord invitation does not grant TomoriBot API access.
2. From the TomoriBot repository, run the helper with the official instance ID and the same callback:

   ```sh
   bun scripts/db/authorize-pluralbuddy-instance.ts pluralbuddy:official <callback-url>
   ```

3. Enter the client ID and secret at the terminal prompts. Open the printed authorization URL in
   the browser on that computer, sign into PluralBuddy, and approve the consent screen. The helper
   closes after one callback or three minutes and stores the connection in PostgreSQL.
4. Start TomoriBot with the same database and encryption key. Select
   `/personal message-proxy service:pluralbuddy` on a Discord account that uses PluralBuddy, then
   send a webhook repost to check that TomoriBot recognizes the alter.

The helper reads PostgreSQL settings and `CRYPTO_SECRET` or versioned encryption keys from `.env`
or an operator-only `SECRET_FILE` JSON bundle. Keep the bundle outside the repository. Enter the
client secret at the prompt; do not place it in a command argument or Discord message. If PluralBuddy
revokes the connection, repeat these steps with the same instance ID. A failed selection leaves the
user's current message-proxy choice unchanged.

## Where the OAuth credentials go

The helper stores the client ID, encrypted client secret, and encrypted refresh token in the
`pluralbuddy_oauth_connections` database table. TomoriBot uses the encryption key from `.env` or
`SECRET_FILE` to read them and renew access. The OAuth client secret does not belong in `.env`, and
the bot no longer reads `PLURALBUDDY_CLIENT_ID` or `PLURALBUDDY_CLIENT_SECRET` variables.

This setup authorizes the official `pluralbuddy.app` instance. Custom PluralBuddy selection is not
available yet. The [PluralBuddy support page](/features/integrations/pluralbuddy-support/) explains
what users can expect. See the [message-proxy architecture](/architecture/integrations/message-proxy/)
for token storage and refresh behavior.
