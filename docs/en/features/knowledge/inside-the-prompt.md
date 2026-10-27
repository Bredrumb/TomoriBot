---
title: "Inside The Prompt"
sidebar:
  order: 2
aiGenerated: false
---

Every time you trigger TomoriBot, the following is assembled and sent to your configured text
model as the main prompt/context, in this order top-to-bottom:

| Block | Optional? | Commands | What it is |
|---|---|---|---|
| [System prompt](/features/chatting-personality/behavior-tweaking/#system-prompt) | | `/config` > Engine > General | Basic instructions at the topmost of context. |
| Channel prompt (append) | *(Optional)* | `/config` > Channels > Channel Overrides | Varies per-channel, layered in right after the system prompt. The same page's *replace* mode takes over the system prompt slot above instead of adding a new one. |
| Persona prompt | *(Optional)* | `/config` > Persona > Advanced | A prompt written specifically for the active persona, separate from the system prompt.|
| [Persona attributes](/features/chatting-personality/multiple-personas/#attributes) | | `/config` > Persona > Identity & Personality | The active persona's personality traits and speech patterns. |
| Server info | | *(none, from Discord)* | The server name, description, and the channel she's in, pulled from Discord itself. |
| [Persona-user blocks](/features/capabilities/tools-and-extensions/built-in-tools/) | *(Optional)* | `/moderation` to review/clear; gated by `/config` > Permissions (User Blocking) | Active mute/block restrictions this persona holds against specific users. |
| [Server memories](/features/knowledge/memory/#personal-vs-server-memories) | | `/memories` | The long-term facts saved for this server. |
| [Server emojis](/features/chatting-personality/behavior-tweaking/#capabilities-what-shes-allowed-to-do) | *(Optional)* | `/config` > Plugins > Context Additions (`Emojis & Reactions`) (toggle only), initialize with `/expressions initialize` | The custom emojis present in the server.|
| [Server stickers](/features/chatting-personality/behavior-tweaking/#expressions) | *(Optional)* | `/config` > Plugins > Available Tools (Sticker Usage), classify native assets with `/expressions initialize`, manage with `/expressions manage` | Sendable native stickers and every custom expression eligible for the responding persona, with names, descriptions, and emotions. Media sources and persona access rules stay outside the prompt. |
| [Persona sprites](/features/chatting-personality/multiple-personas/#sprites-emotion-avatars) | *(Optional)* | `/config` > Persona > Sprites | Named expression sprites configured for the persona, if it has any. |
| [Conversation Participants](/features/knowledge/memory/#personal-vs-server-memories) | *(Optional)* | `/personal memories` (gated by `/config` > Permissions (Personalization)) | The people in the conversation, their nicknames and mention handles, and the personal memories saved about each of them. Loaded when the person owns a message in context, or if their name/alias get mentioned. Also carries the current channel and local time as a footer, using `/config` > Engine > General. |
| [Short-term memory](/features/knowledge/memory/#short-term-memory-stm) | | `/config` > Persona > Memories; `/memories` to clear entries; gated by `/config` > Permissions (Short-Term Memory) | Contains summaries and recent messages of different channels |
| [Documents](/features/knowledge/memory/#document-knowledge-base-rag) | *(Optional)* | `/memories` | Relevant chunks pulled from the knowledge base using RAG. |
| [Conditioning](/features/knowledge/memory/#conditioning) | *(Optional)* | `/reward <feed\|headpat\|hug\|kiss\|tickle>`, `/punish <bite\|bonk\|pinch\|spank\|squeeze>`, managed via `/conditioning remove` | Accumulated behavioral nudges for this persona in this server. |
| [Sample dialogues](/features/chatting-personality/multiple-personas/#sample-dialogues) | *(Optional)* | `/config` > Persona > Identity & Personality | Examples of how this persona talks, if any are configured. |
| [Recent messages](/features/chatting-personality/behavior-tweaking/#generation-tuning) | | `/config` > Engine > General | The actual conversation, up to this many messages (default 80). |
| Context note | *(Optional)* | `/config` > Engine > General; Persona > Advanced; or Channels > Channel Overrides | An instruction inserted among recent messages at a chosen depth from the latest message. |

Rows marked *(Optional)* contribute nothing (and cost no tokens) when there's nothing to say, e.g. no documents matched, or the server has no custom emojis.

Recent messages are the largest and most fragile part, it is a window that slides forward as people talk. Everything above them is rebuilt from saved settings and is stable.

:::tip
Some models use information near the beginning or end of a long prompt more reliably than information
in the middle. For an instruction you want to reinforce, try a context note near the latest message.
The effect depends on the model and task. See [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/)
and [Lost in the Haystack](https://arxiv.org/abs/2505.18148).
:::

### Inspecting the prompt

- `/tool prompt snapshot` saves the assembled prompt to a file, including active memories and documents.
- `/context` shows a visual breakdown of context usage and estimated input cost.
- `/tool estimate cost` breaks down the prompt by size and cost.

### Where are Tools defined?

For every
provider TomoriBot supports natively, tool schemas are sent through the provider's own `tools`
field, so it depends upon the provider/configured inference engine.

### Why does TomoriBot forget?

This ordering explains almost every "why doesn't she remember?" question:

| What happened | Why |
|---|---|
| She forgot something from earlier today | It scrolled past the message limit. It was only ever in Recent messages, if Tomori does not save it as a long-term memory, then it will be forgotten once it reaches outside the message window. |
| She forgot something in another channel | Recent messages is per-channel. Only Server memories, Conversation Participants, and Short-term memory cross channels. Short-term memory remedies this by loading in recent messages from different channels, but it does not dump everything. |
| `/refresh` made her forget | Refresh cuts off Recent messages and clears this channel's Short-term memory, but shouldn't remove long-term memory. Delete the refresh embed to remove the cut-off. |

If you want something to survive all of the above, it has to become a long-term memory. See [Memory](/features/knowledge/memory/#long-term-memory).

:::tip
A larger message limit does not guarantee that more history reaches the model. When the prompt is
too large for the model's context window, the oldest exchanges are dropped before sending;
`/context` shows how much room is left.
:::
