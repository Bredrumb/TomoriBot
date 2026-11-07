---
title: "Long-Term Memory"
sidebar:
  order: 1
aiGenerated: false
---

Long-term memories are short facts TomoriBot keeps until someone removes them. They survive
`/refresh` and restarts. She also remembers through [Documents](/features/knowledge/memory/documents/),
[Lorebooks](/features/knowledge/memory/lorebooks/), and
[Short-Term Memory](/features/knowledge/memory/short-term-memory/); `/memories` has a tab for each.
For personality and behavior, see
[Multiple Personas](/features/chatting-personality/multiple-personas/).

## Personal and server memories
<!-- anchor: personal-vs-server-memories -->

Personal memories are facts about you. They follow you across servers and are used when you take part
in a conversation. Server memories contain information for everyone in that server.

Each persona has its own personal and server memories. A personal memory added on the Global page of
`/personal memories` applies to every persona. Manage personal memories with `/personal memories` and
server memories with `/memories`.

Supported message-proxy services let TomoriBot keep separate personal memories for verified proxied
identities. The host Discord account controls privacy and authorization. See
[Message-Proxy Support](/features/integrations/message-proxy-support/) for setup and limitations.

## Saving memories

You can save memories yourself, or TomoriBot can decide to save them during a conversation. When she
saves one, she posts an embed confirming what she learned. Without that confirmation, the information
remains in the conversation history rather than long-term memory.

If you want her to save something, ask her to remember it or add it yourself. Server managers can
disable automatic saving under `/config` > `Permissions`.

## Memory limits
<!-- anchor: how-many-memories -->

Each persona can hold 100 personal memories and 100 server memories by default. Global personal
memories count toward each persona's personal limit. Self-hosters can change the limits with
`MAX_PERSONAL_MEMORIES`, `MAX_SERVER_MEMORIES`, and `MAX_MEMORY_LENGTH`.

:::tip
Prefer more short memories over fewer long ones. A memory that uses a raised `MAX_MEMORY_LENGTH` is
sent in full every time it is active, while extra slots in `MAX_PERSONAL_MEMORIES` and
`MAX_SERVER_MEMORIES` cost nothing until filled. Long reference text belongs in a
[document](/features/knowledge/memory/documents/), which is searched instead of sent in full.
:::

### Memory decay

With an embedding model set up, a memory that goes 7 counted conversation days without matching
the conversation rests: it stays saved but leaves the usual prompt until a later message brings it
back. When the list is full, an automatic save can forget a resting memory, but never a Global
personal memory or one someone added or edited with `/memories` or `/personal memories`. See
[Memory Decay](/features/knowledge/memory/memory-decay/).

For instructions that should always apply, use
[persona attributes](/features/chatting-personality/multiple-personas/#attributes), the persona prompt,
or an [Always On lorebook entry](/features/knowledge/memory/lorebooks/).

## Controlling when memories activate
<!-- anchor: controlling-when-memories-activate -->

Active memories are included when their owner and scope match the conversation. Resting memories
return through search when relevant. Channel restrictions narrow where they apply, and personal
memories can also use keyword tags.

### Personal memory tags
<!-- anchor: keyword-tags -->

Personal memories can carry keyword or `#channel` tags. Turn tagging on under `/config` > `Behavior` >
`Advanced Memory`. When it is on, a tagged personal memory appears only when one of its keywords is in
the conversation, and an untagged one stays active. A `#channel` tag limits it to that channel. Use
`/tool prompt snapshot` to see which memories are active.

Server memories no longer use keyword tags. Their authored lore belongs in
[Lorebooks](/features/knowledge/memory/lorebooks/), where keywords and Always On are set per entry.

### Channels

Server memories and documents can be limited to selected channels and their threads. Personal memories
use a `#channel` tag. Lorebook entries also accept a channel selection.

Older server memory and document `#channel` tags were converted to channel selections. If a tagged
channel no longer exists, the item remains active in every channel; `/memories` identifies these items
so you can choose new channels.

## Conditioning
<!-- anchor: conditioning -->

Conditioning guides a persona's behavior in a server. Rewards and punishments given to a persona with
a reason become conditioning that she can act on. Interactions without a reason are counted but do not
appear in her prompt. Review or clear conditioning with `/conditioning`.

Playful interactions can also let personas reward or punish users and other personas. Interactions
with users do not save conditioning; interactions with personas can prompt them to respond. Server
managers can disable the tool under `/config` > `Plugins` > `Available Tools`.

## Privacy

For what TomoriBot stores and how to export or delete it, see
[Data Handling](/features/knowledge/data-handling/) and `/legal privacy-policy`. You can opt out of
memory with `/personal config`.
