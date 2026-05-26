# STM Sub-Pipeline

Manages the short-term memory cache — an in-process `Map` that stores the
last 10 conversation turns per channel/persona pair. Two write paths exist:

| Stage | File | Trigger | What it writes |
|---|---|---|---|
| `01-passive-capture.md` | `storeShortTermMemory` | Post-turn, always | Crude conversation (last 10 messages + new persona response) |
| `02-summary-upgrade.md` | `updateShortTermMemorySummary` | Mid-turn, LLM tool call | LLM-authored summary that replaces the crude conversation |

## Key design facts

- **Cache-only** — STM is never written to the database. A process restart
  clears all STM entries. Cross-restart persistence is not a design goal.
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

- Intent gate that may suppress stage 02: → [memory pipeline README](../README.md)
- Read side (both stages): → [context-build STM stage](../../context-build/02-native-assembly/04-stm-memories.md)
- Tool-loop that triggers stage 02: → [tool-loop Stage 02 `executeToolCall`](../../tool-loop/02-execute-tool-call.md)
- Post-turn effects that trigger stage 01: → [chat per-turn Stage 04](../../chat/06-per-turn/04-post-turn-effects.md)
