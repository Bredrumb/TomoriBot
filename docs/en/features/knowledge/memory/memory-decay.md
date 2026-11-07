---
title: "Memory Decay"
sidebar:
  order: 2
aiGenerated: false
---

Think of a persona's [long-term memories](/features/knowledge/memory/long-term-memory/) as notes on
a desk. She rereads every note on the desk before each reply, so a full desk makes every reply
longer and more expensive. Memory decay moves notes nobody has needed in a while into a drawer.
They are not thrown away: when the conversation touches a note in the drawer, she takes it back
out. These docs call desk notes *active* and drawer notes *resting*.

Decay needs an embedding model; see
[Providers & Models](/features/setup-administration/providers-and-models/). Without one, every
memory stays active.

## How a memory rests and returns

1. Every memory has a counter of unused days. It starts at 0.
2. On each reply, TomoriBot runs one search. She turns the latest message into an embedding (a list
   of numbers that describes its meaning; see [How search works](/features/knowledge/memory/documents/#how-search-works))
   and compares it with every memory she may use in that conversation.
3. Up to 3 of the closest matches, across server and personal memories, count as used if they are a
   reasonable match. Their counters go back to 0.
4. Every other memory in that search gains one day. This happens at most once per day (UTC),
   however many messages are sent.
5. At 7 counted days, the memory rests. It is no longer sent with every reply, but it stays saved
   and searchable.
6. When a later message matches a resting memory, she adds it to that reply and its counter resets,
   so it is active again.

Being active is different from being used. A memory stays active only while it keeps being one of
the top matches for some message.

Only days when the search succeeds count. A day without conversation, or a reply where the search
fails, changes nothing, so no memory rests just because time passed.

### Example

One server memory, "Juno's cat is named Mochi":

| Chat days | What happens | Counter | State |
|---|---|---|---|
| The day it is saved | Saved | 0 | Active |
| The next 6 chat days | Chats about games; Mochi never comes up | 6 | Active |
| A quiet week | Nobody talks | 6 | Active, paused |
| The next chat day | Another chat without Mochi | 7 | Resting |
| A later chat day | Juno asks "how's Mochi doing?" | 0 | Recalled for that reply, then active |

## Whose conversations count

Server memories age on days the persona talks in that server. Personal memories are searched only
when their owner takes part in the conversation, so they age only on those days. Bau visits once a
month, so Bau's memories need 7 visits where they never come up before they rest, and the regulars'
busy days do not wear them down.

Memories hidden by privacy settings, a blacklist, channel limits, or tags are never searched, so they
neither age nor return.

## When memory is full

Each persona holds 100 server memories and 100 personal memories by default. When TomoriBot saves a
new memory into a full list, she forgets one resting memory to make room. A memory that was never
matched goes first, then the one matched longest ago. The confirmation shows what was saved and what
was forgotten, following the server's memory-notice visibility setting.

She never forgets:

- a Global personal memory
- a memory someone added or edited with `/memories` or `/personal memories`

Imported memories are not protected. To protect one, edit and save it once with `/memories` or `/personal memories`. A protected memory can still
rest and return through search; protection only keeps it from being forgotten.

If no memory qualifies, or search is unavailable for that reply, the save is refused.

## Instructions belong elsewhere

A memory like "Always reply to Juno in Spanish" rarely matches what people say, so it can rest and
stop applying. Put instructions that should always apply in
[persona attributes](/features/chatting-personality/multiple-personas/#attributes), the persona
prompt, or an [Always On lorebook entry](/features/knowledge/memory/lorebooks/).

## Cost and prompt caching

The search is one embedding request per reply, shared with
[document](/features/knowledge/memory/documents/) search. Recalled memories go near the end of the
prompt, next to documents, so the start of the prompt stays the same between replies. Providers
discount a repeated prompt start, so recall keeps that discount. The start changes only on a reply
after a memory moves between active and resting.

## Turning decay off

Self-hosters can set `MEMORY_DECAY_ENABLED=false` to turn decay off for the whole installation. Every
memory then stays active, nothing is forgotten to make room, and a full list refuses new saves.
Document search keeps working. Decay also needs the `pgvector` database extension; see
[Manual Setup](/self-hosting/manual-setup/#pgvector--documentrag-memory).
