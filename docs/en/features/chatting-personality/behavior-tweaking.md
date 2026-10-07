---
title: "Behavior Tweaking"
sidebar:
  order: 3
---

TomoriBot's behavior (what she is allowed to do and how she generates) is controlled
by `/config` > Permissions and `/config`, beyond personality
([Multiple Personas](/features/chatting-personality/multiple-personas/)) and knowledge
([Memory](/features/knowledge/memory/)). This page covers the most common settings.

## Capabilities: What She's Allowed to Do
<!-- anchor: capabilities-what-shes-allowed-to-do -->

`/config` > Plugins toggles features across two pages:

- **Available Tools**: image generation, sticker usage, thread creation, message management,
  user blocking, self-teaching, voice messages, and more. Each toggle gates the matching tool
  (see [Tools & Extensions](/features/capabilities/tools-and-extensions/)), so turning off
  Tool Use disables all of them at once.
- **Context Additions**: personalization, emojis in replies, and time awareness. These add
  information to her prompt, so they continue working when Tool Use is disabled.

Automatic short-term memory summarization is toggled in `/config` > Behavior > Advanced Memory.
When a capability is turned off, she cannot perform that action regardless of user requests.


## Expressions
<!-- anchor: expressions -->

Expressions let your personas react with more than words. She can use your server's emojis and
stickers, and you can give her reactions of your own: a favorite GIF, an inside-joke image, or a link
to anything on the web. Describe when each one fits, and she sends it when the moment comes.

Members with Manage Server open `/expressions manage` to browse everything in three tabs: `Emojis`,
`Stickers`, and `Customs`.

### Your Server's Emojis and Stickers

Run `/expressions initialize` and she looks at each emoji and sticker to learn when it fits. Ones
added later show as uninitialized in `/expressions manage` until you run it again. To correct her,
select one and choose `Edit` to change its description and emotion, or `Clear Info` to erase them.

### Custom Expressions

In `Customs`, open the menu and choose `+ Add a custom expression`. Give it a name, a description of
when to use it, an emotion, and either a link or a file. She reads the description to decide when to
send it, so be specific: "when chat gets unhinged" works better than "funny".

A link can point to anything. She posts it exactly as saved, and Discord shows it the way it shows
any link: a GIF link from a site like Tenor plays as a GIF, an image link shows the image, and a
website shows its preview card. That makes links good for jokes, like a hospital's website for the
moment chat gets unhinged. Links must start with `https://`.

Files can be PNG, JPEG, WebP, GIF, or MP4, up to 10 MB.

Every persona can use a new custom expression. To keep one for specific personas, select it and use
`Add Persona`. Removing the last persona from that list opens it to everyone again.

### How She Uses Them

With Sticker Usage on in `/config` > Plugins, she sends at most one expression per reply, as its own
message before, between, or after her text. She doesn't use them in
[roleplay channels](/features/chatting-personality/chatting-and-triggers/#roleplay-channels).
`/expressions manage` shows how many times personas have used each one.

## Generation Tuning
<!-- anchor: generation-tuning -->

- `/config` > Models > Text Samplers & Parameters: sampling parameters such as temperature
  and top-p. Higher temperature yields more variety.
- `/config` > Behavior > General Behavior: response humanizer degree. Adjust how casually she
  texts. The setting applies server-wide by default, or to an individual persona.
- `/config` > Behavior > General Behavior: message history limit. Raise it for deeper
  conversational context, or lower it to save tokens.

## System Prompt
<!-- anchor: system-prompt -->

The system prompt sits above the persona and shapes overall behavior:

- `/config` > Behavior > General Behavior: set a custom system instruction (up to 16,000 characters).
- `/config` > Behavior > General Behavior: choose from preset system prompts.
- `/config` > Behavior > General Behavior: reset to default. The confirmation shows the previous
  prompt so you can restore it if cleared accidentally.

When a [SillyTavern preset](/features/integrations/sillytavern-support/) is active, the built-in
fallback system prompt is replaced, but a custom one you set here is still sent.

## Uncensored Output
<!-- anchor: uncensored-output -->

TomoriBot has no content filter of its own: she adds no moderation layer on top of the model,
and replies with whatever the provider generates. `/nsfw jailbreaks` does not enable hidden
bot features; it works around provider-side filters that are stricter than desired.

It toggles three independent techniques (all off by default):

- **Prompt injection**: adds an instruction block to the context to steer the model away
  from unnecessary refusals.
- **Unicode spaces**: swaps normal spaces for look-alike Unicode spaces so keyword filters
  do not trigger on phrases, applied to both the prompt and her reply.
- **Sanitize**: obfuscates sensitive words for the same reason, on both requests and replies.

None of these change what the model can do; they only reduce how often a provider filter
blocks otherwise normal output. Some of these options are age-restricted; see
[Age-Restricted Commands](/features/setup-administration/age-restricted-commands/).

## Appearance & Time

- `/config` > Persona > Identity & Personality: what she calls herself.
- `/config` > Behavior > General Behavior: the server timezone, used for time-aware replies and scheduled tasks.

---

Looking for admin and cost controls (quotas, whitelists, BYOK) rather than behavior? Those
live under [Server Moderation](/features/setup-administration/server-moderation/).
