---
title: "Age-Restricted Commands"
sidebar:
  order: 3
---

TomoriBot keeps its adult-only `/nsfw` command category behind Discord's built-in age gate,
hidden until you opt in. This page explains how to access it and where it works.

TomoriBot does not add a content filter to generated chat, images, or videos. What a model will
generate depends on the provider and model. Image and video generation also depend on the server's
capability settings; they are not gated by the `/nsfw` command category. Other features can have
their own restrictions, such as [Danbooru search](/features/capabilities/tools-and-extensions/danbooru/).

## Enabling Age-Restricted Commands

1. In Discord, open `User Settings` > `Privacy & Safety`.
2. Toggle on `Allow access to age-restricted commands in apps`. You must be 18 or older.
3. Run age-restricted commands in channels marked `Age-Restricted Channel`. To mark
   a channel, right-click it, select `Edit Channel`, and turn on `Age-Restricted Channel`
   (requires Manage Channels permission).

If a command is restricted and the channel is not marked age-restricted, Discord will not
display or allow running the command.

:::tip
`/nsfw` is manager-only by default and also holds the NSFW persona routes. `/nsfw persona default`
lists the NSFW presets, and `/nsfw persona import` accepts a persona marked NSFW; the regular
`/persona` commands hide or reject those.
:::

## What's Gated

- **NSFW content settings**: `/nsfw jailbreaks` toggles workarounds for overly strict
  provider-side content filters. See
  [Behavior Tweaking](/features/chatting-personality/behavior-tweaking/#uncensored-output).

Age-restricted content is for adult users only, so use responsibly and follow Discord's
[Community Guidelines](https://discord.com/guidelines). In `/help`, choose `Behavior`, then `Age-Restricted Commands`, for the same
walkthrough in Discord.
