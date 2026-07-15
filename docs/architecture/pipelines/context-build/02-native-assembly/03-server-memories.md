---
title: "02.3: Server Memories"
---

Persona-scoped long-term server memories.

**File:** `src/utils/text/context/memories.ts:28-100`

## Mission

Pull persona-scoped memories from the `server_memories` table for the
current server + persona lineage, optionally filter by channel tag, and
emit one context item containing all visible memory lines. Each line is
formatted as `[id:N] content (tags: ...)` so the LLM can reference them by
ID for the memory-update tools.

## Input

- `tomoriState` (provides `server_id`, `persona_lineage_id`)
- `guildId`, `serverName`, `botName`
- `isDMChannel`
- `personalMemoriesEnabled` (passed to `convertMentions`)
- `conversationCorpus` — joined lowercased history text, used for tag
  filtering (`null` if `memory_tagging_enabled` is off)
- `client`, `convertMentions`

## Output

`Promise<StructuredContextItem | null>` — `null` if no memories survive
filtering, otherwise one `system`-role item tagged
`KNOWLEDGE_SERVER_MEMORIES`.

Content header:

- Guild channels: `## {botName}'s Memories about {serverName}`
- DM channels: `## {botName}'s Memories about this conversation with User`

## Side effects

- **DB query** — direct `sql` template literal against `server_memories`
  filtered by `server_id` and `persona_lineage_id`, ordered by
  `created_at DESC`. *Not* via the repository pattern in this case — see
  Extension points below.
- **DB query fallback** — on query failure, falls back to the in-memory
  `tomoriState.server_memories` array (without per-memory IDs / tags).
- **Tag filtering** — when `conversationCorpus` is non-null, drops rows
  whose tags don't appear in the conversation text (after stripping
  surrounding quotes and lowercasing).
- **Mention conversion** — the assembled memory block passes through
  `convertMentions`.

## Invariants

After this stage runs:

- Returns `null` if `tomoriState.server_memories` is empty or all rows are
  filtered out.
- Memory IDs are stable across builds — they come from the
  `server_memory_id` primary key, not array indices.
- Skipped *upstream* in `nativeBuilder.ts` when `isUserImpersonation` is
  true (the contributor isn't even called).

## Configuration

| Source | Field | Effect |
|---|---|---|
| `tomoriConfig` | `memory_tagging_enabled` | Enables conversation-corpus tag filtering (set in `nativeBuilder.ts` before calling this contributor) |

## Extension points

This contributor is the canonical example of the **"memory type" plugin
category** the eventual plugin plan will define. Today it's hardcoded to
the `server_memories` table; a plugin adding a new memory kind (e.g.
"factual memories," "relationship memories") would either:

- (a) Register a new memory contributor with its own table + tag, fetched
  in parallel here. → plugin plan candidate.
- (b) Ship its own table behind the plugin contract's `migrations` field
  and emit a separate context item.

Two architectural notes that constrain how a plugin could engage with this
seam:

| Surface | Plugin-relevance |
|---|---|
| Direct SQL via `sql` template literal | Not via `serverMemoryRepository` because the contributor needs row IDs *and* tags together — the repo returns memory text only. → plugin plan candidate to add a repo method that returns both. |
| `formatMemoryWithId` | Format is shared with personal memories in stage 06 — a plugin adding new memory kinds should reuse this formatter to keep ID references consistent. |
| Channel-tag filter | The conversation corpus is *built once* in `nativeBuilder.ts` and shared across contributors that filter on tags (this one + personal memories in stage 06). |

## Related docs

- Personal memories (per-user) → stage 06 participants
  ([`06-participants.md`](/architecture/pipelines/context-build/02-native-assembly/06-participants/))
- Short-term memory cache → stage 07
  ([`07-short-term-memory.md`](/architecture/pipelines/context-build/02-native-assembly/07-short-term-memory/))
- Memory tagging system: → no dedicated doc yet; the feature is implemented
  inline here and in `personalMemoryRepository.loadForUserLineage`.
- Memory-update tools (referenced by IDs): tool registry (→ [tool-loop pipeline](../../../tool-loop/))
