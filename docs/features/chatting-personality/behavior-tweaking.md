---
title: "Behavior Tweaking"
sidebar:
  order: 3
---

TomoriBot's behavior — **what she's allowed to do and how she generates** — is controlled by
`/capabilities` and `/config`, beyond personality ([Multiple Personas](/features/chatting-personality/multiple-personas/))
and knowledge ([Memory](/features/knowledge/memory/)). This page is a curated set of the high-value
knobs — every command is in the [Command Reference](/features/command-reference/).

## Capabilities: What She's Allowed to Do

`/capabilities` toggles her features on and off — image generation, sticker usage, thread
creation, message management, user blocking, self-teaching, voice messages, and more. Each
toggle is the feature flag that gates the matching tool (see
[Tools & Extensions](/features/capabilities/tools-and-extensions/)). Turn something off and she simply
can't do it, no matter what a user asks.

## Generation Tuning

- `/model parameters` — sampling parameters (temperature, top-p, …): creativity/randomness.
  Higher temperature is more varied.
- `/config humanizer` — how human-like her responses read.
- `/config message-fetch-limit` — how many recent messages she pulls as context per trigger.
  A useful lever: raise it for more conversational awareness, lower it to cut token cost.

## System Prompt

The system prompt sits above the persona and shapes overall behavior:

- `/config system-prompt set` — set a custom system instruction (up to 16,000 characters).
- `/config system-prompt preset` — choose from preset system prompts.
- `/config system-prompt remove` — reset to the default.

When a [SillyTavern preset](/features/integrations/sillytavern-support/) is active, the built-in fallback
system prompt is replaced — but a custom one you set here is still sent.

## Uncensored Output

TomoriBot has **no content filter of its own** — she is not a moderation harness and adds no
safety rails on top of the model. Whatever the underlying provider returns is what she says.
`/nsfw jailbreaks` therefore doesn't "unlock" anything inside TomoriBot; it exists purely to
work around **provider-side** filters that are stricter than you want.

It toggles three independent techniques (all off by default):

- **Prompt injection** — adds a jailbreak instruction block to the context to steer the model
  away from unnecessary refusals.
- **Unicode spaces** — swaps normal spaces for a look-alike Unicode space so keyword/token
  filters don't match on phrases, on the text sent to the model and on her reply.
- **Sanitize** — obfuscates a set of sensitive words for the same reason, likewise on both
  the request and the response.

None of these change what the model is *capable* of — they only reduce how often an
over-eager provider filter blocks otherwise-normal output. Some of these options are
age-restricted — see
[Age-Restricted Commands](/features/setup-administration/age-restricted-commands/).

## Appearance & Time

- `/persona rename` — what she calls herself.
- `/server timezone` — the server timezone, used for time-aware replies and reminders.

---

Looking for admin/cost controls (quotas, whitelists, BYOK) rather than behavior? Those live
under [Server Moderation](/features/setup-administration/server-moderation/).
