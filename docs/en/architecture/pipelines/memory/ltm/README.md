---
title: "LTM Sub-Pipeline"
sidebar:
  label: "Overview"
  groupLabel: "LTM"
  order: 520
aiGenerated: true
---

The long-term memory (LTM) sub-pipeline manages durable facts and preferences learned by the model. It owns model-initiated writes and the decay lifecycle shared by prompt assembly and post-turn accounting.

The sub-pipeline provides two operational stages:

| Stage | Tool name | Operation | Storage target |
|---|---|---|---|
| [01: Memory Creation](/architecture/pipelines/memory/ltm/01-ltm-create/) | `create_long_term_memory` | Inserts a new server or personal memory record | `server_memories` or `personal_memories` |
| [02: Memory Update & Delete](/architecture/pipelines/memory/ltm/02-ltm-update-delete/) | `update_long_term_memory` | Updates or deletes an existing memory by its integer ID | `server_memories` or `personal_memories` |

## Key design facts

- **Feature flag requirement:** both tools require `self_teaching_enabled = true` in `TomoriState.config`. When disabled, the tool returns a failure result and halts without altering database records.
- **Persona lineage scoping:** Server memories use server ID plus lineage; personal memories use user ID plus lineage and follow the user across servers. Persona lineage ID 0 is reserved for global memories and rejected for self-taught records.
- **Dual scope partitioning:** memories are classified as either `server_wide` (stored in `server_memories`, keyed by `server_id` and `persona_lineage_id`) or `target_user` (stored in `personal_memories`, keyed by internal `user_id` and `persona_lineage_id`).
- **Cache invalidation ownership:** Memory tools invalidate Tomori state or user caches after writes. Both scopes invalidate after persistence and before notification.
- **Template placeholders:** content uses `{user}` and `{bot}` tokens instead of hardcoded names. `sanitizeUnknownTemplatePlaceholders()` strips unrecognized brace tokens before saving to storage.

## Decay lifecycle

`MEMORY_DECAY_ENABLED` defaults to on; only the literal `false` disables it installation-wide.
There are no panel controls. Stage is derived from `decay_days`, never stored: below 7 is active,
and 7 or more is dormant when pgvector and an embedding model are available. Without those
prerequisites, memories remain active. Disabling decay also stops recall accounting and automatic
eviction; document search remains independent.

1. Native assembly starts `startQueryRetrieval` in `src/utils/text/context/queryRetrieval.ts`.
   Documents and memories share its latest-user-query embedding and resolved embedding credentials.
   No documents and no visible memory candidates means no embedding request.
2. Server assembly and participant hydration collect candidates after lineage, channel, tag,
   privacy, personalization, and impersonation filtering. Dormant memories leave the ordinary
   memory blocks. `memoryRecall.ts` scores only these visible candidates in the resolved vector
   family, selecting at most three combined server and personal winners at cosine similarity 0.5
   or higher. Active winners are reinforced without being repeated.
3. Dormant winners render as a user-role `KNOWLEDGE_RECALLED_MEMORIES` block immediately before
   documents in the uncached tail. Native and preset layouts preserve that placement, so recall
   selection leaves the cached prefix stable. A later stage change affects the next build.
4. `contextPipeline.ts` carries the recall outcome into `ChatTurnContext`. After generation,
   `runPostTurnEffects` starts `persistMemoryRecall` without awaiting it. Only real chat turns
   persist: inspection, estimation, and image-only builds may score but discard the outcome.
5. `MemoryDecayRepository.recordRecallDay` increments vector-backed, in-scope candidates that did
   not win at most once per UTC day. Winners reset to zero and record reinforcement that day;
   reinforcement wins concurrent accounting. Missing vectors neither age nor reinforce that turn.
   Days without successful scoring do not count, and no background job ages memories.
6. Post-turn fill embeds missing vectors from stored memory content. Insertion locks the memory
   and checks unchanged content, so deleted or edited text cannot acquire a stale vector. The
   next turn can score the new vector. Edits clear vectors as described in the
   [update stage](/architecture/pipelines/memory/ltm/02-ltm-update-delete/).

Recall has a 1,500 ms scoring budget. A timeout or failure returns no recalled block and performs
no day accounting or fill. Once an embedding model resolves, dormancy still applies if its query
embedding fails. Failures warn and let the reply continue. Full scopes use the dormant-memory
replacement contract in the [creation stage](/architecture/pipelines/memory/ltm/01-ltm-create/).

Scoped memory rows load fresh on each build; vectors and derived stages have no runtime cache.
Day accounting invalidates affected server snapshots after commit. Personal rows need no extra
cache invalidation.

### Recall telemetry

Each real post-turn invocation emits one aggregate-only `memory_recall` sample to `log.metric`
and `metricSampleRepository` after accounting and fill settle. Read-only builds emit none.
`outcome` is one of `disabled`, `rag_unavailable`, `memory_critical`, `no_model`, `no_query`,
`no_candidates`, `timeout`, `provider_error`, or `scored`.

| Fields | Meaning |
|---|---|
| `total_ms`, optional `embedding_ms` | Recall plus persistence duration, and shared query embedding duration |
| `candidate_count`, `scored_count` | Visible candidates and candidates with vectors in the resolved family |
| `reinforced_count`, `recalled_count` | Winners selected and dormant winners injected |
| `quick_return_count` | Recalled memories whose committed reinforcement crossed the dormant threshold with a prior counter of at most 14 |
| `dormant_tokens`, `recalled_tokens` | Estimated withheld memory lines and rendered recall block tokens |
| `query_tokens`, `fill_tokens`, `filled_count` | Estimated query and missing-vector input tokens, and inserted vectors |
| `persistence_failed` | Numeric 0/1 flag for accounting or fill failure |

Net prompt savings are `dormant_tokens - recalled_tokens`, measured against embedding work of
`query_tokens + fill_tokens`. A high share of `quick_return_count` against `recalled_count` means
memories are thrashing between stages and the flat 7-day rule needs review. Metrics contain no
content, names, identifiers, keys, provider/model names, or vectors. Local selection and accounting
algorithms live in `src/utils/text/context/memoryRecall.ts` and
`src/utils/db/repositories/MemoryDecayRepository.ts`.

## Cross-references

- **Intent detection gate:** [Memory Pipeline](/architecture/pipelines/memory/) describes how explicit memory intent prioritizes LTM tools.
- **Tool-loop caller:** [Execute Tool Call](/architecture/pipelines/tool-loop/02-execute-tool-call/) runs tool dispatches for memory modifications.
- **Server memory reader:** [Server Memories Context](/architecture/pipelines/context-build/02-native-assembly/03-server-memories/) formats server-wide memories for prompt injection.
- **Personal memory reader:** [Participants Context](/architecture/pipelines/context-build/02-native-assembly/06-participants/) hydrates personal memories for each participant.
- **Memory formatting:** `src/utils/memory/memoryId.ts` formats memories with their visible `ID:N` prefixes in prompt context.
