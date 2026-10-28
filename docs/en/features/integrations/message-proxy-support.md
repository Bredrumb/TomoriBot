---
title: "Message-Proxy Support"
head:
  - tag: title
    content: "TomoriBot | PluralKit & PluralBuddy Support for Plural Systems in Discord"
description: "Use PluralKit or PluralBuddy proxied messages with TomoriBot, giving each alter or system member their own identity and personal memories."
sidebar:
  order: 3
---

TomoriBot works with [PluralKit](https://pluralkit.me/) and [PluralBuddy](https://pluralbuddy.app/) proxied messages. When enabled, she replies directly to your proxied webhook messages and treats each system member or alter as their own person with their own name, profile, and personal memories.

## How to enable it

Run `/personal message-proxy` and choose your service:

- `/personal message-proxy service:pluralkit`
- `/personal message-proxy service:pluralbuddy`
- `/personal message-proxy service:none` to turn it off

Run this on the Discord account that sends your messages; it follows your account across servers, so system members do not need to opt in one by one. If you do not use a proxy bot, leave it set to `none` so your regular messages are not delayed.

:::tip
Setting the service to `none` does not delete the alters TomoriBot has already stored. Their profiles and memories stay available through `/personal config identity:` and `/personal memories identity:`, so you can turn the service back on later without losing them.
:::

Once TomoriBot has replied to an alter at least once, you can customize their profile and memories using the `identity` option:

- `/personal config identity:` to set that alter's nickname, pronouns, or appearance
- `/personal memories identity:` to view or edit that alter's personal memories

Account-wide settings such as privacy levels, API keys, quotas, and cooldowns stay on your main Discord account and apply to all of your alters at once.

## PluralKit vs. PluralBuddy

### PluralKit
<!-- anchor: pluralkit -->

Works out of the box. The first time TomoriBot meets a member, she automatically imports their public PluralKit bio as a starting memory and their public pronouns into their profile. Public system descriptions are also included in context.

:::tip
TomoriBot does not re-read a member's PluralKit bio after it first verifies that member. If the member edits their bio later, update the saved memory with `/personal memories identity:`.
:::

### PluralBuddy
<!-- anchor: pluralbuddy -->

Your alter must use PluralBuddy's `webhook` or `both` proxy mode (nickname-only mode is not detected). Self-hosters need to complete [PluralBuddy OAuth Setup](/self-hosting/pluralbuddy-oauth/) once before users can select PluralBuddy.

*(Tupperbox is not supported because it does not provide a verification API for TomoriBot to confirm who sent a webhook message. For technical details on verification and message correlation, see the [message-proxy architecture](/architecture/integrations/message-proxy/) and [PluralKit adapter architecture](/architecture/integrations/pluralkit/).)*
