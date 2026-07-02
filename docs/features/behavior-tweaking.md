---
title: "Behavior Tweaking"
sidebar:
  order: 10
---

TomoriBot's behavior — **what she's allowed to do and how she generates** — is controlled by
`/capabilities` and `/config`, beyond personality ([Multiple Personas](/features/multiple-personas/))
and knowledge ([Memory](/features/memory/)). This page is a curated set of the high-value
knobs — every command is in the [Command Reference](/features/command-reference/).

## Capabilities: What She's Allowed to Do

`/capabilities` toggles her features on and off — image generation, sticker usage, thread
creation, message management, user blocking, self-teaching, voice messages, and more. Each
toggle is the feature flag that gates the matching tool (see
[Tools & Extensions](/features/tools-and-extensions/)). Turn something off and she simply
can't do it, no matter what a user asks.

## Generation Tuning

- `/config samplers` — sampling parameters (temperature, top-p, …): creativity/randomness.
  Higher temperature is more varied.
- `/config humanizer` — how human-like her responses read.
- `/config message-fetch-limit` — how many recent messages she pulls as context per trigger.
  A useful lever: raise it for more conversational awareness, lower it to cut token cost.

## System Prompt

The system prompt sits above the persona and shapes overall behavior:

- `/config system-prompt set` — set a custom system instruction (up to 16,000 characters).
- `/config system-prompt preset` — choose from preset system prompts.
- `/config system-prompt remove` — reset to the default.

When a [SillyTavern preset](/features/sillytavern-support/) is active, the built-in fallback
system prompt is replaced — but a custom one you set here is still sent.

## Uncensored Output

`/nsfw jailbreaks` configures uncensored output options. Some related commands are
age-restricted — see [Age-Restricted Commands](/introduction/quickstart/#age-restricted-commands).

## Appearance & Time

- `/persona rename` — what she calls herself.
- `/server timezone` — the server timezone, used for time-aware replies and reminders.

---

Looking for admin/cost controls (quotas, whitelists, BYOK) rather than behavior? Those live
under [Server Moderation](/features/server-moderation/).
