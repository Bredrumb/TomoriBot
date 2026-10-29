---
title: "02.3: Server Memories"
aiGenerated: true
---

Server memories provide persona-scoped long-term memories stored for the active server or direct message channel.

## Flow and ownership

The contributor `buildServerMemoryContextItem` in `src/utils/text/context/memories.ts` loads and formats memories for the current persona lineage:

1. **Precondition check**: Returns `null` if `tomoriState.server_memories` is empty or undefined. In `nativeBuilder.ts`, the contributor is skipped entirely during user impersonation.
2. **Database retrieval**: Queries `serverMemoryRepository.loadServerMemoriesScoped(serverId, personaLineageId)` for all active memories scoped to the server and persona lineage. If loading fails or scoping IDs are missing, it falls back to the in-memory `tomoriState.server_memories` array.
3. **Channel scope filtering**: When `channelMemoryEnabled` is enabled, a memory with a non-empty `channel_disc_ids` is filtered out unless it contains the current channel ID or, inside a thread, the parent channel ID (`channelScopeAdmits` in `src/utils/discord/channelScope.ts`). An empty scope applies in every channel. A memory whose legacy `#name` scope from migration 111 is still unresolved (`channel_scope_pending`, read from `legacy_channel_scope_tags`) has an empty scope, so it applies in every channel until the backfill or an admin narrows it.
4. **Formatting and emission**: Surviving rows are formatted as `ID:${id} ${content}` using `formatMemoryWithId` and wrapped in a section header:
   - Guild channels: `## {botName}'s Memories about {serverName}`
   - Direct messages: `## {botName}'s Memories about this conversation with User`

The block is emitted as one `system`-role item tagged `KNOWLEDGE_SERVER_MEMORIES` after passing through `convertMentions`.

The item also carries individual plain-text memory entries with internal identities and recency.
NovelAI fits and renders those entries without tool IDs or tag prefixes; ordinary providers retain
the formatted block. Placeholder and mention resolution applies to both projections.

## Constraints and rationale

- **Stable memory IDs**: Prompt IDs map to `server_memory_id`, allowing `update_long_term_memory` to target a row for replacement or deletion. Empty replacement content requests deletion.
- **Legacy tags are inert**: Server memory keyword and `#channel` tags neither hide a memory nor appear in its prompt line. Lorebooks own keyword activation, and channel ids own channel scope.
- **Scopes are IDs**: A stored scope survives channel renames. Document retrieval applies the same channel-or-parent rule in SQL (`retrieveRelevantDocumentChunks`). Data export leaves scopes out, so imported memories arrive unscoped.
- **Preset reassembly**: Tagged as `KNOWLEDGE_SERVER_MEMORIES`, which SillyTavern preset reassembly flushes at the first knowledge anchor.

## Source pointers

- `src/utils/text/context/memories.ts`: `buildServerMemoryContextItem`.
- `src/utils/db/repositories/ServerMemoryRepository.ts`: `loadServerMemoriesScoped`.
- `src/utils/memory/memoryId.ts`: `formatMemoryWithId`.
- `src/utils/text/context/mentionNormalizer.ts`: `convertMentions`.
- [Long-Term Memory Pipeline](/architecture/pipelines/memory/ltm/): Creation, modification, and deletion lifecycles.
