---
title: "Personalization"
sidebar:
  order: 8
---

TomoriBot can be configured for **you specifically** with the `/personal` commands — settings
that follow you across every server you share with her, independent of any server's
configuration.

## Your Own Providers

Personal providers let *your* messages use *your own* API keys and models instead of the
server's defaults. This is bring-your-own-key (BYOK) at the individual level.

**Setup:**

1. `/personal provider add` — save a provider (your key is encrypted).
2. `/personal model` — choose a model for it.
3. `/personal provider toggle` — turn that capability on.

When enabled, your personal provider overrides the server for that capability. Thought logs
attribute those turns to you, and you can tune them with `/personal provider samplers` and
`/personal provider fallback`. You can also register personal custom endpoints with
`/personal custom-endpoint add` — see
[Custom Endpoints](/features/providers-and-models/#custom-endpoints).

:::note[BYOK-required servers]
A server can require member-provided providers with User BYOK mode
([Server Moderation](/features/server-moderation/#user-byok-bring-your-own-key)). When that's
on, your user-triggered messages need a personal provider before she can answer. Personal
providers apply across every server you use her in.
:::

## Personal Spotlight

**Personal Spotlight: per-channel persona picks.** Spotlight lets *you* narrow which personas
you can trigger in one channel — and optionally assign one to auto-trigger for your own
messages there. It's scoped to **you + one channel** and doesn't affect anyone else.

**Set one up** with `/personal spotlight set`, choosing:

- a duration in hours (use **0** to keep it until you remove it manually),
- the target channel,
- the personas you want in your spotlight.

After choosing personas, you can optionally pick one as your **personal auto-trigger
persona** — the fallback responder for your messages in that channel. Direct triggers still
target whichever persona you explicitly call. Press Finish to skip.

**Important rules:**

- Spotlight only **narrows** access; it never expands it. The selected personas are the
  *only* ones you can trigger there.
- It still respects server-level limits like `/server whitelist persona`.
- Proxy chains are blocked: if your spotlight only includes Alice, an Alice reply can't hand
  off to Bob for your message chain.

Review or remove entries with `/personal spotlight manage` (uncheck to remove; timed
spotlights expire on their own). Run `/help spotlight` for the Discord summary.

## Other Personal Settings

- `/personal nickname` — change what she calls you.
- `/personal privacy` — control your visibility to her, up to **full invisibility** (opt out
  of memory features entirely).
- `/personal dtm` — your personal override for
  [Deliberate Trigger Mode](/features/chatting-and-triggers/#deliberate-trigger-mode).
- `/personal stm` — opt into cross-server short-term memory sharing;
  `/personal stm clear` wipes your STM.
- `/personal impersonate prompt` — set a reusable prompt for when she impersonates you via
  `/bot impersonate`.

## Personal Memories

Facts she remembers about you follow you between servers. Managing them (add, remove, export)
is covered on the [Memory](/features/memory/#personal-vs-server-memories) page.
