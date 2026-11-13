---
title: "Server Moderation"
sidebar:
  order: 2
---

TomoriBot provides server managers with fine-grained control over usage, costs, permissions,
and channels through `/moderation` and `/config`. Most of these controls require the
`Manage Server` permission. For a complete list of commands, see the
[Command Reference](/features/command-reference/).

## Cost Control: Quotas
<!-- anchor: cost-control-quotas -->

Generation costs money, whether paid from your provider account or by your members. Quotas cap
usage per user and server-wide:

- **Configure limits**: in `/moderation` > Quotas, configure daily per-user limits and
  server-wide reset pools for text, image, and video generation. Set a per-user limit to `0`
  for unlimited.
- **Manual resets**: run `/quota reset user` to clear a member's daily usage, or
  `/quota reset global` to reset the entire server's pool.

Server-wide pools reset automatically on a configurable interval in days.

## User BYOK (Bring Your Own Key)
<!-- anchor: user-byok-bring-your-own-key -->

In `/moderation` > Member Access, you can control whether members may use server-funded AI:

- **Server Models Allowed** (default): members use server-configured providers.
- **Personal Providers Required**: members must configure their own API keys via
  `/personal providers`. The server pays nothing for member-initiated messages.
  Server-initiated actions (such as automated greetings or scheduled tasks) still use the server
  provider.

Members configure their personal providers under
[Personalization](/features/knowledge/personalization/#your-own-providers).

You can also bootstrap a server without a server-side text provider by choosing `User BYOK`
during `/setup`.

## Access Control: Whitelists

Use `/moderation` > Whitelist to restrict where and how TomoriBot responds:

- **Channels**: choose which channels allow bot responses and set channel-specific cooldown
  overrides. Channels inherit the global cooldown unless an override is set.
- **Personas**: restrict which channels a specific persona can trigger in.
- **Roles**: restrict bot interactions to members with specific Discord roles.

Configure the server-wide global response cooldown under `/config` > Behavior >
Trigger Behavior.

## Learning & Privacy Controls

- **Member permissions**: in `/moderation` > Member Access, click `Edit Permissions` to control
  whether members without `Manage Server` can manage server memories, persona attributes,
  sample dialogues, or inspect prompt snapshots. Server memory teaching is disabled by default and
  lets members view their own memories, add new ones, and edit or remove their own. When disabled,
  only members with `Manage Server` can view or manage server memories. Viewing and managing documents and
  lorebooks requires `Manage Server`.
- **User Blacklist**: in `/moderation` > User Blacklist, choose members for TomoriBot to ignore
  completely. Blacklisted members cannot trigger her or run commands, and their messages never
  reach prompt context. You can also set persona-specific member blocks.
- **Channel Rules**: in `/config` > `Channels` > `Channel Rules`, mark public text channels private
  or add cross-channel tool blocklists. Restricted Discord channels are private automatically.
  Private channels have no thought logs or incoming cross-channel tools, including peeks, thread
  creation, and scheduled tasks from other channels. STM cannot enter or leave unless
  `Private-Channel STM Sharing` is `Allowed`. You can still ask the bot to work within a private
  channel or dispatch work outward; an outward task can include information from your conversation.

Automatic privacy checks role permissions: `@everyone` must be able to view the channel,
and no role may have an explicit `View Channel` deny. Individual member overwrites do not affect
this classification. Servers with verification roles or view-denying restriction roles can therefore
have channels marked private even when ordinary
members can read them. The panel distinguishes automatic privacy from manual selections. Removing
a manual selection cannot override Discord restrictions.

## Transparency: Thought Logs

In `/config` > Channels > Logs & Welcome, click `Set Log Channel` to designate a channel where
TomoriBot posts her internal reasoning, fallback notices, and successful tool calls. This is
useful for auditing what she is doing, including which trigger exposed a tool in
[Deliberate Tool Mode](/features/capabilities/tools-and-extensions/deliberate-tool-mode/).

The log uses the same role-based privacy check as STM. Activity in private channels and their
threads stays out of the log. The log channel must be in the same server.

:::tip
The log channel can be restricted to your moderation team while receiving activity from channels
open to every role.
:::

## Welcome Greetings

In `/config` > Channels > Logs & Welcome, configure automated greetings for new members in a
chosen channel. TomoriBot waits until the new member completes Discord's rules screening and
onboarding before sending the greeting. If a member leaves before finishing screening, no greeting
is sent. Click `Clear Welcome` on that same page to disable greetings.

The welcome prompt receives the member's roles after onboarding, so you can ask TomoriBot to greet
them in the language named by a role. Partial and Full privacy hide those roles from TomoriBot.

:::tip
Use the `Welcome prompt` to introduce new members to your server's rules. Include the rules or
point to your rules channel, for example: "Welcome them and remind them to read #rules."
:::
