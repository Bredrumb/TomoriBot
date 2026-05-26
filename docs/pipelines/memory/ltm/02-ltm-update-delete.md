<!-- ARCH-ALIGNMENT: prereq-phase-5.5d -->

# LTM Stage 02 — `UpdateLongTermMemoryTool.execute` (LTM update/delete)

LLM-initiated replacement or deletion of an existing persistent memory,
identified by the `ID:N` shown in the LLM's context.

**File:** `src/tools/functionCalls/updateLongTermMemoryTool.ts` — class
`UpdateLongTermMemoryTool`, tool name `update_long_term_memory`

## Mission

When the LLM identifies an existing memory that needs correction, revision,
or removal, it calls `update_long_term_memory` with the memory's `memory_id`,
new `memory_content` (or empty string to delete), and optionally a
`target_user` to indicate the memory is personal rather than server-wide.

`UpdateLongTermMemoryTool.execute()` runs the following sequence:

1. **Validate** parameters (integer ID > 0, content is a string, feature flag on).
2. **Sanitize content** — `sanitizeUnknownTemplatePlaceholders()` strips
   brace-wrapped non-template tokens. Empty string after sanitization = delete.
3. **Resolve target user** (if `target_user` provided) — same `resolveUserTarget()`
   lookup as stage 01, but bridge users are rejected outright for personal
   updates (they only support server-wide memories).
4. **Scope determination** — `target_user` present → personal path;
   absent → server path.
5. **Privacy / guild membership check** (personal path, update only) —
   `PrivacyLevel.PARTIAL/FULL` blocks the update. Target user must be in the
   guild or DM channel.
6. **Find the memory** (personal delete/update) — loads the user's personal
   memories for this lineage and locates the entry matching `memory_id`.
7. **DB write** — `serverMemoryRepository.updateByIdWithLineage()` /
   `personalMemoryRepository.updateByIdForUserAndLineage()` for updates;
   `serverMemoryRepository.removeByIdWithLineage()` /
   `personalMemoryRepository.removeByIdForUserAndLineage()` for deletes.
8. **Notify** — send an update or delete embed to Discord.
9. **Invalidate cache** — same paths as stage 01.

## Input

Tool arguments (from LLM):

| Arg | Type | Required | Description |
|---|---|---|---|
| `memory_id` | `number` | yes | Integer ID as shown in context (`ID:N`). Must be > 0 and a safe integer. |
| `memory_content` | `string` | yes | Full replacement content. Empty string → delete instead of update. |
| `target_user` | `string` | when personal | Display name of the memory owner. Absent → server memory path. |

Context required: same as stage 01 (`tomoriState`, `channel`, `userId`).

## Output

`Promise<ToolResult>` with `data.status` indicating outcome:

| Status | Meaning |
|---|---|
| `memory_updated_successfully` | DB update succeeded |
| `memory_deleted_successfully` | DB delete succeeded |
| `memory_update_failed_not_found` | No memory with this ID in the current scope |
| `memory_update_failed_disabled` | `self_teaching_enabled` is off |
| `memory_update_failed_privacy_restricted` | Target user has `PrivacyLevel.PARTIAL/FULL` |
| `memory_update_failed_invalid_scope` | Bridge-user personal update attempted; or target not in guild |
| `memory_update_failed_ambiguous_user` | Multiple users matched `target_user` |
| `memory_update_failed_user_not_found` | No matching user found |
| `memory_update_failed_invalid_target` | Attempted to update personal memory about the bot itself |
| `memory_update_failed_db_error` | DB operation failed |

## Side effects

- **DB row updated or deleted** — the row matching `(memory_id, server_id,
  persona_lineage_id)` for server memories, or `(memory_id, user_id,
  persona_lineage_id)` for personal memories.
- **Discord embed sent** — update embed (amber `MEMORY_UPDATE` color) or
  delete embed (red `ERROR` color) sent to `context.channel`.
- **Cache invalidated** — same as stage 01: `invalidateTomoriStateCache` or
  `invalidateUserCache` immediately after DB success.

## Invariants

After a successful update:

- The row with `memory_id` contains `newContent` as its `content` column.
- The TomoriState or user cache for the affected scope has been invalidated.

After a successful delete:

- No row with `memory_id` exists in the relevant table for this
  `(server_id / user_id, persona_lineage_id)` scope.
- The embed shows the deleted content (fetched from the `deletedMemory` return
  value before deletion) for user confirmation.

## Scope disambiguation

| Condition | Path taken |
|---|---|
| `target_user` absent | Server memory path — update/delete from `server_memories` scoped to `(server_id, persona_lineage_id)` |
| `target_user` present and resolved | Personal memory path — update/delete from `personal_memories` scoped to `(user_id, persona_lineage_id)` |
| `target_user` is a bridge user | Error — bridge users only support server-wide memories |
| `target_user` resolves to the bot | Error — personal memories about the bot are not supported |

## Extension points

| Surface | Plugin-relevance |
|---|---|
| `serverMemoryRepository.updateByIdWithLineage()` / `removeByIdWithLineage()` | Internal — scope is fixed by `(server_id, persona_lineage_id)`; no plugin seam for custom scoping within this method. |
| `personalMemoryRepository.updateByIdForUserAndLineage()` / `removeByIdForUserAndLineage()` | Internal — same as above for personal scope. |
| Embed color (`ColorCode.MEMORY_UPDATE` vs `ColorCode.ERROR`) | Internal — color codes are defined in `src/utils/misc/logger.ts`; not a plugin seam. |

## Related docs

- Stage that creates the memories updated here: → [`ltm/01-ltm-create.md`](01-ltm-create.md)
- Context-build stages that read these memories: → [server](../../../context-build/02-native-assembly/03-server-memories.md) / [personal](../../../context-build/02-native-assembly/07-personal-memories.md)
- Privacy level schema: → `src/types/db/schema.ts` (`PrivacyLevel` enum)
- Bridge user detection: → `src/utils/bridges/index.ts`
