---
title: "STM Sub-Pipeline"
sidebar:
  label: "Overview"
  groupLabel: "STM"
  order: 510
---

Manages the short-term memory cache — an in-process `Map` that stores recent
conversation turns per channel/persona pair up to the configured limit. Two
write paths exist:

| Stage | File | Trigger | What it writes |
|---|---|---|---|
| `01-passive-capture.md` | `storeShortTermMemory` | Post-turn, always | Crude conversation capped by `SHORT_TERM_MEMORY_MAX_MESSAGES_PER_CHANNEL` |
| `02-summary-upgrade.md` | `updateShortTermMemorySummary` | Mid-turn, LLM tool call | LLM-authored summary written to the cache and database |

## Key design facts

- **Hybrid persistence** — crude messages exist only in the in-process cache,
  while summaries, categories, and cadence state are stored in the database.
  After a process restart, durable fields are hydrated with an empty crude
  message list; crude history repopulates channel by channel as the bot replies.
- **Dual-key scoping** — every write creates (or updates) two cache entries:
  one user-scoped (`shortterm:user:userId:channelId[:personaId]`) and one
  server-scoped (`shortterm:server:serverId:channelId[:personaId]`). DM
  sessions get only the user-scoped key.
- **Summary takes priority** — the context-build stage renders the `summary`
  field when present, ignoring the `messages` array. The passive capture
  (stage 01) preserves any existing summary when overwriting the messages
  array.
- **One upgrade per turn** — `streamingContext.disableShortTermMemoryUpdate`
  is set to `true` after the first successful `update_short_term_memory` tool
  call, preventing the LLM from calling it again within the same tool-loop
  iteration.

## Cross-references

- Intent gate that may suppress stage 02: → [memory pipeline README](../README)
- Read side (both stages): → [context-build STM stage](../../context-build/02-native-assembly/04-stm-memories)
- Tool-loop that triggers stage 02: → [tool-loop Stage 02 `executeToolCall`](../../tool-loop/02-execute-tool-call)
- Post-turn effects that trigger stage 01: → [chat per-turn Stage 04](../../chat/06-per-turn/04-post-turn-effects)
