# 17. Multi-Persona System

This document describes TomoriBot's multi-persona system: how main and alter personas are stored, triggered, and rendered (webhooks, embeds, stickers, reminders), plus operational details and limitations.

## Overview

TomoriBot supports **one main persona** plus **multiple alter personas** per server.

- **Main persona**: the default identity; responds to mentions, direct replies, and auto-message triggers.
- **Alter personas**: optional additional identities with their own trigger words and (optional) custom avatars.
- **Shared context**: all personas share the same conversation history and server memories.
- **Shared config**: all personas in a server share the same server-scoped config tables (`server_*_configs`).
- **Sequential responses**: if multiple personas match a trigger, they respond one-by-one via the channel queue.

## Data Model

### `tomoris`

Each persona is a row in `tomoris`.

Key columns:
- `is_alter`: `false` for main, `true` for alters.
- `webhook_avatar_url`: stored alter avatar reference.
  - Production: stable public URL (S3 / CloudFront).
  - Non-production: stable local path under `data/avatars/...`, or a legacy HTTP URL until lazy migration runs.

### `persona_configs`

Per-persona configuration (one row per persona in `tomoris`):
- `trigger_words`: trigger words for this persona — **all personas use this column** (Phase 6 F1 merged the former `tomoris.alter_triggers` column here; the old `is_alter ? alter_triggers : trigger_words` ternary is gone).

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
- Direct replies and bot mentions can combine with explicit persona trigger words in the same message. For example, replying to Tomori while mentioning `@Ren` routes the turn to Tomori and Ren.
- **Auto-message threshold** → main persona responds.

### Trigger words

Each persona checks its own trigger list in `persona_configs.trigger_words`. The former split (`tomori_configs.trigger_words` for main, `tomoris.alter_triggers` for alters) was unified in Phase 6 F1.

If multiple personas match, they respond in deterministic order based on where their trigger first appears in the message. The per-message count is capped by `/config trigger-match-limit`.

### Manual triggers

Manual triggers can specify `selectedPersonaId`. In that case, **only that persona responds** (fallbacks apply if missing).

`/bot respond` resolves its implicit persona from recent channel history before falling back:
1. the last known Tomori persona that spoke in the channel;
2. the user's personal spotlight auto-trigger persona, if configured and allowed;
3. the channel's `/server auto-trigger channels` persona assignment, if configured;
4. the main persona.

Configured join welcomes also use the manual-trigger path:
- `/server welcome-channel set` stores a selected persona or `Random`.
- On `guildMemberAdd`, the welcome event resolves that persona and calls `tomoriChat(..., isManuallyTriggered = true, selectedPersonaId = ...)`.
- If `welcome_persona_id` is `NULL`, one persona is chosen uniformly from the server's available personas for that join.

Configured auto-trigger channels can also pin a single persona per channel:
- `/server auto-trigger channels` can enable/disable channels in bulk, or target one channel and choose which persona should answer there.
- The per-channel assignment is stored in `server_auto_trigger_persona_overrides`; the assembled config still exposes it as `autoch_persona_overrides`.
- If a channel has no explicit assignment, auto-trigger falls back to the main persona.

### Personal spotlight

Users can add a channel-scoped personal persona filter with `/personal spotlight set`:

- The spotlight stores a per-user allowed persona set for one channel.
- That set is intersected with the server whitelist result, so personal spotlight can only narrow access, never expand it.
- If the spotlight also chooses an auto-trigger persona, that persona becomes the user+channel-scoped fallback for every qualifying message from that user in that channel.
- `/personal spotlight manage` removes permanent or timed spotlight rows.

## Response Pipeline (Multi-Persona)

High-level flow (per incoming message):

1. Identify matching personas.
2. Queue additional personas to ensure sequential replies.
3. For each persona:
   - Build context from shared history.
   - Use isolated function-call history per persona.
   - Stream response with persona-specific webhook settings if applicable.

**Important limitation**: later personas **do not** see earlier persona responses in their context (deferred for future refactor).

## Self-Reply Trigger System

To prevent infinite loops and unbounded persona activations, TomoriBot implements a **cascade trigger limit** that controls how many persona triggers can occur after the first one in a session.

### Overview

- **Default limit**: 3 (configurable via `/config trigger-cascade-limit`, max 10)
- **Scope**: Per-channel (shared across all personas)
- **Purpose**: Limit the total number of persona activations after the first trigger in a session
- **Origin tracking**: each trigger session keeps the originating user identity so downstream persona self-messages still respect that user’s server whitelist and personal spotlight restrictions

### Mental Model: Trigger Counter

Think of the trigger counter as a budget of additional activations after the first (free) trigger:

```javascript
// With cascadeLimit = 3
const triggerBudget = {
  triggerCount: 0,     // Starts at 0 when user sends a message
  // First trigger:  count 0 → 1  (free, always allowed)
  // Second trigger: count 1 → 2  (1st additional)
  // Third trigger:  count 2 → 3  (2nd additional)
  // Fourth trigger: count 3 → 4  (3rd additional)
  // Fifth trigger:  count 4 → BLOCKED (exceeds limit of 3 additional)
};
```

**Key concepts:**
- The **first trigger** in a session is always free (doesn’t count against the limit)
- Each **additional trigger** increments the counter — whether from multi-persona or chains
- **trigger-cascade-limit = N** means N additional triggers are allowed after the first (N+1 total)
- **Interaction with trigger-match-limit**: the effective max per message is `min(trigger-match-limit, trigger-cascade-limit + 1)`

### How It Works

#### **Trigger Counting**

Every automatic persona activation (not manually triggered) increments the trigger counter:

- **Multi-persona triggers**: User message triggers Alice, Bob, Charlie → Alice is #1 (free), Bob is #2 (additional), Charlie is #3 (additional)
- **Chain triggers**: Alice’s response triggers Dave → Dave counts as an additional trigger
- Both share the same counter for the session

#### **Bypass (No Limit Applied)**

These triggers do NOT increment the counter:

✅ **Slash commands** (`/respond`, `/impersonate`) → `isManuallyTriggered = true`
✅ **Reminders** → Special flags
✅ **Stop responses** → `isStopResponse = true`

#### **Example with limit = 1**

```
User: "@A, @B, @C"       → trigger-match-limit = 3, trigger-cascade-limit = 1
└─ A responds             → triggerCount: 0 → 1 (first, free)
└─ B responds             → triggerCount: 1 → 2 (1 additional, within limit)
└─ C BLOCKED ❌           → would be triggerCount 3, exceeds limit of 1+1=2
```

**Example with limit = 3:**
```
User: "@A"                          → triggerCount: 0 → 1 (first)
  A: "@B, @C"                       → triggerCount: 1 → 2 (B queued), 2 → 3 (C queued)
  B: "@D"                           → triggerCount: 3 → 4 (D responds, limit reached!)
  C: "@E"                           → triggerCount 4, exceeds limit → BLOCKED ❌
```

### Trigger Session Reset

The trigger counter resets to 0 when:

1. **User sends a message** → Immediate reset (starts a new session)
2. **30 minutes of inactivity** → Automatic reset (`SELF_REPLY_CHAIN_TTL_MS`)

**Exception:** if the active user sends a natural-language stop message while a generation is already running, TomoriBot preserves the current trigger count and clears queued cascade work for that session instead of resetting it.

Auto-trigger note: auto-chat / always-reply channel behavior only qualifies on real user-like messages. Persona self-messages do not advance the shared auto-chat counter and do not auto-trigger fresh self turns by themselves. When a channel has an auto-trigger persona assignment, that persona owns the auto-trigger fallback for that channel; explicit trigger-word matches still take priority. Personal spotlight auto-trigger behaves the same way, but only for the spotlight owner in that specific channel.
With deliberate trigger mode enabled, only deliberate trigger invocations count as explicit matches. Plain trigger words no longer override the channel fallback persona unless that persona is the channel’s exempt auto-chat owner.

Proxy-trigger note: if user A is restricted to persona Alice by either server whitelist or personal spotlight, then `Alice -> Bob` self-trigger chains are blocked for that user. Replies, mentions, and other proxy paths do not bypass the originating user’s persona access rules.

### Configuration

**Database:** `server_chat_configs.cascade_limit`
- Default: 3
- Range: 0 to 10
- 0 = Only the first triggered persona responds, no additional triggers allowed
- N = N additional triggers allowed after the first (N+1 total per session)

**Command:** `/config trigger-cascade-limit`

**Database:** `server_chat_configs.match_limit`
- Default: 3
- Range: 1 to 10
- Caps how many personas one message can trigger

**Command:** `/config trigger-match-limit`

### Example Flow

**Setup:** trigger-cascade-limit = 3, trigger-match-limit = 5, Personas A, B, C, D, E

```
Trigger 1: User: "@A, @B"
           └─ triggerCount: 0 → 1 (A, first/free)
           └─ triggerCount: 1 → 2 (B, 1st additional)

Trigger 2: A: "Ask @C!"
           └─ triggerCount: 2 → 3 (C, 2nd additional)

Trigger 3: B: "Yeah, ask @D too!"
           └─ triggerCount: 3 → 4 (D, 3rd additional, limit reached!)

Trigger 4: C: "Maybe @E?"
           └─ triggerCount = 4, exceeds limit → BLOCKED ❌

           User: "Thanks everyone!"
           └─ triggerCount = 0 (session reset)
```

### Behavioral Summary

| trigger-cascade-limit | Total triggers allowed | Behavior |
|---|---|---|
| 0 | 1 | Only first persona responds, no chains or multi-persona |
| 1 | 2 | First + 1 additional |
| 3 (default) | 4 | First + 3 additional |
| 10 (max) | 11 | First + 10 additional |

**Interaction with trigger-match-limit**: `effective_max_per_message = min(trigger-match-limit, trigger-cascade-limit + 1)`

### Key Insights

1. **First trigger is free** — The first persona activation in a session never counts against the limit
2. **Multi-persona and chains share one counter** — All additional triggers increment the same counter
3. **Shared counter** — All personas share the same trigger counter per channel
4. **trigger-match-limit caps breadth, trigger-cascade-limit caps total** — Together they control both dimensions

### Troubleshooting

**Personas not responding after several triggers?**
- Check if cascade trigger limit is reached
- Look for log: `Self-reply trigger limit reached (X)`
- Have a user send a message to reset the session
- Increase limit with `/config trigger-cascade-limit` (max 10)

**Want to allow only the first persona to respond?**
- Set limit to 0: `/config trigger-cascade-limit limit:0`
- Only the first triggered persona will respond, no additional triggers

**Need to stop a persona chain without reopening the limit budget?**
- Send a natural stop message while your generation is active
- TomoriBot will stop the active stream and clear queued cascade work for that chain
- Unlike a normal user message, that stop message does not reset the trigger count

## Webhook Strategy

Webhook usage differs by environment:

### Production

- Uses a **single channel webhook** (`TomoriBot Multi-Persona`).
- Alters send messages through that webhook with:
  - `username` = persona nickname
  - `avatarURL` = `webhook_avatar_url` (S3 URL, never expires)
- **Avatar storage**: Uploaded to S3 during import
- **Robustness**: High (S3 URLs are permanent and centralized)

### Non-production (Local Development)

- Uses the same **shared channel webhook** (`TomoriBot Multi-Persona`) as production.
- Alters send messages through that webhook with:
  - `username` = persona nickname
  - `avatarURL` = public URL built from `AVATAR_PUBLIC_BASE_URL` when configured
  - otherwise TomoriBot mutates the shared webhook avatar from the local file immediately before sending
  - if no alter avatar resolves, TomoriBot resets the shared webhook avatar before sending so a previous local avatar cannot leak onto the next persona
- **Avatar storage**: Alter avatars are stored locally under `data/avatars/servers/{guildId}/personas/{personaId}/...`
- **Legacy persona webhooks** (`TomoriBot Persona {id}`) are no longer part of steady-state sending. They remain recovery sources for lazy migration and may be cleaned up manually later.

#### **Avatar URL Lifecycle (Local)**

1. **Import/default/server avatar update:** avatar is normalized to PNG and stored locally.
2. **DB write:** `webhook_avatar_url` is updated to the local stored path.
3. **Optional URL mode:** if `AVATAR_PUBLIC_BASE_URL` is configured, TomoriBot builds a public URL by stripping the `data/avatars/` prefix and appending the remainder to that base URL.
4. **Fallback mode:** if no public base URL is configured, TomoriBot loads the local file and mutates the shared webhook avatar for the send.

**Result:** Local installs no longer depend on per-persona webhooks just to persist avatar media.

#### **Lazy Migration for Existing Local Installs**

If an older local install still has an HTTP(S) avatar reference in `webhook_avatar_url`:

1. TomoriBot tries to download that avatar on first alter send.
2. The avatar is normalized to PNG, stored locally, and the DB is updated to the new local path.
3. If the HTTP(S) download fails, TomoriBot scans surviving legacy `TomoriBot Persona {id}` webhooks in the guild, recovers one avatar, stores it locally, and updates the DB.

Legacy persona webhooks are intentionally left in place by this migration. They are recovery sources, not part of the normal send path.

#### **Robustness Features (Local)**

##### **1. Auto-Recovery from Legacy Persona Webhooks**

**What:** When webhook avatar download fails (404), automatically scans guild for surviving webhooks with the same persona.

**Why:** Existing local installs may still only have webhook-backed avatar media. Recovery finds a surviving legacy webhook and migrates that avatar into local storage.

**Behavior:**
- Triggered on download failure during lazy migration
- Scans all text channels in guild for webhooks matching `TomoriBot Persona {id}`
- Downloads avatar from first surviving webhook found
- Stores avatar locally
- Updates database with the new local path
- Returns recovered avatar for immediate use

**Fallback:** If no surviving webhooks found, the send falls back to the owner name without a custom avatar (or to the original HTTP URL if it is still usable).

**Code location:** `src/utils/discord/webhookManager.ts` (`attemptWebhookAvatarRecovery`)

#### **Edge Cases (Local)**

**✅ Solved:**
1. **Webhook slot pressure** → local alters no longer create per-persona send webhooks
2. **Legacy URL expired** → lazy migration recovers from a surviving legacy webhook
3. **No public avatar host configured** → shared webhook avatar mutation fallback still preserves alter identity

**⚠️ Rare (Terminal):**
- **All legacy recovery sources gone and stored file missing** → manual re-import required
- **Operator configures `AVATAR_PUBLIC_BASE_URL` but does not actually serve `data/avatars/`** → avatar URLs will be broken until the host is fixed

**Mitigation:** Existing legacy webhooks are left untouched so old installs retain a recovery source. New installs do not need them for normal operation.

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

### Identity Resolution for Historic Messages

Main persona and alter messages carry their identity through **different Discord primitives**. Any code that needs to recover the author label for an older message (reply-context embeds, quote headers, memory extraction, etc.) must handle both.

| Persona type | Send path | Identity stored as | Recover via |
|--------------|-----------|--------------------|-------------|
| **Main persona** | Bot's own Discord user (direct reply) | Bot's **guild member nickname at send time** | `message.member.displayName` |
| **Alter persona** | Shared channel webhook with per-send override | Per-message `username` override baked into the webhook send | `message.author.username` (+ `stripBridgePrefix`) |

**Why the asymmetry matters:** the currently active `tomoriState.tomori_nickname` is **not** a safe proxy for the author of a historic message. It reflects "who is talking right now," not "who sent that older message." Using it to label prior messages causes cross-persona mislabeling whenever an alter switch has happened between send and now (e.g. Evil Lilya replying to an earlier Aphel message would render "Replying to Evil Lilya").

**Resolution order** (implemented in `src/utils/discord/webhookReply.ts` → `getReplyContextAuthorName`):

1. `message.webhookId` set → webhook message → use `stripBridgePrefix(message.author.username)`.
2. `message.author.id === botUserId` (non-webhook bot message) → prefer `message.member.displayName` (Discord snapshots this per message), fall back to current `botName` only if the member snapshot is missing.
3. Normal user message → `message.member.displayName ?? author.globalName ?? author.username`.

**Implication:** this works because TomoriBot renames its own guild member when the main persona is active. If a deployment disables that renaming, branch 2 will collapse back to `botName` and the same cross-persona mislabeling returns for main-persona history. Keep the guild-member rename tied to main-persona activation.

## Tool Calls, Embeds, and Stickers

### Tool-call embeds

Tools can send embeds via `sendStandardEmbed`. The tool execution context includes persona webhook info:

- If a webhook is available, embeds are sent through that webhook with persona name/avatar.
- Otherwise, embeds are sent as normal bot messages.

The same shared webhook identity path is used for streamed chunks, tool embeds, generated images, sticker URL sends, reminder fallback pings, and manual alter impersonation.

### Persona IDs in context

When alter persona webhook messages are part of recent chat context, TomoriBot
surfaces those participants in "users in conversation" using the persona's
database `tomori_id` (short numeric). This avoids production/local webhook ID
differences and gives tools a stable ID for avatar targeting.

Non-persona webhook participants (if any) are still surfaced by webhook ID.
Both are rendered as regular conversation users in context (no explicit webhook/persona
identity label).
Responding alter personas are injected into that list each turn, so they can
always self-target avatar tools with their own `tomori_id` even when no previous
webhook message is present in the fetched history window.
When alter personas are active, TomoriBot suppresses the extra bot-account user
entry to avoid duplicate/confusing IDs in that list.

### Stickers (alter personas)

Discord webhooks cannot send actual stickers. For alters:
- After streaming, TomoriBot sends the **sticker CDN URL** via webhook.
- If webhook send fails, it falls back to sending the actual sticker as the bot.

Main persona uses normal sticker sends.

## Reminders (Persona-Specific)

Reminder tool now stores the creating persona:

- `create_task` saves `persona_id` in the `reminders` table.
- Reminder execution passes `selectedPersonaId` into `tomoriChat`.

Behavior:
- If the persona still exists, that persona responds.
- If the persona is missing, **fallback to main**.
- Mention verification includes webhook messages, and sends a fallback ping if the response did not mention the target.

## Commands and Workflows

### `/persona import`

- `type: main` replaces main persona.
- Accepts native Tomori PNG exports plus supported SillyTavern PNG / JSON character cards.
- `type: alter` creates a new alter persona:
  - Unique triggers enforced (no overlaps).
  - Avatar reference stored in `webhook_avatar_url` (production URL or non-production local path).
  - If the imported card has no avatar image, the alter falls back to the current main persona avatar and the success embed explains that fallback.

### `/persona remove`

- Removes a selected alter persona.
- Deletes the stored avatar file/reference when present.
- Does **not** automatically delete legacy persona webhooks.

### Persona Memory Editing

- `/persona attribute add|edit|remove` manages `attribute_list` for a selected persona.
- `/persona sample-dialogue add|edit|remove` manages the paired `sample_dialogues_in/out` arrays for a selected persona.
- Edit flows reuse the existing persona picker and item selector, then show a confirmation button before opening a prefilled edit modal.

### `/persona swap`

- Promotes an alter to main.
- Updates `persona_configs.trigger_words` for both personas (all trigger words unified in `persona_configs.trigger_words` after Phase 6 F1).
- Updates guild avatar and nickname.
- Stores the previous main avatar in `webhook_avatar_url`.
- Local alter avatars are loaded from the stored file path when present.

## Caching and Invalidation

### Persona cache

`getCachedAllPersonas()` loads and caches all personas for a server.

Invalidate cache after:
- Importing/removing/swapping personas.
- Updating triggers or avatars.

### Webhook cache

In-memory caches:
- `webhookCache` (shared channel webhook)
- `personaWebhookCache` (legacy per-persona webhook cache; retained for recovery / compatibility helpers)

**Cache behavior:**
- No TTL (persist until bot restart or manual invalidation)
- Shared channel webhook tokens are also stored encrypted in Postgres so restart recovery can restore the same webhook without recreating it
- Token validation on cache hit (recreates if webhook was deleted)
- Auto-invalidation on webhook errors (codes 10015, 50027)
- Avatar mutation sends also use a per-target-channel mutation lock so concurrent sends cannot cross-contaminate webhook avatars.

## Limitations and Edge Cases

### General

- **Context refresh**: later personas do not see earlier persona replies (deferred).
- **Webhook username collision**: reply routing relies on unique persona nicknames.
- **DMs**: no webhook support; alters are not available in DMs.
- **Sticker rendering**: alter personas send sticker **URL previews** instead of actual stickers.

### Self-Reply Trigger Limits

- **Shared counter**: All personas share one trigger counter per channel (not per-persona).
- **Counter blocks all**: When trigger count exceeds limit, ALL additional persona triggers are blocked (user can reset by sending a message).
- **First trigger free**: The first persona activation in a session doesn't count against the limit.
- **Multi-persona counts**: Each persona activation after the first increments the counter, whether from multi-persona triggers or chains.

### Webhooks (Local Development)

- **Legacy URL expiration (mitigated)**: lazy migration copies old HTTP(S) avatar references into local storage on first use.
- **Legacy webhook deletion (mitigated)**: auto-recovery scans guild for surviving legacy persona webhooks during migration.
- **Terminal case**: if all legacy recovery sources are gone and no local file exists, avatar is unrecoverable without re-import.
- **Webhook limit**: steady-state local mode now uses one shared webhook per channel, so normal alter traffic no longer burns one webhook slot per persona.

## Troubleshooting

### Alter doesn't respond

1. **Check trigger words:**
   - Confirm trigger words are unique and present in `persona_configs.trigger_words`
   - Check if message contained the trigger or was a reply to alter webhook

2. **Check cascade trigger limit:**
   - Look for log: `Self-reply trigger limit reached (X)`
   - Have a user send a message to reset the session
   - Increase limit with `/config trigger-cascade-limit` if needed

3. **Check webhook permissions:**
   - Verify bot has `MANAGE_WEBHOOKS` permission in channel
   - Check if channel supports webhooks (not DM)

### Alter has wrong avatar or name

1. **Webhooks failing:**
   - Check permissions (`MANAGE_WEBHOOKS`)
   - Look for warning embed in channel (rate-limited)
   - Check logs for webhook errors

2. **Local development avatar issues:**
   - Check whether `webhook_avatar_url` now points to a local `data/avatars/...` path
   - If legacy HTTP(S) value is still present, next use should trigger lazy migration
   - If migration fails:
     - Look for log: `Attempting legacy webhook recovery for persona X`
     - Confirm at least one legacy `TomoriBot Persona {id}` webhook still exists somewhere in the guild
   - If no recovery source exists, re-import the persona avatar

3. **DM limitations:**
   - Webhooks not supported in DMs
   - Alters will use main persona appearance

### Self-reply trigger issues

**Personas stop responding after several triggers:**
- Trigger limit reached (default: 3 additional after first)
- User message resets the trigger session
- Check current limit: `/config trigger-cascade-limit`
- Increase limit (max 10) or set to 0 for first-trigger-only

**Personas triggering infinite loops:**
- Limit is too high
- Reduce limit with `/config trigger-cascade-limit`
- Check persona personalities (may be too eager to mention each other)

## Test Checklist (Recommended)

### Basic Functionality

1. **Reply routing:** Reply to an alter's webhook message → same alter responds.
2. **Multi-trigger:** Trigger multiple alter keywords → all matching personas respond.
3. **Tool embeds:** Tool call as alter → embeds use alter webhook name/avatar.
4. **Stickers:** Sticker tool as alter → CDN URL sent via webhook.
5. **Reminders:** Reminder created by alter → alter delivers reminder; fallback to main if persona removed.

### Self-Reply Trigger Limits

6. **First trigger free:** User triggers 3 personas with trigger-cascade-limit = 1 → first 2 respond (first free + 1 additional), 3rd blocked.
7. **Chain triggers count:** Persona A → B → C → each additional trigger counts toward the limit.
8. **Multi-persona counts:** User message triggers B, C, D → each after the first increments the trigger counter.
9. **Session reset:** After trigger limit reached, user message → counter resets, personas respond again.
10. **Limit configuration:** `/config trigger-cascade-limit limit:5` → new limit applies immediately.

### Webhook Robustness (Local Development)

11. **Local storage:** Import alter or set alter avatar → verify `webhook_avatar_url` stores a `data/avatars/...` path in non-production.
12. **Lazy migration:** Existing local persona with HTTP(S) `webhook_avatar_url` → first alter send migrates to a local path.
13. **Recovery path:** Break the legacy HTTP(S) URL but keep one legacy `TomoriBot Persona {id}` webhook → next send recovers avatar and stores a local path.
14. **Shared webhook identity:** Use the same alter in multiple channels/threads → messages still show the correct persona sender without creating new persona webhooks.
15. **Restart recovery:** Restart the bot, then trigger an alter reply in the same channel → the existing shared webhook is restored from encrypted storage instead of being recreated, so recent alter messages remain manageable.
