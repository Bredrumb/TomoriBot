---
title: "Memory Pipeline"
sidebar:
  groupLabel: "Memory"
  order: 500
---

Handles all memory writes that occur within or around a chat turn: detecting
whether the user explicitly wants something remembered long-term, capturing
the conversation in the short-term cache after each turn, and executing
LLM-initiated memory tool calls that persist or update facts in the database.

The pipeline has two distinct sub-paths that a single turn may or may not
activate, governed by an intent-detection gate that runs before the tool-loop:

- **STM path** — always runs (passive capture), and optionally runs a
  LLM-authored summary upgrade via the `update_short_term_memory` tool.
- **LTM path** — only runs when the LLM calls `create_long_term_memory` or
  `update_long_term_memory` during the tool-loop.

The two paths are not mutually exclusive per turn, but the intent gate
(`hasExplicitLongTermMemoryIntent`) suppresses the STM upgrade tool when the
user's message explicitly asks for persistent memory, steering the LLM toward
the LTM tools instead.

## Read order

1. `README.md` — this file (pipeline overview, intent gate, sub-path split)
2. `stm/README.md` → `stm/01-passive-capture.md` → `stm/02-summary-upgrade.md`
3. `ltm/README.md` → `ltm/01-ltm-create.md` → `ltm/02-ltm-update-delete.md`

## Intent detection gate

**Symbol:** `hasExplicitLongTermMemoryIntent` —
`src/utils/memory/explicitLongTermMemoryIntent.ts:31`

**Where it runs:** Inside `buildChatTurnContext` (`src/utils/chat/contextPipeline.ts:70`),
before the tool-loop begins.

**What it does:** Scans the incoming user message for explicit persistence
phrases. English phrases: `"remember"`, `"don't forget"`, `"note"`,
`"commit to memory"`, `"for future conversations"`, `"for future reference"`.
Japanese phrases: `"覚えておいて"`, `"忘れないで"`, and several conjugation
variants. Matching is case-insensitive and NFKC-normalized.

When a match is found, `streamingContext.explicitLongTermMemoryIntent = true`
is set on the `StreamingContext` that flows into the provider and tool-loop
pipelines. Two downstream effects:

1. `UpdateShortTermMemoryTool.isAvailableForContext()` returns `false` — the
   STM upgrade tool is not offered to the LLM that turn.
2. The STM system-prompt nudge built in `buildShortTermMemoryContext`
   (`src/utils/text/context/memories.ts:245`) is omitted — the LLM receives
   no STM-update invitation when the user is asking for persistent memory.

## Pipeline flow

```
incoming user message
         │
         ▼
 [Intent detection gate]
 hasExplicitLongTermMemoryIntent()
         │
         ├─ true ─────────────────────────────────────────────────┐
         │         explicitLongTermMemoryIntent flag set           │
         │         STM tool suppressed this turn                   │
         │                                                         │
         │  tool-loop ─────────────────────────────────────────►  │
         │      │                                                  │
         │      └─ LLM calls create / update LTM ─────────────►  [LTM path]
         │                                                         │
         ├─ false (or no match) ──────────────────────────────┐    │
         │                                                    │    │
         │  tool-loop ───────────────────────────────────►   │    │
         │      │                                            │    │
         │      └─ LLM calls update_short_term_memory ──►  [STM upgrade]
         │                                                    │    │
         └───────────────────────────────────────────────────┘    │
                                                                   │
 post-turn ─────────────────────────────────────────────────►     │
     │                                                            │
     ▼                                                            │
 [Passive STM capture]                                           │
 storeShortTermMemory() ─────────────────────────────────────────┘
```

## Sub-pipeline index

| Sub-folder | Stages | What it covers |
|---|---|---|
| `stm/` | 2 stages | In-process cache writes: passive turn capture + LLM-authored summary upgrade |
| `ltm/` | 2 stages | Database writes: LTM creation and LTM update/delete via LLM tool calls |

## Cross-references

- **Caller (write trigger):** [chat per-turn Stage 04 `runPostTurnEffects`](../chat/06-per-turn/04-post-turn-effects) — issues the passive STM write after every successful generation turn
- **Caller (tool trigger):** [tool-loop pipeline — Stage 02 `executeToolCall`](../tool-loop/02-execute-tool-call) — executes the memory tool calls that drive both the STM upgrade and all LTM writes
- **Read side (STM):** [context-build Stage 02-04 `buildShortTermMemoryContext`](../context-build/02-native-assembly/04-stm-memories) — reads STM cache entries built by this pipeline
- **Read side (LTM — server):** [context-build `buildServerMemoryContext`](../context-build/02-native-assembly/03-server-memories) — reads server memories written by `ltm/01-ltm-create.md`
- **Read side (LTM — personal):** [context-build `buildPersonalMemoryContext`](../context-build/02-native-assembly/07-personal-memories) — reads personal memories written by `ltm/01-ltm-create.md`

## Pipeline-wide concerns

### Memory scope taxonomy

| Type | Storage | TTL | Written by | Read by |
|---|---|---|---|---|
| STM crude conversation | In-process `Map<key, ShortTermMemoryEntry>` | 12 h (default) | Passive capture (post-turn) | Context-build STM stage |
| STM summary | Same cache, `summary` field | 24 h (default) | `update_short_term_memory` tool | Context-build STM stage (summary takes priority over crude) |
| LTM server memory | `server_memories` DB table | Permanent | `create_long_term_memory` tool | Context-build server-memory stage |
| LTM personal memory | `personal_memories` DB table | Permanent | `create_long_term_memory` tool | Context-build personal-memory stage |

### Feature flag

Both LTM tools (`create_long_term_memory`, `update_long_term_memory`) require
`self_teaching_enabled = true` in `TomoriState.config`. The STM tools have no
feature flag — they are always available (except the NovelAI provider
exclusion for `update_short_term_memory`).

### Privacy guards

- **`PrivacyLevel.FULL` triggerer** — passive STM capture is skipped entirely.
- **`PrivacyLevel.PARTIAL` or `FULL` target user** — personal LTM create and
  update are blocked; the tool returns an error the LLM can relay to the user.
- **`persona_lineage_id = 0`** — LTM create is blocked (reserved for global
  memories; signals an un-run schema migration).

### Cache invalidation after LTM writes

After every successful LTM DB write:

- **Server memory:** `invalidateTomoriStateCache(serverId)` — the next
  context-build for that server will re-load from DB.
- **Personal memory:** `invalidateUserCache(userId)` — the next context-build
  for that user will re-load from DB.

Invalidation happens in the same code path as the DB write (immediately after
the `dbResult` check), never before.
