---
title: "Behavior Tweaking"
sidebar:
  order: 3
---

What TomoriBot is allowed to do and how she generates replies is set in `/config` under
Behavior, Plugins, Channels, and Models. This page covers the most
common behavior settings. 

Her personality
([Multiple Personas](/features/chatting-personality/multiple-personas/)) and knowledge
([Memory](/features/knowledge/memory/)) are covered on their own pages, and admin and cost controls (quotas, whitelists, BYOK)
live under [Server Moderation](/features/setup-administration/server-moderation/). 

## System Prompt
<!-- anchor: system-prompt -->

The system prompt sits above the persona and shapes overall behavior. Everything below is on
`/config` > Behavior > General Behavior:

- **System Prompt**: instructions every persona follows. Set a custom system instruction (up to
  16,000 characters), choose from preset system prompts, or reset to the default. The reset
  confirmation shows the previous prompt so you can restore it if cleared accidentally.
- **Context Note**: a system nudge placed close to the last message, at a depth you choose. Use it
  for reminders the model tends to forget in long chats.
- **Response Prefill**: text she starts every reply with and continues from. It never shows in
  Discord. Prefill only applies when the model can continue it: the panel shows whether it is
  active, and tells you if the model, its Thinking level (use None or Minimal), or Tool Use stops
  it from being used.

:::tip
A note on a persona (under `/config` > `Persona` > `Advanced`) or on a channel (under
`/config` > `Channels` > `Channel Overrides`) replaces the global `Context Note`. If both a persona
note and a channel note are set, both are sent.
:::

When a [SillyTavern preset](/features/integrations/sillytavern-support/) is active, it controls the
system prompt. Turn the preset off to edit the saved server prompt again.

With a NovelAI text model, saved system prompts, persona and channel prompts, context notes,
humanizer prompt instructions, conditioning, and SillyTavern preset instructions are inactive. The `General Behavior`
panel shows this notice; your settings stay saved for other providers. Response prefills
still apply. Xialong uses NovelAI's own system prompt, while GLM 4.6, Kayra, and Erato have no system
block. See [NovelAI special handling](/features/integrations/novelai-text/#context-and-settings).

## Generation Tuning
<!-- anchor: generation-tuning -->

- `/config` > Models > Text Samplers & Parameters: sampling parameters such as temperature
  and top-p. Higher temperature yields more variety.
- `/config` > Behavior > General Behavior: response humanizer degree. Adjust how casually she
  texts. The setting applies server-wide by default, or to an individual persona.
- `/config` > Behavior > General Behavior: message history limit. Raise it for deeper
  conversational context, or lower it to save tokens.

NovelAI counts and fits its formatted prompt within the serving key's subscription allowance.
Switching NovelAI text models loads `Carefree-Kayra`, `Erato-Shosetsu`, or `Default-Xialong` for
the selected model. GLM uses its own defaults. This resets temperature, top-k, top-p, and min-p
and enables those samplers for both server and personal model switches. You can edit them again
after switching. Replacing a key on the same model preserves your sampler settings.
The configured output-token limit takes priority over a NovelAI sampling preset's length, and
may be reduced to leave room for protected context. It also polishes history, sample dialogue, and
memories in the model-facing copy. The humanizer
still formats Discord replies according to its setting. See the
[polishing rules](/features/integrations/novelai-text/#text-polishing-and-discord-delivery).

## Capabilities
<!-- anchor: capabilities-what-shes-allowed-to-do -->

Two pages under `/config` > Plugins control what she can do:

- `/config` > Plugins > Available Tools: image generation, sticker usage, thread creation, message
  management, user blocking, self-teaching, voice messages, and more. Each toggle gates the
  matching tool (see [Tools & Extensions](/features/capabilities/tools-and-extensions/built-in-tools/)), so
  turning off Tool Use disables all of them at once.
- `/config` > Plugins > Context Additions: personalization, emojis in replies, and time awareness.
  These add information to her prompt, so they continue working when Tool Use is disabled.

NovelAI text models cannot call tools. They receive eligible personal memories, but omit emoji
inventories and time information even when those context additions are enabled.

Automatic short-term memory summarization is toggled in `/config` > Behavior > Advanced Memory.
When a capability is turned off, she cannot perform that action regardless of user requests.


## Response drafting
<!-- anchor: response-drafting -->

Open `/config` > `Plugins` > `Response Drafting` to turn review On. It starts Off and applies to
every persona in that server, including queued replies and generated scenes. Server managers
change server settings; your DMs have their own. When On, Tomori holds her reply while a reviewer checks its character voice and scene fit. The
reviewer can ask for one complete revision. 

Models used, prompts used, criteria, etc. can be completely customized in the same page.

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

---


