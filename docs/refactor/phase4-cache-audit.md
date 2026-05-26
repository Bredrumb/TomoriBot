# Phase 2 #4b Cache Invalidation Audit

This audit records the pre-migration cache invalidation surface for the repository-pattern refactor. During caller migration, each DB write that currently requires manual invalidation should move that invalidation into the repository method that owns the write.

## Audit Command

```sh
rg -n "invalidate[A-Za-z0-9_]*Cache|clear[A-Za-z0-9_]*Cache|invalidateMatrixLinkCache" src --glob "*.ts"
```

## Repository-Owned Today

These invalidations already live inside repository methods and should remain there after callers migrate:

| Cache | Current call sites | Owning repository method |
|---|---|---|
| User row/preferences | `src/utils/db/dbWrite.ts:104`, personal commands, personal memory commands, NovelAI user image tags, long-term-memory tools, `dataImportV2.ts:231` | `UserRepository.register`, `setPrivacyLevel`, `setPrivacyOptOut`, `toggleCrossServerShmOptIn`, `update`, `fromExportShape`; add personal-memory/import writes to `PersonalMemoryRepository` / `ImportExportRepository` during migration |
| User blacklist | `src/commands/server/user-blacklist/add.ts:98`, `remove.ts:387` | `UserRepository.removeBlacklistEntry`; add the blacklist-add path or equivalent repository method during migration |
| Tomori state: config/provider/model settings | `src/commands/config/**`, `src/commands/model/**`, `src/commands/provider/**`, `src/commands/optional-key/**`, `src/commands/capabilities/**`, `src/commands/nsfw/**`, `src/commands/server/config/**` | `ConfigRepository.update`, `applyNaiPreset`, `setFallbackLlms`, `setFallbackModelRefs`; LLM/provider-specific writes should be owned by `LlmRepository` methods |
| Tomori state: persona/profile/settings | `src/commands/persona/**`, speech voice commands, NovelAI persona image/tag commands, webhook-manager persona writes | `PersonaRepository.update`; import/persona-creation/delete/default/swap flows need repository-owned invalidation during migration |
| Tomori state: server memories/documents/history | `src/commands/memory/server/**`, `history/**`, `document/**`, long-term-memory tools | `ServerMemoryRepository.add`; edit/remove/import/document/history writes need repository-owned invalidation during migration |
| Guild MCP config | `src/commands/mcp/add.ts:238`, `remove.ts:163`, `toggle.ts:172` | `ToolRepository.insertMcpServer`, `deleteMcpServer`, `updateMcpServerEnabled` |

## Audit Status After Caller Migration

| Cache | Current call sites | Target repository owner |
|---|---|---|
| Channel LLM overrides | Former command callers in `/model text`, `/model override remove`, and `/provider custom-endpoint remove` | `LlmRepository.setChannelLlmOverride`, `deleteChannelLlmOverride`, `clearAllChannelLlmOverrides`, and server-scoped `deleteCustomEndpoint` invalidate channel-LLM caches after successful writes. |
| Tomori state for LLM/provider writes | Former caller-side invalidations in `/model fallback`, `/model parameters`, `/provider remove`, and custom-endpoint registration/removal paths | `LlmRepository` server-scoped write variants accept `serverDiscId` and invalidate Tomori state after success. Direct `tomori_configs` SQL mirror writes remain caller-owned until they move under repositories. |
| Whitelist decisions | `src/commands/server/whitelist/add.ts:204`, `remove.ts:315`, `persona.ts:398`, `role.ts:121`, `role.ts:150` | `ServerRepository.upsertChannelWhitelist`, `removeChannelWhitelist`, `replacePersonaWhitelistChannels`, `removeChannelPersonaWhitelist`, `upsertRoleWhitelist`, `removeRoleWhitelist` |
| Personal spotlight | `src/commands/personal/spotlight/set.ts:341`, `manage.ts:144` | Add repository coverage or keep in a dedicated personal-spotlight DB module if it remains outside #4b |
| ST preset cache | `src/utils/db/stPresetDb.ts:78`, `219`, `245`, `279` | Existing `stPresetDb.ts` owns this cache; if it later moves under repositories, preserve same write-after-success placement |
| Emoji/sticker cache | `src/events/guildEmojisUpdate/refreshEmojis.ts:58`, `guildStickersUpdate/refreshStickers.ts:58` | Event-driven cache; keep outside repository because the invalidation follows Discord events, not DB writes |
| Matrix link cache | `src/commands/server/matrix/link.ts:170`, `171`, `unlink.ts:129` | Matrix bridge repository/module if matrix DB access is migrated; otherwise keep with Matrix command/link manager |
| Webhook cache | `src/utils/discord/webhookManager.ts` internal invalidation helpers | Keep in `webhookManager`; cache keys are Discord webhook lifecycle state rather than repository reads |
| Full import/export | Former command-side invalidations in personal/server config and memory imports | `ImportExportRepository.importPersonalSettings`, `importPersonalMemories`, `importServerConfig`, `importServerMemories`, `importPersonalData`, and `importServerData` invalidate after successful imports. |

## Documented Caller-Owned Paths

| Cache | Current call sites | Reason ownership remains outside repositories |
|---|---|---|
| Personal memory command/tool edit/remove/add paths | `/memory personal add/edit/remove`, `memoryTool`, `updateLongTermMemoryTool` | These flows still perform multi-step command/tool orchestration around direct SQL or tool-specific mutation logic. Cache invalidation remains immediately after successful writes in the same command/tool path until those mutations are extracted into repository methods. |
| Server memory command/tool edit/remove/add/document/history paths | `/memory server add/edit/remove`, `/memory document/*`, `/memory history/*`, `memoryTool`, `updateLongTermMemoryTool` | These paths combine Discord modal/pagination state, document/history side effects, or tool-specific memory matching with the write. Caller/tool ownership is explicit for Phase 2 because moving the mutation would broaden #4b beyond repository facade cleanup. |

## Migration Rule

When a caller moves from `dbRead.ts`, `dbWrite.ts`, `dataExport.ts`, or `dataImportV2.ts` to a repository, delete the caller-side invalidation only after confirming the repository method invalidates the same cache key after a successful write. If the current repository method only delegates to the old DB function, add the invalidation there before switching the caller.
