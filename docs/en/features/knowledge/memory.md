---
title: "Memory"
sidebar:
  order: 1
---

TomoriBot has a persistent memory system so she remembers facts across conversations. This
page is about *what she knows* (facts, context, documents). For *how she behaves*
(personality, tone), see [Multiple Personas](/features/chatting-personality/multiple-personas/).

## Personal vs. Server Memories

There are two kinds of long-term memory:

- **Personal memories** (`/memory personal add`) — facts about an individual user, e.g.
  "Amaori loves cats", "prefers dark mode", "allergic to peanuts". These are tied to *you*
  and follow you **across every server** — but she only draws on them in conversations
  you're actively part of.
- **Server memories** (`/memory server add`) — information relevant to the whole server,
  e.g. "Game night is every Friday at 8 PM", "no NSFW posting", "#general is for
  announcements". These stay within the server and are always in mind there.

Remove them with `/memory personal remove` and `/memory server remove`. Memories persist
until you remove them.

:::tip
Keep memories concise and clear for best results. Review them anytime with
`/memory personal export`, `/memory server export`, or `/status`.
:::

## Tagging: Controlling When Memories Activate

By default, **every memory is sent with every prompt**. Tagging lets you control which
memories activate and where. Turn it on with `/memory tagging set`.

### Keyword Tags

- Memories **without** keyword tags are always active (the default).
- Memories **with** keyword tags only activate when the keyword appears in the visible
  context.
- Use `/tool prompt snapshot` to see which memories are currently activating.

### Channel Tags

- Memories with a `#channel` tag activate only in that channel.
- Channel tags combine with keyword tags.
- If you use the document knowledge base (RAG), channel tags also apply to documents and
  extracted histories.

Run `/help memory-tagging` for the same summary in Discord.

## Document Knowledge Base (RAG)

Server admins can give her documents to reference:

- `/memory document add` — upload a text, PDF, or Markdown file as server knowledge.
- `/memory history import` — extract channel history into searchable knowledge.
- Documents are chunked and stored as searchable embeddings; she automatically retrieves
  relevant content when answering.
- She can also read file attachments shared directly in chat (PDF, source code, Markdown,
  JSON, YAML, and more) — just ask her to read it.
- `/memory document view` — browse stored documents chunk by chunk. Server admins can
  edit individual chunks, update document channel tags, or delete a single chunk without
  removing the whole document.
- Remove any stored document with `/memory document remove`. `/memory history remove` is
  a filtered shortcut that only lists documents created by `/memory history import`.

`/memory document view` keeps its complete private session in one Components V2 message for
both persona and serverwide scopes. Persona selection, document selection, loading, chunk
navigation, edit/delete confirmation, progress, success, errors, and timeout all replace
that same message. Lists of up to 25 documents open directly; larger lists show in-place
range buttons instead of a second page-selector message. On timeout, the current chunk stays
readable with its controls disabled. **Close** deletes the private workflow message.

Document selection is acknowledged before metadata and chunks are loaded. Edit submissions
are acknowledged before embedding or persistence work. Content and channel-tag changes only
become visible after successful writes, and cache invalidation occurs after those writes.
Deleting the last chunk also removes the now-empty document and changes the same message to
a terminal result.

### History Import Prompts

When importing channel history, the `prompt` option changes how TomoriBot extracts
memories:

- **Conversation** extracts standalone facts from normal chat. It resolves pronouns and uses absolute timestamps when dates or times are mentioned or can be inferred.
- **Roleplay** looks for scenes, lore, relationships, and memorable events without trying to preserve every small beat.
- **In-Character** extracts memories from the selected persona's point of view, using that persona's prompt, attributes, existing memories, and relevant documents as context.

The prompt is shown before import so you can adjust it for the channel or scene.

History imports are stored as documents, so `/memory document view` and
`/memory document remove` work on them too.

**Requires an embedding model**, configured with `/model embedding`. See
[Providers & Models](/features/setup-administration/providers-and-models/).

Fact extraction needs a text model that can return structured JSON output. If the model
fails to produce it, the import stops and reports the provider's own error rather than
claiming no facts were found — switching to a model that supports JSON schema output
usually resolves it. A batch that genuinely contained nothing worth keeping still reports
"No Facts Extracted" as before.

## Short-Term Memory (STM)

TomoriBot can easily read messages from the current channel she's talking in, but STM allows her to do the following without saving an actual long-term memory:
1. Temporarily reinforce the current scenario/situation of the channel in context
2. Temporarily remember conversations from other channels/servers

**She only remembers conversations she took part in.** She updates a channel's memory when
she replies, and at no other time, so a busy channel where nobody talks to her leaves no
trace. 

STM of each channel expires after 24 hours by default and if you've opted out with `/personal privacy`, your messages never go into it at all as well.

### What she can and can't see

| Where | What that means |
|---|---|
| **In a server** | One shared memory per channel, not one per person. She isn't keeping notes on you individually. |
| **In DMs** | Yours alone. |
| **Other channels** | She can recall her recent conversations from a few other channels in the same server. |
| **Private channels** | Anything set with `/server private-channels` stays there and won't surface elsewhere. |
| **Other servers** | Never, unless you turn on `/personal stm` → `crossserver`. Even then only *your own* conversations follow you. |
| **Each persona** | Keeps her own separate memory, so switching persona switches memory. |

Each channel's memory holds the last few messages plus a short summary she writes herself
and refreshes as the conversation moves along. It fades on its own after a few quiet hours.

### Commands

| Command | What it does |
|---|---|
| `/persona stm view` | See the summary she's keeping for this channel |
| `/persona stm edit` | Correct it or write it yourself |
| `/personal stm` | Opt into cross-server recall, or wipe your own |
| `/tool refresh` | Make her forget this channel right now |
| `/server stm parameters` | How often she updates it, and how much detail she keeps |
| `/server stm categories-edit` | Swap the summary for up to 5 labeled fields (*Current scene*, *Mood*, …) |
| `/server stm prompt-edit` | Reword how she's asked to keep it |
| `/server stm manage` | Review or clear stored memories |
| `/server stm privacy-bypass` | Let private-channel memories surface elsewhere |
| `/capabilities manage` | Turn the feature on or off (stored memories are kept either way) |

Anyone can run `/persona stm view` and `/personal stm`. The rest need Manage Server.

:::tip
These STM commands are for advanced users only, it is recommended to keep the default settings, unless you want to allow her to remember you across servers with `/personal stm`
:::

## Conditioning

`/conditioning` is a per-persona, per-server memory that steers a persona's behavior over
time — a lighter-weight nudge than a full attribute or system prompt. Use it to reinforce
how a specific character should act in a specific server.

---

**Privacy:** For exactly what she stores and how to export or delete it, see
[Data Handling](/features/knowledge/data-handling/) and `/legal privacy`. You can opt out of memory
entirely with `/personal privacy`.
