---
title: "Chatting & Triggers"
sidebar:
  order: 1
---

TomoriBot only responds when something tells her to. This page covers the ways she can be
triggered, how to chat hands-free with auto-trigger, and how to stop accidental triggers
with Deliberate Trigger Mode.

## How to Trigger Her

By default, she replies when you:

- **Mention her** — `@TomoriBot`
- **Reply** to one of her messages (including a persona's webhook message)
- **Use a trigger word** — any plain word you've registered, said anywhere in a message
- **Use `/bot respond`** — manually prompt a reply

Trigger words are the most convenient path: once a word is registered, simply naming it
activates her. In a DM, just say hi — no trigger needed.

### Managing Trigger Words

- `/server trigger add` — add a custom trigger word (also works for alter personas, so a
  word can summon a specific character).
- `/server trigger remove` — remove a trigger word.

## Auto-Trigger (Hands-Free Chatting)

Auto-trigger lets her join the conversation without being named at all.

- `/server autotrigger channels` — set the channels where she responds without a mention.
- `/server autotrigger threshold` — set how many messages accumulate before she chimes in.

Use this in a dedicated chat channel where you want her to feel like a participant rather
than a summoned assistant.

## Deliberate Trigger Mode

If people say a persona's name a lot in ordinary conversation, plain trigger words can fire
her by accident. **Deliberate Trigger Mode (DTM)** fixes this by making plain trigger words
stop counting as an explicit trigger.

When DTM is on:

- `@{trigger}` (the trigger word prefixed like a mention) still works
- Discord mentions still work
- Replies still work
- `/bot respond` still works
- **Plain trigger words no longer trigger her**

This forces deliberate invocation instead of accidental activation.

### Server and Personal Control

- `/server dtm` — server admins toggle the server-wide behavior.
- `/personal dtm` — each user overrides it for themselves, with three modes:
  - **off** — always allow plain trigger words
  - **follow** — use the server setting
  - **on** — always require deliberate invocation

Run `/help deliberate-trigger-mode` for the same summary in Discord.

:::note
Don't confuse **Deliberate Trigger Mode** (this page — controls *how she's triggered*) with
**Deliberate Tool Mode**, which controls *which tools are exposed to the model* on a given
turn. They share the "DTM" abbreviation but are unrelated. See
[Tools & Extensions](/features/tools-and-extensions/#deliberate-tool-mode).
:::
