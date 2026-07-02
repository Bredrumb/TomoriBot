---
title: "Multiple Personas"
sidebar:
  order: 2
---

TomoriBot's personality lives in a **persona**: her name, avatar, traits, speaking style, and
behavior. You can run several personas at once, each a distinct character with its own
triggers and webhook avatar. This page is about *how she behaves* — for *what she knows*
(facts and memories), see [Memory](/features/memory/).

## Creating a Persona

- `/persona create` — build a custom personality from scratch.
- `/persona generate` — have the AI generate a personality from a description and an image.
  Requires a provider that supports structured output. You can also upload an existing
  TomoriBot preset or a SillyTavern card here to transform an existing character (see
  [SillyTavern Support](/features/sillytavern-support/)).
- `/persona default` — switch to one of the built-in default personalities as a foundation.
- `/persona export` / `/persona import` — share or back up a persona as a file. Import
  supports bringing a persona in as an **alter** with its own triggers and webhook avatar.
- `/persona remove` — remove an alter persona.

A good starting workflow: pick a default or generate one, then refine it with attributes
and sample dialogues below.

## Shaping Personality

Two commands do most of the work of teaching her how to talk and act:

### Attributes

`/persona attribute add` adds personality traits or physical characteristics — for example
`friendly`, `red hair`, or `ends sentences with *Nya~*`. Remove them with
`/persona attribute remove`.

### Sample Dialogues

`/persona sample-dialogue add` teaches her *how she speaks* by example. Use the `{user}` and
`{bot}` placeholders so dialogues work for everyone (and when you share the persona):

- `{user}` — replaced with the actual user's name/nickname
- `{bot}` — replaced with her current name

```text
{user}: What's your favorite hobby?
{bot}: Fufu~ I like knitting tiny clothes for tiny plushies~♥
```

Tips for effective sample dialogues:

- Write natural, conversational exchanges.
- Bake in the attributes and traits you want her to exhibit.
- Demonstrate the tone you're after, and add variety so she generalizes.

Remove examples with `/persona sample-dialogue remove`.

### Name and Avatar

- `/persona rename` — set what she calls herself.
- `/persona avatar` (or `/server avatar`) — set her profile picture for this server.

You can also set a custom system prompt with `/config system-prompt set` to further shape
behavior — see [Behavior Tweaking](/features/behavior-tweaking/).

## Alter Personas

Alter personas let multiple characters coexist in one server:

- Each alter has its own personality, trigger words, and **webhook avatar** — so different
  characters appear with different names and pictures in the same channel.
- Multiple alters can respond to a single message, up to the `/config trigger-match-limit`
  limit.
- **Replying to a webhook message** continues the conversation as that persona.
- Add alters via `/persona import` (alter option); manage them with `/persona` and
  `/persona remove`.

This is what makes group roleplay and multi-character servers possible. For the runtime
details of how triggers route to personas and how webhook identities work, see the
architecture reference on [multi-persona behavior](/architecture/subsystems/multi-persona/).

## Expressions & Reactions

Personas can use your server's custom emojis and stickers, and react to messages:

- Custom emojis are used naturally in conversation with case-insensitive `:name:` syntax.
- Stickers can accompany replies; she can also add emoji reactions.
- Run `/server expressions initialize` to register your server's emojis and stickers so she
  uses them accurately.

## Per-Channel Persona Picks

Want to control which persona answers *you* in a specific channel without changing the
server-wide setup? That's Personal Spotlight — see
[Personalization](/features/personalization/#personal-spotlight).
