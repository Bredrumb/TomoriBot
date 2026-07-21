---
title: "Utils and Helpers"
---

This is a current map of shared utility modules under `src/utils/`.

## Folder Map

- `utils/async`
- `utils/audio`
- `utils/bridges`
- `utils/cache`
- `utils/chat`
- `utils/compaction`
- `utils/conditioning`
- `utils/db`
- `utils/discord`
- `utils/documents`
- `utils/embeddings`
- `utils/image`
- `utils/mcp`
- `utils/media`
- `utils/memory`
- `utils/metrics`
- `utils/misc`
- `utils/novelai`
- `utils/persona`
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
- `initializeDatabase.ts`: schema + seed startup runner
- `sqlSecurity.ts`: query parameterisation helpers
- `sqlSplitter.ts`: SQL file parsing utilities
- `ragAvailability.ts`: pgvector / RAG feature detection
- `repositories/`: 23 domain-owned Repository classes + `index.ts` (instance + type re-exports only). All SQL is inlined as `private` methods on each Repository class — no `*ReadSql.ts` / `*WriteSql.ts` sibling files exist. `ErrorLogRepository` is a thin shim used by `logger.ts` to insert into `error_logs` without creating a circular import. See `docs/architecture/subsystems/database-schema.md` for the full repository table and SQL convention.

### `utils/discord`

- `commandLoader.ts`: command discovery + localization wiring
- `commandRegistry.ts`: runtime command maps used by handlers
- `interactionHelper.ts`: compatibility barrel for grouped UI helpers in `utils/discord/ui/`; new code imports the owned UI module directly
- `streamOrchestrator.ts`: public stream orchestration entry point backed by responsibility modules in `utils/discord/stream/`
- `webhookManager.ts`: compatibility barrel for grouped webhook helpers in `utils/discord/webhook/`; new code imports the owned webhook module directly
- `embedHelper.ts`: shared embed builders (`createStandardEmbed`, `createSummaryEmbed`, `createTipEmbed`, `sendStandardEmbed`) — see [Tip embeds](#tip-embeds) below
- `historyFetcher.ts`, `historyFormatter.ts`

#### Tip embeds

`createTipEmbed(locale, tipKeys, tipVars?)` in `embedHelper.ts` builds the reusable green **💡 Tip**
embed shown alongside an error/info embed (e.g. by `stream/errorUi.ts` and `ui/interactionCore.ts`).

- Each entry in `tipKeys` is an **atomic** locale key resolved independently and rendered as its own
  dashed bullet (`- item`). Keys live under `genai.tips.*` (see the Localization doc's
  [Tip-item keys](./localization.md#tip-item-keys-genaitips) convention).
- Tips render as an embed **description**, not a footer, so markdown and hyperlinks render — that is
  the reason tips moved out of error-embed footers.
- **Conditional tips are the caller's job**: include or omit a key inline (e.g. an OpenRouter-only
  item) instead of maintaining whole-paragraph tip strings per branch. Items that resolve to empty
  text are dropped, and the function returns `null` when nothing resolves, so the caller can skip
  attaching a tip embed entirely.
- Colored `ColorCode.SUCCESS` (green) to read as "helpful" and stay visibly distinct from the
  red/yellow error embed above it; the description is truncated to Discord's embed-description limit.

### `utils/text`

- `localizer.ts`: locale auto-discovery + lookup
- `contextBuilder.ts`: public structured context routing and native orchestration
- `context/`: context-builder support modules for types, template/conditioning blocks, memories, RAG, and history/media helpers
- `contextTruncator.ts`: token-budget truncation strategy
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
- `channelLlmCache.ts`, `channelLlmCacheStore.ts`
- `channelWhitelistCache.ts`
- `shortTermMemoryCache.ts`
- `llmCache.ts`
- `openrouterCapabilityCache.ts`
- `geminiCapabilityCache.ts`
- `novelaiCapabilityCache.ts`
- `emergencyCacheClearer.ts`: critical-memory cleanup for recoverable caches
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

### `utils/bridges`

- `bridgeUserId.ts`: bridge ID and webhook username parsing utilities
- `matrix/`: Matrix appservice bridge runtime
- `matrix/events.ts`: appservice init and Matrix inbound event surface
- `matrix/stateSync.ts`: Matrix link cache, typing state, reminder mention surface
- `matrix/userMapping.ts`: Matrix display-name/ID maps and persona intent surface
- `matrix/rooms.ts`: Matrix room join/config/encryption helpers
- `matrix/matrixManager.ts`: thin Matrix public coordinator barrel

New code should use `utils/bridges` for generic bridge helpers and `utils/bridges/matrix` for Matrix runtime operations.

### `utils/image` and `utils/storage`

- `avatarHelper.ts`, `imageProcessor.ts`, `pngMetadata.ts`
- `avatarStorage.ts` for GCS or S3-compatible public avatar URL support
- `voiceSampleStorage.ts` for GCS or S3-compatible voice sample storage
- `charrefStorage.ts` for NovelAI character reference storage (S3-compatible in production, local filesystem in non-production)
- `S3_ENDPOINT` enables Cloudflare R2 or another S3-compatible endpoint; when set,
  storage clients use path-style requests while public URLs still come from the
  relevant `*_PUBLIC_BASE_URL` value.

### `utils/misc`

- `logger.ts`: structured logging facade
- `ioHelper.ts`: filesystem traversal helpers
- `healthTracker.ts`: runtime health signals used by `/health`

## Usage Guidance

- Prefer these shared modules over duplicating logic in commands/events.
- For user-facing responses, always pair utility usage with localization via `localizer()`.
- For DB writes touching cached data, invalidate the affected caches in the same code path.
