---
title: "LTM 01: Memory Creation"
aiGenerated: true
---

The memory creation stage handles model-initiated persistence of new facts, preferences, or instructions into the database.

## Flow and ownership

When the model identifies information worth preserving across conversations, it invokes `create_long_term_memory` managed by `MemoryTool` in `src/tools/functionCalls/memoryTool.ts`.

Execution proceeds through several validation and routing steps:

1. **Parameter validation:** checks that `memory_content` is a non-empty string, that `memory_scope` is either `server_wide` or `target_user`, and that `self_teaching_enabled` is active in `TomoriState.config`.
2. **Target user resolution:** for `target_user` scope, `resolveUserTarget()` (`src/utils/discord/targetResolver.ts`) matches the requested name against known users and guild members.
   - Ambiguous matches or missing users return an error result to the model.
   - If the target resolves to the bot itself, scope falls back to `server_wide`.
   - If the target is a Matrix bridge user, `{user}` is replaced with the bridge user's display name and scope falls back to `server_wide` because bridge accounts lack internal user records.
3. **Content sanitization and limits:** `sanitizeUnknownTemplatePlaceholders()` strips unrecognized brace tokens while retaining `{user}` and `{bot}`. `validateMemoryContent()` verifies length against `MAX_MEMORY_LENGTH` (default 1000 characters).
4. **Privacy enforcement:** for personal scope, `userRepository.getPrivacyLevel()` inspects the target user. If the user configured `PrivacyLevel.PARTIAL` or `PrivacyLevel.FULL`, creation halts with a privacy restriction notice.
5. **Lineage guard:** persona lineage ID 0 is rejected because zero is reserved for global memories.
6. **Atomic capacity and persistence:** both scopes call their repository's `addWithEviction`.
   Under an owner lock, the repository recounts the scope against `MAX_SERVER_MEMORIES` or
   `MAX_PERSONAL_MEMORIES` (both default to 100). Personal counts include global rows. Below the
   cap it inserts normally; at the cap, enabled decay with available RAG and resolved embedding
   credentials and model for the turn permits replacing the least recently
   reinforced dormant memory without manual protection in that exact lineage. Never-reinforced rows
   come first, with creation time and ID breaking ties. Memories added or edited through `/memories`
   or `/personal memories` and Global personal rows are protected; imported and pre-release rows
   remain eligible. If retrieval prerequisites are missing or no eligible row exists,
   the save is refused.
   Deletion and insertion share one transaction, so a failed save preserves the old memory.
7. **Cache invalidation and notification:** both scopes invalidate their existing state cache after
   successful persistence, before sending the confirmation. Notification failure is non-fatal.
   Eviction confirmations include saved and forgotten content and follow the memory-notice visibility
   setting. Hidden notices go to the thought log; Minimal notices show only the title in conversation
   and mirror the full card to the thought log when configured. Expanded content exceeding Discord's
   embed limit is delivered as an ephemeral `notice.txt` attachment.

Ordinary saves return `memory_saved_successfully` with the new memory ID. Replacement saves return
`memory_saved_with_eviction` and `content_forgotten`, so the model also receives the removed text.
Each eviction emits `memory_eviction` to both metric sinks with only `scope` (`server` or `personal`)
and `decay_days`. Model saves set `manually_written = false`. Adds and edits through `/memories`
and `/personal memories` set it to true, including saves that only change channels or tags and
saves of unchanged, previously unprotected content. This protection does not change dormancy.

Stable proxy identities retain personal memory scope because they own synthetic user rows. Creation and updates also check all linked hosts through `getMessageProxyHostProtection()`. Full host privacy, a server blacklist, or unresolved host links block writes. A new identity may receive a one-time public bio snapshot under lineage 0 through `bioSeeding.ts`; it uses the same host guard and invalidates cache only after a successful write. See [message-proxy integration](/architecture/integrations/message-proxy/).

## Constraints and rationale

- **Lineage isolation:** records are partitioned by `persona_lineage_id`. Personas sharing a character lineage share memories, while distinct character lineages remain isolated.
- **Cache invalidation ordering:** Both scopes invalidate after database success and before notification, so a Discord failure cannot leave the saved state stale.
- **Capacity controls:** limits defined in `src/utils/misc/memoryLimits.ts` prevent database bloat and control token consumption during prompt construction.

## Source pointers

- `src/tools/functionCalls/memoryTool.ts`: `MemoryTool` parameter validation, scope resolution, and execution flow.
- `src/utils/discord/targetResolver.ts`: user name matching and bridge fallback handling.
- `src/utils/db/repositories/ServerMemoryRepository.ts`: queries and limit verification for server memories.
- `src/utils/db/repositories/PersonalMemoryRepository.ts`: queries and limit verification for personal memories.
- `src/utils/cache/tomoriStateCache.ts` and `src/utils/cache/userCache.ts`: cache invalidation functions.
