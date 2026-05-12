<!-- ARCH-ALIGNMENT: prereq-phase-1 -->

# 11. Utils and Helpers

This is a current map of shared utility modules under `src/utils/`.

## Folder Map

- `utils/cache`
- `utils/db`
- `utils/discord`
- `utils/documents`
- `utils/embeddings`
- `utils/image`
- `utils/matrix`
- `utils/mcp`
- `utils/media`
- `utils/misc`
- `utils/provider`
- `utils/quota`
- `utils/security`
- `utils/storage`
- `utils/teach`
- `utils/text`
- `utils/tools`

## High-Impact Modules

### `utils/db`

- `client.ts`: DB client wiring
- `dbRead.ts`: read queries and model/provider/preset loading
- `dbWrite.ts`: writes and setup helpers
- `cooldownManager.ts`, `messageCooldown.ts`, `cooldownsCleanup.ts`
- `channelWhitelist.ts`, `dataExport.ts`, `dataImportV2.ts`

### `utils/discord`

- `commandLoader.ts`: command discovery + localization wiring
- `commandRegistry.ts`: runtime command maps used by handlers
- `interactionHelper.ts`: reply helpers, modal/pagination workflows
- `streamOrchestrator.ts`: provider-agnostic streaming delivery
- `webhookManager.ts`: persona webhook lifecycle + cache
- `embedHelper.ts`, `historyFetcher.ts`, `historyFormatter.ts`

### `utils/text`

- `localizer.ts`: locale auto-discovery + lookup
- `contextBuilder.ts`: structured context construction
- `contextTruncator.ts`: token-budget truncation strategy
- `stringHelper.ts`: barrel re-export — all string utilities live in `utils/text/processors/`
- `processors/regexUtils.ts`: `escapeRegExp`
- `processors/mentionProcessor.ts`: mention resolution, template variables, emoji normalization
- `processors/llmOutputProcessor.ts`: LLM output cleaning, speaker-turn truncation
- `processors/chunkProcessor.ts`: message chunking, sentence splitting
- `processors/formatters.ts`: time formatting, text humanization, boolean display
- `processors/timeUtils.ts`: reminder time parsing, lateness calculation
- `emojiHelper.ts`, `emojiPenalty.ts`
- `timezoneHelper.ts`, `uncensor.ts`, `youTubeUrlCleaner.ts`

### `utils/cache`

- `tomoriStateCache.ts`
- `userCache.ts`
- `emojiStickerCache.ts`
- `channelWhitelistCache.ts`
- `shortTermMemoryCache.ts`
- `llmCache.ts`
- `openrouterCapabilityCache.ts`
- `geminiCapabilityCache.ts`
- `novelaiCapabilityCache.ts`
- lazy sync helpers (`emojiLazySync.ts`, `stickerLazySync.ts`)

### `utils/security`

- `secretsManager.ts`: `.env` vs AWS Secrets Manager load path
- `keyManager.ts`: encryption key version management
- `crypto.ts`: encryption/decryption helpers
- `keyRotation.ts`: rotation workflows
- `rateLimiter.ts`: upload quota cleanup scheduler
- `safeDownload.ts`: constrained external content download

### `utils/quota`

- `imageQuotaManager.ts`: per-user and server-wide image generation quotas
- `textQuotaManager.ts`: per-user and server-wide text trigger quotas
- `videoQuotaManager.ts`: per-user and server-wide video generation quotas

### `utils/provider`

- `providerFactory.ts`: provider auto-discovery and instance resolution

### `utils/mcp`

- `mcpManager.ts`: MCP lifecycle
- `mcpExecutor.ts`: MCP execution abstraction
- `mcpConfig.ts`: MCP config loading
- `mcpUrlSecurity.ts`: guild MCP URL parsing, DNS/IP validation, and SSRF hardening

### `utils/matrix`

- `matrixManager.ts`: Matrix bridge runtime
- `index.ts`: exported matrix init surface

### `utils/image` and `utils/storage`

- `avatarHelper.ts`, `imageProcessor.ts`, `pngMetadata.ts`
- `avatarStorage.ts` for S3/public avatar URL support
- `charrefStorage.ts` for NovelAI character reference storage (S3 in production, local filesystem in non-production)

### `utils/misc`

- `logger.ts`: structured logging facade
- `ioHelper.ts`: filesystem traversal helpers
- `healthTracker.ts`: runtime health signals used by `/health`

## Usage Guidance

- Prefer these shared modules over duplicating logic in commands/events.
- For user-facing responses, always pair utility usage with localization via `localizer()`.
- For DB writes touching cached data, invalidate the affected caches in the same code path.
