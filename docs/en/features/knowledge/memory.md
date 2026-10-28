---
title: "Memory"
sidebar:
  order: 1
aiGenerated: false
---

TomoriBot remembers conversations in several ways. For personality and behavior, see
[Multiple Personas](/features/chatting-personality/multiple-personas/).

## Types of memory

| Type | What TomoriBot remembers | How long it lasts |
|---|---|---|
| Long-term memory | Saved facts, documents, and conditioning | Until removed; survives `/refresh` and restarts |
| Short-term memory (STM) | A channel summary and recent messages | 24 hours by default |
| Chat history | Recent messages in the current channel | Until they fall outside the configured history range or `/refresh` clears it |

For what TomoriBot receives on each turn, see
[Inside The Prompt](/features/knowledge/inside-the-prompt/).

## Long-term memory
<!-- anchor: long-term-memory -->

### Personal and server memories
<!-- anchor: personal-vs-server-memories -->

Personal memories are facts about you. They follow you across servers and are used when you take part
in a conversation. Server memories contain information for everyone in that server.

Each persona has its own personal and server memories. A personal memory added on the Global page of
`/personal memories` applies to every persona. Manage personal memories with `/personal memories` and
server memories with `/memories`.

### Saving memories

You can save memories yourself, or TomoriBot can decide to save them during a conversation. When she
saves one, she posts an embed confirming what she learned. Without that confirmation, the information
remains in the conversation history rather than long-term memory.

If you want her to save something, ask her to remember it or add it yourself. Server managers can
disable automatic saving under `/config` > `Permissions`.

### Memory limits
<!-- anchor: how-many-memories -->

Each persona can hold 100 personal memories and 100 server memories by default. Global personal
memories count toward each persona's personal limit. Self-hosters can change the limits with
`MAX_PERSONAL_MEMORIES`, `MAX_SERVER_MEMORIES`, and `MAX_MEMORY_LENGTH`.

:::tip
Prefer more short memories over fewer long ones. A memory that uses a raised `MAX_MEMORY_LENGTH` is
sent in full every time it is active, while extra slots in `MAX_PERSONAL_MEMORIES` and
`MAX_SERVER_MEMORIES` cost nothing until filled.
:::

### Document knowledge base
<!-- anchor: document-knowledge-base-rag -->

Documents give TomoriBot a searchable knowledge base. She retrieves relevant passages when answering.
This requires an embedding model; see
[Providers & Models](/features/setup-administration/providers-and-models/).

Use `/memories` to manage documents and `/learn history` to turn channel conversations into searchable
knowledge. Documents can belong to one persona or be shared across personas, and can be limited to
selected channels. On new servers, document management is restricted to members with `Manage Server`
by default; managers can grant access through `/moderation` > `Member Access`.

History imports offer prompts for conversation, roleplay, and a persona's point of view. You can review
and adjust the prompt before importing.

### Conditioning
<!-- anchor: conditioning -->

Conditioning guides a persona's behavior in a server. Rewards and punishments given to a persona with
a reason become conditioning that she can act on. Interactions without a reason are counted but do not
appear in her prompt. Review or clear conditioning with `/conditioning`.

Playful interactions can also let personas reward or punish users and other personas. Interactions
with users do not save conditioning; interactions with personas can prompt them to respond. Server
managers can disable the tool under `/config` > `Plugins` > `Available Tools`.

## Controlling when memories activate

By default, memories are included whenever their owner and scope match the conversation. Keyword tags
and channel restrictions can narrow when they appear. Enable tagging under `/config` > `Engine` >
`Memory & STM`.

### Keyword tags
<!-- anchor: keyword-tags -->

A tagged memory activates when a keyword appears in the visible conversation. Untagged memories are
always active within their scope. Use `/tool prompt snapshot` to see which memories are active.

### Channels

Server memories and documents can be limited to selected channels and their threads. Personal memories
use a `#channel` tag. Channel restrictions and keyword tags can be combined.

Older server memory and document `#channel` tags were converted to channel selections. If a tagged
channel no longer exists, the item remains active in every channel; `/memories` identifies these items
so you can choose new channels.

## Short-term memory
<!-- anchor: short-term-memory-stm -->

Short-term memory helps TomoriBot recall recent conversations, including conversations in other
channels. Each persona keeps a separate summary for each channel she participates in. She updates it
when she replies, and it expires after 24 hours by default.

Server channel memories are shared within that channel. Private-channel memories stay private by
default. Conversations do not follow you between servers unless you enable cross-server recall in
`/personal config`; only your own conversations follow you. If you opt out of memory there, your
messages are excluded from short-term memory.

You can view or correct the current channel's summary under `/config` > `Persona` > `Memories`.
Server managers can adjust or disable short-term memory under `/config` > `Engine` > `Memory & STM`.
`/refresh` clears the current channel's memory.

## Message-proxy identities

Supported message-proxy services let TomoriBot keep separate personal memories for verified proxied
identities. The host Discord account controls privacy and authorization. See
[Message-Proxy Support](/features/integrations/message-proxy-support/) for setup and limitations.

## Privacy

For what TomoriBot stores and how to export or delete it, see
[Data Handling](/features/knowledge/data-handling/) and `/legal privacy-policy`. You can opt out of
memory with `/personal config`.
