---
title: "Inside The Prompt"
sidebar:
  order: 2
aiGenerated: false
---

TomoriBot normally assembles the following blocks as the prompt for your configured text model,
in this order. [NovelAI special handling](#novelai-special-handling) below explains its exceptions.

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

Recent messages form a moving window as people talk. Other blocks are rebuilt from saved settings
and available memories for each request.

:::tip
Some models use information near the beginning or end of a long prompt more reliably than information
in the middle. For providers that use context notes, try placing an instruction near the latest message.
The effect depends on the model and task. See [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/)
and [Lost in the Haystack](https://arxiv.org/abs/2505.18148).
:::

### Inspecting the prompt

- `/tool prompt snapshot` saves the assembled prompt to a file, including active memories and documents.
- `/context` shows a visual breakdown of context usage and estimated input cost.
- `/tool estimate cost` breaks down the prompt by size and cost.

### Where are Tools defined?

For providers with tool calling, TomoriBot sends tool definitions through the provider's supported
interface. NovelAI text models receive no tool definitions.

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

### NovelAI special handling

NovelAI uses a different text template for each model, with size limits tied to the model and
subscription. TomoriBot sends a smaller selection of the blocks above. The `General Behavior` panel
shows a notice while the server or DM's text model is NovelAI:

| Content or setting | NovelAI handling | Why |
|---|---|---|
| Persona attributes, sample dialogue, and conversation | Kept, with the current turn, one available sample exchange, and two available recent history exchanges protected. | Preserves the persona's voice and the current exchange. |
| Server, visible personal, and short-term memories | Memory text gets up to 20% of the context window. Dated entries are trimmed oldest-first; more memories may be removed before older conversation. | Leaves room for dialogue and replies; age gives a predictable trimming order. |
| Server, persona, and channel prompts; context notes; humanizer rules; conditioning | Omitted. Xialong uses NovelAI's own system prompt; GLM, Kayra, and Erato have no system block. | Each model uses its own template. |
| Story metadata and stars | Xialong puts story metadata first in its persistent information and defaults to 4 stars. Erato uses configured stars; Kayra omits stars. | Matches each model's metadata format. |
| Text polishing | Polishes history, memories, and sample dialogue before counting and fitting, independently of the humanizer setting. See [the rules below](#text-polishing-and-discord-delivery). | Gives each NovelAI model consistent model-facing formatting. |
| Imported SillyTavern presets | Imported instructions and ordering are bypassed; TomoriBot uses the persona's native content. | Each model has its own prompt template. |
| NovelAI sampling presets | Model switches load the matching default preset for server and personal settings. Later sampler edits remain active. Fallback attempts use compatible model settings. | Prevents samplers from another model carrying into the request. |
| Memory update reminders | Omitted, including reminders assembled before a personal model override or fallback. Actual short-term memory contents remain available. | NovelAI text models cannot call memory tools. |
| Response prefills | Kept when allowed by the prefill controls. | Continues the saved opening text. |
| Speaker boundaries | Automatically stops known users and other personas from starting another turn. The responding persona's names, aliases, and sprite labels remain allowed. | Keeps each response assigned to its intended speaker. |
| History annotations | Omits reply references, reaction metadata, and administrative notices. Gestures become action text; scene descriptions, summaries, forwarded text, and available transcripts keep their prose. | Avoids teaching the model to repeat system annotations and reference IDs. |
| Extra reference blocks | Omits statuses, time/channel/server information, documents, and emoji/sticker/sprite inventories. Memories use resolved contents without added speaker labels, database IDs, or tag prefixes. | Keeps space for conversation and remembered facts. |
| Tools and media input | No text-model tool calls or image/video input. Separate image-generation commands remain available. | The NovelAI text integration supports text generation only. |
| Counting and limits | Counts the final prompt locally and reserves reply space within the serving key's model/subscription limit. Configured output length takes priority over sampling-preset length and may be reduced to fit. | Prompt formatting costs tokens too, and subscription limits differ. |

Privacy and memory-tag filters apply before memory trimming. All eligible memories can appear when
both the memory allowance and the full prompt have room. Omitted memories stay saved, and saved
prompt settings take effect again with providers that use them. If the prompt is still too large,
extra sample exchanges leave first, then memories, then the oldest unprotected history exchanges.
If the protected content cannot fit, generation stops with an error instead of sending an oversized
prompt. `/tool prompt snapshot` shows the fitted NovelAI prompt, included, excluded, and trimmed
content, input token count, context allowance, and reply cap.

#### Text polishing and Discord delivery

All four NovelAI text models receive polished history, memories, and sample dialogue. This happens
before token counting, regardless of the humanizer degree. Stored messages, memories, and sample dialogues
keep their original text. Other providers use their existing prompt paths.

| Input | What gets polished |
|---|---|
| Recent history | Both user and persona turns, including the current message. Speaker labels and known persona names use their configured casing. |
| Memories | Resolved memory contents, without added owner labels, database IDs, or tag prefixes. |
| Sample dialogue | Both sides receive the same casing and punctuation rules as history. Lowercase samples therefore reach NovelAI with normalized sentence starts. |

The formatter capitalizes leading Latin letters at the start of text, lines, and sentences after
`.`, `!`, or `?` followed by spaces. It restores known persona names, such as `hi juno` becoming
`Hi Juno.`, and adds a final full stop to each prose line when needed. Existing line breaks and blank
lines stay in place, so `Hmph\nSo demanding` becomes `Hmph.\nSo demanding.`. Lists, headings, blockquotes,
tables, and separator lines keep their structure. Code, URLs, mention handles, and Discord markup
keep their contents. Emoji, kaomoji, code, and link endings do not gain a full stop. Lines beginning
with a code fence, URL, mention, emoji, or non-Latin letter skips the sentence-formatting pass.
Formatting stays in place while sentence starts inside emphasis, bold, underline, strikeout, and
spoilers receive the same polishing: `*kisses juno*` becomes `*Kisses Juno.*`. Inline emphasis within
a sentence keeps its casing except for known persona names. Explicit response prefills and
continuation fragments stay exact.

Replying to a message keeps your reply's words without its generated reference annotation.
`/reward` and `/punish` gestures appear as actions without system labels or tool instructions.
Scene descriptions and summaries keep their text without the system wrapper. Literal quotations
you type, including text containing `System:`, stay intact.

Discord replies still follow the humanizer setting, including its casing, punctuation, and message
splitting. Later history is read from those Discord messages and polished again. TomoriBot does not
retain an original unhumanized transcript, so this cannot recover removed commas or other lost
punctuation. It does not rewrite grammar or guarantee grammatically correct generated replies.

Speaker detection uses known conversation participants and applies even when the shared
speaker-stop setting is off. It handles labels split across stream chunks and stops standalone
`---` or `***` separator lines before delivery. The local detector preserves code and headings;
API stops match literal text, so an exact speaker or separator stop inside generated code can
still stop the provider.
