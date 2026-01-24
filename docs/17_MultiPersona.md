# 17. Multi-Persona System

This document describes TomoriBot's multi-persona system: how main and alter personas are stored, triggered, and rendered (webhooks, embeds, stickers, reminders), plus operational details and limitations.

## Overview

TomoriBot supports **one main persona** plus **multiple alter personas** per server.

- **Main persona**: the default identity; responds to mentions, direct replies, and auto-message triggers.
- **Alter personas**: optional additional identities with their own trigger words and (optional) custom avatars.
- **Shared context**: all personas share the same conversation history and server memories.
- **Shared config**: all personas in a server share the same `tomori_configs` row.
- **Sequential responses**: if multiple personas match a trigger, they respond one-by-one via the channel queue.

## Data Model

### `tomoris`

Each persona is a row in `tomoris`.

Key columns:
- `is_alter`: `false` for main, `true` for alters.
- `alter_triggers`: trigger words for alters (main uses `tomori_configs.trigger_words`).
- `webhook_avatar_url`: stored CDN URL for alter avatars (from import embed).

### `tomori_configs`

Server-scoped config (shared by all personas):
- `server_id` is the primary linkage.
- `trigger_words` is used by **main persona only**.

### `reminders`

Reminders are tied to a persona to preserve the identity that set them:
- `persona_id` (nullable): the `tomori_id` that created the reminder.
- When missing or invalid, reminders **fall back to the main persona**.

## Triggering and Routing

### Direct replies and mentions

- **Reply to bot** (main persona messages) → main persona responds.
- **Reply to alter webhook message** → the matching alter responds.
  - Matching is done by webhook `author.username` → persona nickname (case-insensitive).
  - Ensure persona nicknames are unique.
- **Bot mention** → main persona responds.
- **Auto-message threshold** → main persona responds.

### Trigger words

Each persona checks its own trigger list:
- **Main**: `tomori_configs.trigger_words`.
- **Alter**: `tomoris.alter_triggers`.

If multiple personas match, all respond in a randomized order.

### Manual triggers

Manual triggers can specify `selectedPersonaId`. In that case, **only that persona responds** (fallbacks apply if missing).

## Response Pipeline (Multi-Persona)

High-level flow (per incoming message):

1. Identify matching personas.
2. Queue additional personas to ensure sequential replies.
3. For each persona:
   - Build context from shared history.
   - Use isolated function-call history per persona.
   - Stream response with persona-specific webhook settings if applicable.

**Important limitation**: later personas **do not** see earlier persona responses in their context (deferred for future refactor).

## Webhook Strategy

Webhook usage differs by environment:

### Production

- Uses a **single channel webhook** (`TomoriBot Multi-Persona`).
- Alters send messages through that webhook with:
  - `username` = persona nickname
  - `avatarURL` = `webhook_avatar_url` (validated) or fallback

### Non-production

- Uses **per-persona webhooks** (`TomoriBot Persona {id}`).
- Webhook avatar is set directly from stored avatar data (downloaded and converted to PNG).

### Supported channels

Webhooks are supported in:
- `GuildText`
- `PublicThread`
- `PrivateThread`
- `AnnouncementThread`

DMs do not support webhooks.

### Failure behavior

If webhook creation or sending fails:
- A localized warning embed is shown (rate-limited).
- The bot falls back to normal messages.

## Tool Calls, Embeds, and Stickers

### Tool-call embeds

Tools can send embeds via `sendStandardEmbed`. The tool execution context includes persona webhook info:

- If a webhook is available, embeds are sent through that webhook with persona name/avatar.
- Otherwise, embeds are sent as normal bot messages.

### Stickers (alter personas)

Discord webhooks cannot send actual stickers. For alters:
- After streaming, TomoriBot sends the **sticker CDN URL** via webhook.
- If webhook send fails, it falls back to sending the actual sticker as the bot.

Main persona uses normal sticker sends.

## Reminders (Persona-Specific)

Reminder tool now stores the creating persona:

- `set_reminder_for_user` saves `persona_id` in the `reminders` table.
- Reminder timer passes `selectedPersonaId` into `tomoriChat`.

Behavior:
- If the persona still exists, that persona responds.
- If the persona is missing, **fallback to main**.
- Mention verification includes webhook messages, and sends a fallback ping if the response did not mention the target.

## Commands and Workflows

### `/persona import`

- `type: main` replaces main persona.
- `type: alter` creates a new alter persona:
  - Unique triggers enforced (no overlaps).
  - Avatar URL stored in `webhook_avatar_url`.

### `/persona remove`

- Removes a selected alter persona.
- Deletes persona-specific webhooks in non-production.

### `/persona swap`

- Promotes an alter to main.
- Transfers triggers between `alter_triggers` and `tomori_configs.trigger_words`.
- Updates guild avatar and nickname.
- Stores the previous main avatar in `webhook_avatar_url`.

## Caching and Invalidation

### Persona cache

`getCachedAllPersonas()` loads and caches all personas for a server.

Invalidate cache after:
- Importing/removing/swapping personas.
- Updating triggers or avatars.

### Webhook cache

Two in-memory caches:
- `webhookCache` (channel webhook)
- `personaWebhookCache` (per-persona webhook in non-production)

Caches invalidate if tokens are missing or webhooks are deleted.

## Limitations and Edge Cases

- **Context refresh**: later personas do not see earlier persona replies (deferred).
- **Webhook username collision**: reply routing relies on unique persona nicknames.
- **DMs**: no webhook support; alters are not available in DMs.
- **Sticker rendering**: alter personas send sticker **URL previews** instead of actual stickers.

## Troubleshooting

If an alter doesn’t respond:
- Confirm trigger words are unique and present in `alter_triggers`.
- Check if the message actually contained the trigger or a reply to an alter webhook.
- Verify webhook permissions in the channel.

If an alter embed or sticker looks like the main persona:
- Webhooks may be failing; check permissions.
- In DMs, webhooks are not available.

## Test Checklist (Recommended)

1. Reply to an alter’s webhook message → same alter responds.
2. Trigger multiple alter keywords → all matching personas respond.
3. Tool call as alter → embeds use alter webhook name/avatar.
4. Sticker tool as alter → CDN URL sent via webhook.
5. Reminder created by alter → alter delivers reminder; fallback to main if persona removed.
