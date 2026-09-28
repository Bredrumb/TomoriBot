---
title: "PluralKit Support"
# Keyword-rich <title> targeting "PluralKit Discord bot support" queries;
# replaces Starlight's default for this page only. H1 and sidebar keep the
# plain title.
head:
  - tag: title
    content: "TomoriBot | PluralKit Support for Plural Systems in Discord"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "TomoriBot works with PluralKit proxied messages. Each system member is treated as their own person with their own personal memories, while settings stay on the host account."
sidebar:
  order: 3
---

TomoriBot understands [PluralKit](https://pluralkit.me/) proxied messages. With support
enabled, she replies to the proxied webhook message instead of the original that PluralKit
deletes, and she treats each system member as a person with their own name,
identity, and personal memories instead of grouping everyone under the shared
Discord account. This page is the user's side of the feature. For the internals, see the
[PluralKit adapter architecture](/architecture/integrations/pluralkit/). The shared safety model is
covered in [Message-Proxy Support](/features/integrations/message-proxy-support/).

## Enabling It

Run `/personal message-proxy service:pluralkit`. It's a personal, per-account selection, so there is
nothing for server staff to configure and it follows you across servers. Members of your system
don't opt in individually; the selection lives on the Discord account that sends the messages.
Use `/personal message-proxy service:none` to disable it.

If you don't use PluralKit, leave this off. Every message you send would pay a small delay
for no benefit (see below).

## What Changes When It's On

- **She answers the right message.** Without this, PluralKit deletes your original message
  mid-generation and Tomori ends up replying to a ghost. With it, she waits briefly, notices
  the proxy, and responds to the webhook repost, including proxied *replies* to her
  messages, which normally lose their reply linkage in the proxy process.
- **Follow-ups work mid-reply.** Sending another proxied message while Tomori is still
  answering the same member interrupts her, and she answers that member's newest message.
  A different member on the same account waits their turn, as does a member on another account.
- **A short pause on your messages.** Tomori waits about **2 seconds** (self-hosters can
  tune `MESSAGE_PROXY_WAIT_MS`) to see whether PluralKit deletes and reposts your message.
  Proxied messages usually resolve faster than that; unproxied messages simply arrive that
  little bit late. This is the tradeoff you accept by opting in, and the command's
  confirmation reply spells it out.
- **Each member is their own person.** Tomori knows the member's name, which system they
  belong to, and which Discord account hosts them as three separate facts. Fronting as a
  different member means talking to her as that member, not as "the account".
- **Personal memories are per-member.** A fact Tomori learns about one member is stored for
  *that member*. It doesn't become a server-wide memory, doesn't attach to the host
  account, and doesn't bleed to system-mates.
- **Meeting and reunion are per-member too.** She keeps track of when she last heard from
  each member individually, so a member she hasn't spoken with in a while gets greeted as
  they come back even if someone else has been posting from the same account all week. A
  member she has never met is a first meeting, and a member who has been around today is
  just part of the conversation.
- **A one-time bio import.** The first time Tomori ever sees a member, that member's public
  PluralKit description (if any) may be saved as a starting personal memory so she can
  respect pronouns, boundaries, and preferences from the first conversation. This is a
  one-time snapshot. Editing the bio on PluralKit later never updates it. To change
  what she remembers, just tell her in chat ("forget that", "actually, ...").
- **A one-time pronoun import.** If a member's pronouns are public on PluralKit, they fill in
  that member's own pronouns setting the first time she sees them speak, so she uses them from
  the first reply. From then on that setting is yours between you and her, so a later change on
  PluralKit does not overwrite it, and `/personal config identity:` is where you correct it. A
  member who keeps pronouns private, or has none set, simply starts with the field empty.
- **Your system's description, read while your members talk.** If your system has a public
  description, Tomori keeps it and reads it whenever any of your members are in the
  conversation, so system-wide boundaries apply to all of you without repeating them per
  member. This one *does* follow edits: change or clear it on PluralKit and she picks that
  up the next time one of your members speaks. It's shown once for the whole system, not
  attached to any individual member, and a private or empty description is simply left out
  rather than replaced with a placeholder.

## Identity Details Worth Knowing

- Members are recognized by PluralKit's **stable internal IDs**, never by name. Renaming a
  member or changing their display name is fine: Tomori still knows they're the same
  person, and picks up the new name cosmetically.
- Identity comes from the message itself, not from who is "currently fronting": Tomori
  never polls your fronters. A member becomes part of the conversation the moment they send
  a proxied message, and Tomori has no way to know a member exists until it has proxied at
  least once while you were opted in.
- **Naming a member brings them into context**, exactly as naming a human participant does:
  if someone asks "what did Mirri think?", Tomori loads Mirri's memories even though
  Mirri hasn't spoken recently. This is scoped to members of systems whose host account is
  in the server, and an ambiguous name (two people or members answering to it) is ignored
  rather than guessed at.
- Naming the **system** does not pool its members' memories. Only members actually present
  or named are loaded, so a fronting member's conversation never exposes facts about
  members who aren't part of it.
- Private system data stays private. Tomori only ever sees what PluralKit exposes publicly
  about a message's member and system; she has no access to member ACL-protected fields. If
  your system name is hidden, she falls back to your system tag, or just "a plural system".

## Settings Stay on the Host Account

Your Discord account remains the thing that *gates* everything: privacy level, blacklists,
cooldowns, quotas, API keys, and account-level `/personal` settings are shared across your members
and keyed on the host account. Setting your privacy to full, or being blacklisted on a
server, shields all of your members at once. Conversational identity, profile preferences,
appearance, and memories can be set per member.

## Current Limitations

- `/personal memories identity:` edits a stored member's global and persona memories. Use
  `/personal config identity:` to edit that member's profile, nickname, and appearance.
- The bio import happens exactly once per member, ever. Later PluralKit bio edits never
  propagate. Tell her in chat instead.
- Members can't be `@`-mentioned by Tomori (webhooks aren't mentionable); she addresses
  members by name.
- If the PluralKit API is slow or down, Tomori falls back to treating the message as a
  plain webhook for that moment. She never invents an identity she couldn't verify.

If a limitation isn't listed above, assume it should work and report bugs in the support
server (`/support discord`).
