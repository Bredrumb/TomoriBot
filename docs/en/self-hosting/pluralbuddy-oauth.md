---
title: "PluralBuddy OAuth Setup"
description: "Authorize your self-hosted TomoriBot to verify messages from approved PluralBuddy instances."
sidebar:
  order: 8
---

A self-hosted TomoriBot needs an authorized PluralBuddy application for the official service and each approved custom instance.

If you use the [public deployed bot](https://discord.com/oauth2/authorize?client_id=841644102059556915),
you do not need to complete this host-side setup. Select PluralBuddy with
`/personal message-proxy service:pluralbuddy`; see
[Message-Proxy Support](/features/integrations/message-proxy-support/#pluralbuddy).

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
   private.
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

The helper reads database settings and encryption keys from `.env` or a `SECRET_FILE` JSON bundle. Keep the bundle outside the repository and back up the encryption key. Enter the client secret at the prompt, rather than storing it in `.env` or passing it as an argument. If PluralBuddy revokes the connection, repeat authorization with the same instance ID.

## Add an approved instance

Use a public HTTPS origin without a path, query, or fragment. The instance must run both a proxy bot and its matching API.

1. On a computer with deployment database access, register a disabled instance:

   ```sh
   bun scripts/db/register-message-proxy-instance.ts register pluralbuddy https://<instance-host> "<display-name>" <bot-user-id>
   bun scripts/db/register-message-proxy-instance.ts inspect
   ```

   For PluralKit, use `pluralkit` as the service. The bot user ID avoids unnecessary lookup waits in servers where that bot is absent.
2. For PluralBuddy, register a separate OAuth application on that instance with the same loopback
   callback pattern as above. Authorize it using the instance ID returned by registration:

   ```sh
   bun scripts/db/authorize-pluralbuddy-instance.ts <instance-id> <callback-url>
   ```

   Repeat authorization to replace credentials or recover from a revoked refresh token. PluralKit does not require this step.
3. From a message written by the matching proxy bot, record its Discord repost ID and sender
   account ID. Check that the instance API resolves that repost, then enable it:

   ```sh
   bun scripts/db/register-message-proxy-instance.ts enable <instance-id> <repost-id> <sender-id>
   ```

   For a new fork, test the bot, OAuth exchange and refresh, and TomoriBot lookup in a disposable deployment before enabling it for users.
4. Users select the enabled instance with `/personal message-proxy service:pluralbuddy instance:<name>`.
   Leaving `instance` empty chooses the official instance. Disabling an instance stops new lookups
   without changing stored profiles.

If the custom proxy bot is replaced, update its Discord bot user ID before offering the instance again:

```sh
bun scripts/db/register-message-proxy-instance.ts set-bot <instance-id> <bot-user-id>
```

Disable or remove a custom instance with:

```sh
bun scripts/db/register-message-proxy-instance.ts disable <instance-id>
bun scripts/db/register-message-proxy-instance.ts remove <instance-id>
```

Removal deletes the OAuth connection and permanently prevents the origin from being registered again. Use `disable` if you may resume the instance. Existing identities and memories remain available, and changes take effect without a restart.

See [Message-Proxy Support](/features/integrations/message-proxy-support/#pluralbuddy) for user setup and the [message-proxy architecture](/architecture/integrations/message-proxy/) for token storage and refresh behavior.
