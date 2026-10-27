---
title: "Chatting & Triggers"
sidebar:
  order: 1
---

TomoriBot responds when summoned. This page covers how to trigger her in a server or DM, how to enable hands-free chatting with auto-trigger, and how to prevent accidental activations with Deliberate Trigger Mode.

## How to Trigger Her
<!-- anchor: how-to-trigger-her -->

By default, she replies when you:

- **Mention her**: `@TomoriBot`
- **Reply** to one of her messages (including a persona's webhook message)
- **Use a trigger word**: any registered trigger word anywhere in a message
- **Use `/respond`**: manually request a response

In a DM, send a message directly without any trigger word or mention.

To make the main persona reply to every eligible message in the server without needing a mention or trigger word, enable `Always Reply` in `/config` > `Behavior` > `Trigger Behavior`.

### Managing Trigger Words
<!-- anchor: managing-trigger-words -->

Server managers use `/config` > `Persona` > `Triggers` to add or remove trigger words for a persona. Members without `Manage Server` can view existing triggers in read-only mode.

:::tip
Trigger words ignore case and allow repeated letters, so `Mirri` also catches `Mirrriii`. Short or
common words can fire by accident; choose distinctive triggers, or use Deliberate Trigger Mode when
a name comes up in normal chat.
:::

## Hands-Free Chatting

You can let TomoriBot join or start conversations without being directly mentioned:

- **Auto-Trigger Channels**: in `/config` > `Channels` > `Auto-Trigger`, choose which channels trigger automatic responses, assign a persona per channel, and set the activity threshold (how many messages must pass before she replies, or a random range).
- **Random Timer Triggers**: in `/config` > `Behavior` > `Trigger Behavior`, configure timer-based schedules that can start a response after channel inactivity.
- **Natural Nudges**: for personas that start or join conversations on their own based on server activity, see [Natural Nudges](/features/chatting-personality/natural-nudges/).

## Deliberate Trigger Mode
<!-- anchor: deliberate-trigger-mode -->

If a persona's name comes up often in normal conversation, plain trigger words can activate her by accident. Deliberate Trigger Mode prevents accidental activation by ignoring plain trigger words unless prefixed with `@`:

- `@{trigger}` (the trigger word prefixed with `@`), `@TomoriBot` mentions, message replies, and `/respond` still trigger a reply.
- Plain trigger words without `@` are ignored.

Server managers toggle the server default in `/config` > `Behavior` > `Trigger Behavior`, and individual members can override it for their own messages in `/personal config` (`off`, `follow`, or `on`).
