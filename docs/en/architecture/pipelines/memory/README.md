---
title: "Memory Pipeline"
sidebar:
  label: "Overview"
  groupLabel: "Memory"
  order: 500
aiGenerated: true
---

The memory pipeline writes short-term memory (STM) after replies and long-term memory (LTM) through
tool calls. Post-turn effects capture recent dialogue in the cache and schedule background summaries
when due. The tool loop writes durable facts when the model invokes `manage_long_term_memory`.

## Sub-pipelines

| Sub-pipeline | Stages | Scope |
|---|---|---|
| [STM](/architecture/pipelines/memory/stm/) | [01: Passive Capture](/architecture/pipelines/memory/stm/01-passive-capture/)<br/>[02: Background Summary](/architecture/pipelines/memory/stm/02-summary-upgrade/) | Working memory: in-process cache turns and durable `short_term_memories` rows |
| [LTM](/architecture/pipelines/memory/ltm/) | [01: Memory Creation](/architecture/pipelines/memory/ltm/01-ltm-create/)<br/>[02: Memory Update & Delete](/architecture/pipelines/memory/ltm/02-ltm-update-delete/) | Permanent storage: database writes for server and personal memory tables |

## Cross-references

- **Post-turn write caller:** [Run Generation Turn: Post-Turn Effects](/architecture/pipelines/chat/06-per-turn/04-post-turn-effects/) triggers passive STM capture after generation completes.
- **Tool execution caller:** [Execute Tool Call](/architecture/pipelines/tool-loop/02-execute-tool-call/) runs tool-initiated memory updates.
- **STM reader:** [Short-Term Memory Context](/architecture/pipelines/context-build/02-native-assembly/07-short-term-memory/) formats working memory entries for prompt assembly.
- **Server memory reader:** [Server Memories Context](/architecture/pipelines/context-build/02-native-assembly/03-server-memories/) formats server-wide memories for prompt assembly.
- **Personal memory reader:** [Participants Context](/architecture/pipelines/context-build/02-native-assembly/06-participants/) hydrates personal memories for each participant.

## Memory taxonomy

| Type | Storage | TTL | Write path | Context consumer |
|---|---|---|---|---|
| STM crude turns | In-process cache (`Map`) | Entry: 12 hours, or 24 when summary text exists | Passive turn capture (`storeShortTermMemory`) | STM context assembly |
| STM summary / categories | In-process cache and `short_term_memories` table | Cache: 24 hours with summary text, otherwise 12 hours; database: separate retention | Background summary or manual edit | STM context assembly (takes priority over crude turns) |
| LTM server memory | `server_memories` table | Permanent | `manage_long_term_memory` with `create` | Server memories context assembly |
| LTM personal memory | `personal_memories` table | Permanent | `manage_long_term_memory` with `create` | Participants context assembly |

## Shared constraints and lifecycle

### Feature flags

- **LTM writes.** All `manage_long_term_memory` actions require `self_teaching_enabled = true` in `TomoriState.config`. When disabled, tool execution aborts without writing to the database.
- **STM automation.** `short_term_memory_enabled` controls background summarization. Passive capture and recall remain available with automation off.

### Privacy guards

- **Triggerer privacy:** if the triggering user has `PrivacyLevel.FULL`, passive STM capture aborts immediately.
- **Target user privacy:** if a target user has `PrivacyLevel.PARTIAL` or `PrivacyLevel.FULL`, personal memory creation and updates return a privacy restriction error.
- **Persona lineage:** LTM records are partitioned by `persona_lineage_id`. Creation is blocked if `persona_lineage_id === 0` because zero is reserved for global memories.

### Cache invalidation ownership

- **STM writes.** Background summaries commit the durable state before updating live cache entries.
- **Server LTM writes:** Both tools invalidate Tomori state after database success. Server creation currently awaits its Discord notification first, so a notification failure can leave cached state stale. Update and deletion invalidate before notification.
- **Personal LTM writes:** both tools call `invalidateUserCache(userId)` after successful database writes, so subsequent prompt assemblies fetch fresh records.
