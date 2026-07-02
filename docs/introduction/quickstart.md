---
title: "Quickstart"
sidebar:
  order: 1
---

This guide takes you from zero to your first conversation with TomoriBot. Most people
want the hosted bot — that path is first. If you'd rather run your own instance, jump to
[Self-hosting](#self-hosting) at the bottom.

## Use the Hosted Bot

### Step 1 — Invite her

Invite the public instance with the button below, then pick the server you want her in.
You need the **Manage Server** permission to add a bot.

**[→ Invite TomoriBot](https://discord.com/oauth2/authorize?client_id=841644102059556915)**

You can also DM her directly — the setup steps are the same.

### Step 2 — Get an API key

TomoriBot doesn't ship with an AI brain of its own; you connect one. She supports many
providers, and you only need **one** to get started:

- **Google Gemini** — general-purpose, has a free tier, runs every feature. Recommended
  for your first setup.
- **OpenRouter** — one key, access to many models (some free).
- **NovelAI** — subscription-based, uncensored roleplay and storytelling.
- **DeepSeek**, **NVIDIA NIM**, **Anthropic**, **Vertex AI**, **Z.ai**, or any
  OpenAI-compatible **Custom** endpoint.

Run `/help api-key` in Discord and pick your provider for exact key-generation steps, or
see [Providers & Models](/features/providers-and-models/#api-keys) for the full list.

:::caution
Never share your API key with anyone. TomoriBot stores it **encrypted** — no one, not
even server admins, can read it back.
:::

### Step 3 — Run setup

Run `/config setup` and paste in your API key. This encrypts the key, initializes her
configuration for the server, and gets her ready to talk. Each server keeps its own
independent configuration.

**Recommended:** run `/server expressions initialize` afterward so she can use your
server's custom emojis and stickers accurately.

### Step 4 — Start chatting

Just **mention her** or **reply** to one of her messages:

```text
@TomoriBot yo, what's up?
```

From here you can shape how she gets triggered and how she behaves:

- Add trigger words with `/server trigger add` so you don't have to @-mention her — see
  [Chatting & Triggers](/features/chatting-and-triggers/).
- Let her respond without being mentioned with `/server autotrigger` (auto-trigger).
- Give her a personality with `/persona` — see [Multiple Personas](/features/multiple-personas/).
- Teach her facts with `/memory` — see [Memory](/features/memory/).

Setting up TomoriBot means you and your server members agree to her `/legal terms` and
`/legal privacy` notices.

## Age-Restricted Commands

Some commands (uncensored output, certain media generation) are **age-restricted** and
hidden until you opt in. To enable them:

1. In Discord, open **User Settings → Privacy & Safety**.
2. Toggle on **Allow access to age-restricted commands in apps**. You must be 18 or older.
3. Age-restricted commands only run in channels marked **NSFW** (right-click a channel →
   **Edit Channel → toggle NSFW**; only server admins can mark channels NSFW).

If a command is restricted and the channel isn't marked NSFW, it simply won't appear.
Age-restricted content is for adult users only — use responsibly and follow Discord's
Community Guidelines. Run `/help nsfw` for the same walkthrough in Discord.

## Self-hosting

Want full control over your data, models, and API keys? You can run your own TomoriBot
instance on your own hardware. The recommended path is the guided setup wizard.

**[→ Self-Hosting Guide](/self-hosting/)**
