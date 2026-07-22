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
- Use `/tool prompt-snapshot` to see which memories are currently activating.

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

## Short-Term Memory (STM)

Beyond persistent memories, she keeps a short-term memory of recent conversations for
channel and server awareness:

- Recent messages are cached per channel, and each persona carries the latest STM across
  channels within the same server.
- She can automatically summarize older conversation to keep context efficient.
- **Cross-server sharing is opt-in**: use `/personal stm` with the `crossserver` option to
  let her reference your own conversations from other servers.
- Clear your user-specific STM with `/personal stm clear`. STM also expires over time.

## Conditioning

`/conditioning` is a per-persona, per-server memory that steers a persona's behavior over
time — a lighter-weight nudge than a full attribute or system prompt. Use it to reinforce
how a specific character should act in a specific server.

---

**Privacy:** For exactly what she stores and how to export or delete it, see
[Data Handling](/features/knowledge/data-handling/) and `/legal privacy`. You can opt out of memory
entirely with `/personal privacy`.
