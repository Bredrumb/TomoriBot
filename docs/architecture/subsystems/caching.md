---
title: "In-Memory Caching System"
---

This document reflects current cache layers in `src/utils/cache/` and related modules.

## Why Caching Matters Here

TomoriBot reads server config, user state, memories, and tool capability metadata on almost every interaction.
Caching reduces repeated DB/API calls and helps meet Discord interaction timing constraints.

## Active Cache Layers

### 1) Tomori state cache (`tomoriStateCache.ts`)

- Key: `serverDiscId`
- Stores all personas for a server + main persona shortcut
- Default TTL: `TOMORI_STATE_CACHE_TTL_MINUTES` (default 10)
- Main APIs:
  - `getCachedAllPersonas(serverDiscId)`
  - `getCachedMainPersona(serverDiscId)`
  - `invalidateTomoriStateCache(serverDiscId)`
- Note: `getCachedTomoriState` is kept as a compatibility wrapper.

### 2) User cache (`userCache.ts`)

- Key: `userDiscId`
- Stores user row, privacy level, and per-server blacklist sub-cache
- Default TTL: `USER_CACHE_TTL_MINUTES` (default 30)
- APIs:
  - `getCachedUserRow`, `getCachedPrivacyLevel`, `getCachedBlacklistStatus`
  - `invalidateUserCache`, `invalidateUserBlacklistCache`

### 3) Emoji/sticker cache (`emojiStickerCache.ts`)

- Key: internal `server_id`
- Stores expression rows loaded from DB after lazy sync checks
- Default TTL: `EMOJI_STICKER_CACHE_TTL_MINUTES` (default 10)
- API: `loadEmojiStickerCache`, `invalidateEmojiStickerCache`

### 4) Channel whitelist cache (`channelWhitelistCache.ts`)

- Key: `serverDiscId:channelDiscId:parentChannelDiscId:roleSignature`
- Stores whitelist decision (channel + role), persona-channel restriction metadata, and optional channel cooldown overrides
- For thread triggers, the parent channel ID is part of the cache key so parent-whitelist inheritance does not collide with non-thread checks
- Default TTL: `CHANNEL_WHITELIST_CACHE_TTL_MINUTES` (default 5)
- API: `getCachedWhitelistStatus`, `invalidateWhitelistCache`

### 5) Short-term memory cache (`shortTermMemoryCache.ts`)

- Keys:
  - user-scoped: `shortterm:user:{userId}:{channelId}` (persona-scoped variant includes `:{personaId}`)
  - server-shared: `shortterm:server:{serverId}:{channelId}` (persona-scoped variant includes `:{personaId}`)
- Stores per-channel conversation snippets and optional summaries
- Guild behavior: the latest STM for a persona in a channel is shared across that server's other channels; user-scoped STM is retained for cross-server opt-in behavior
- When the triggering user message explicitly asks Tomori to remember something for future use, STM tool nudges are suppressed for that turn so long-term memory tools take priority; raw short-term conversation capture still continues after the reply
- TTL env vars:
  - `SHORT_TERM_MEMORY_TTL_HOURS`
  - `SHORT_TERM_MEMORY_SUMMARY_TTL_HOURS`
- Code fallback defaults are 12h/24h; deployers commonly override in `.env`.
- APIs:
  - `storeShortTermMemory`, `getShortTermMemoryForUserChannel`, `getShortTermMemoryForServerChannel`
  - `getShortTermMemoriesForUser`, `getShortTermMemoriesForServer`
  - `updateShortTermMemorySummary`
  - `clearShortTermMemoryForUser`, `clearShortTermMemoryForChannel`, `clearShortTermMemoryForServerChannel`
- Operational note:
  - `/server stm manage` lists the current server's active server-shared STM entries across personas.
  - Unchecking an entry clears only that server-scoped STM entry; user-scoped cross-server STM entries are left intact.

### 6) LLM model cache (`llmCache.ts`)

- Key: `llm_id`
- Warmed at startup from `llms` table
- No runtime TTL/invalidation
- APIs: `initializeLLMCache`, `getCachedLLM`, `getCachedLLMsByProvider`, `getCachedDefaultLLM`

### 7) OpenRouter capability cache (`openrouterCapabilityCache.ts`)

- Key: `llm_codename`
- Warmed at startup from OpenRouter models API
- Stores tools/vision/structured-output capability + token limits
- Tool capability is derived primarily from the reported `tools` parameter, with a fallback for models whose OpenRouter description explicitly advertises native function/tool calling even when the metadata is incomplete.
- `tool_choice` is tracked separately through cached `supported_parameters` and only sent when supported.
- No runtime TTL/invalidation

### 8) Gemini token-limit map (`geminiCapabilityCache.ts`)

- Static in-memory lookup map for known Gemini model token limits

### 9) NovelAI token-limit map (`novelaiCapabilityCache.ts`)

- Static in-memory lookup map for known NovelAI model token limits

### 10) Webhook cache (`utils/discord/webhook/cache.ts`)

- Keys:
  - channel webhook cache (`channelId`)
  - persona webhook cache (`channelId:personaId`)
- No TTL; invalidated on delete/change conditions
- Shared channel webhook tokens are also persisted encrypted in Postgres so restart recovery can rehydrate the cache without recreating the webhook

### 11) Preset avatar cache (`utils/image/avatarHelper.ts`)

- Warmed at startup from preset rows
- No TTL; refresh via restart/re-init

### 12) Voice transcript cache (`utils/audio/voiceTranscriptCache.ts`)

- Key: Discord message ID
- Stores STT/TTS transcript text for older audio messages in history
- Default TTL: `VOICE_TRANSCRIPT_CACHE_TTL_MINUTES` (default 120)

### 13) Markdown table render cache (`utils/text/markdownTableCache.ts`)

- Key: Discord message ID
- Stores original markdown behind rendered table images
- Default TTL: `MARKDOWN_TABLE_CACHE_TTL_MINUTES` (default 120)

### 14b) Channel system prompt cache (`channelPromptCache.ts`)

- **Scope:** per `(server_id, channel_disc_id)` — one entry per channel that may carry an override
- **Value:** `{ prompt, mode }` (`append`/`replace`) for the per-channel system prompt, or `null`
- **Negative caching:** channels with no override cache `null` so DM channels and unconfigured channels cost a single cheap lookup
- Default TTL: `TOMORI_STATE_CACHE_TTL_MINUTES` (default 10)
- Backed by the standalone `channel_prompt_overrides` table; `ChannelPromptRepository` invalidates the entry after each successful write/delete (`invalidateChannelPromptCache`). Mirrors the per-channel LLM override cache (`channelLlmCache.ts`).

### 15) Persona sprite cache (`personaSpriteCache.ts`)

- **Scope:** per `persona_id`
- **Value:** ordered `persona_sprites` rows used by prompt context and render-modifier resolution
- Default TTL: `PERSONA_SPRITE_CACHE_TTL_MINUTES` (falls back to `TOMORI_STATE_CACHE_TTL_MINUTES`, default 10)
- Backed by `persona_sprites`; `PersonaSpriteRepository` invalidates after successful add/replace/delete.
- Related operational limits:
  - `PERSONA_SPRITE_MAX_PER_PERSONA` (default 50)
  - `PERSONA_SPRITE_MAX_INSTRUCTIONS_LENGTH` (default 300, DB maximum 1000)
  - `PERSONA_SPRITE_PROMPT_MAX_COUNT` (default 20)

### 15b) Persona sprite message cache (`personaSpriteMessageCache.ts`)

- **Scope:** per Discord `message_disc_id`
- **Value:** the `persona_sprite_messages` mapping row, or `null` (negative entry) when the
  message has no sprite mapping — most persona webhook messages are plain sends, so caching
  the miss avoids re-querying them every turn
- Entries are **immutable** (a sent message's sprite never changes), so the cache needs no
  invalidation; the TTL only bounds memory (`PERSONA_SPRITE_MESSAGE_CACHE_TTL_MINUTES`, default 120)
- Context builds prime it with one batched query (`primePersonaSpriteMessageRecords`) over the
  fetched history window's webhook message IDs; sends seed it directly (`recordPersonaSpriteMessage`)
- On transient DB errors the prime/lookup skips seeding instead of negative-caching, so real
  sprite messages are not masked for the TTL duration
- DB retention pruning (`PERSONA_SPRITE_MESSAGE_RETENTION_DAYS`, default 30) piggybacks on the
  write path, gated to run at most once per few hours

### 16) Persona picker avatar session cache (transient, in `utils/discord/ui/personaPagination.ts`)

Unlike the caches above, this one is **not** stored in `src/utils/cache/`. It is an ephemeral
`Map<number, AvatarCacheEntry>` created per command invocation and discarded when the command finishes.

- **Scope:** one picker session (one slash command invocation)
- **Key:** absolute persona index within the `personas` array passed to `replyPaginatedPersonaChoicesV2`
- **Value:** `{ type: "url"; url: string }` for public/fallback URLs, or `{ type: "buffer"; buffer: Buffer }` for local-disk avatars that must be attached to the Discord message
- **Purpose:** avatar images (especially local-disk reads) are resolved once on the first page visit and reused on all subsequent page turns and loop re-entries. Without this cache, every page navigation and every retry after a failed transaction re-reads the same files from disk.
- **Usage in commands:** declare `const avatarSessionCache: AvatarSessionCache = new Map()` before the outer `while (true)` loop and pass it as `avatarSessionCache` in `replyPaginatedPersonaChoicesV2` options. The helper uses `options.avatarSessionCache ?? new Map()` so callers that omit it still work correctly.

```ts
import { type AvatarSessionCache, replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";

const avatarSessionCache: AvatarSessionCache = new Map();
while (true) {
  const result = await replyPaginatedPersonaChoicesV2(interaction, locale, {
    personas: allPersonas,
    avatarSessionCache,
    // ...
  });
  // ...
}
```

## Cache Invalidation Rules (Critical)

Invalidate after successful DB writes that affect cached reads.

Repository methods are the preferred owner for DB-write invalidation. During the Phase 2 repository migration, caller-side invalidation should only be removed after the corresponding repository method performs the same invalidation after a successful write. The migration audit lives at [`../refactor/phase4-cache-audit.md`](../refactor/phase4-cache-audit).

Common examples:

- server/persona/config changes -> `invalidateTomoriStateCache(serverDiscId)`
- user preference/memory changes -> `invalidateUserCache(userDiscId)`
- blacklist toggles -> `invalidateUserBlacklistCache(serverDiscId, userDiscId)`
- whitelist/inherited cooldown override changes -> `invalidateWhitelistCache(serverDiscId, channelDiscId?)`
- emoji/sticker update events -> `invalidateEmojiStickerCache(serverId)`
- persona webhook/avatar changes -> webhook invalidation helpers
- channel system prompt changes -> `invalidateChannelPromptCache(serverId, channelDiscId)` (handled inside `ChannelPromptRepository`)
- persona sprite changes -> `invalidatePersonaSpriteCache(personaId)` (handled inside `PersonaSpriteRepository`)

## Emergency Memory Cleanup

When `memoryGuard` enters critical emergency mode, the memory monitor runs
`clearEmergencyCaches()` before forced GC. This clears recoverable DB/API-backed
caches plus volatile Discord.js message/user/presence/voice-state caches. Short-term
memory is preserved by default; only expired STM entries are swept.

Default emergency behavior:

- Clears: Tomori state, user, whitelist, channel LLM, emoji/sticker, guild MCP,
  personal spotlight, ST preset, webhook, webhook identity, NovelAI subscription,
  OpenRouter on-demand capability, preset avatar, voice transcript, markdown table,
  and volatile Discord.js message/bot-user/presence/voice-state caches.
- Preserves: non-expired short-term memory, static LLM model cache, static provider
  capability maps, command registries, MCP connections, active channel locks, and
  other runtime coordination state.
- Emits `log.metric("emergency_cache_clear", ...)` with total and per-cache
  cleared counts plus pre/post process memory (`rss`, `heapUsed`, `external`,
  `arrayBuffers`), and `log.metric("memory_emergency_entered", ...)` so
  CloudWatch/Grafana can correlate cache eviction with RSS pressure.

Operational knobs:

```dotenv
EMERGENCY_CACHE_CLEAR_ENABLED=true
EMERGENCY_CACHE_CLEAR_INCLUDE_STM=false
EMERGENCY_CACHE_CLEAR_DISCORD_VOLATILE=true
EMERGENCY_COOLDOWN_MS=60000
```

`EMERGENCY_CACHE_CLEAR_INCLUDE_STM=true` should be treated as a last-resort setting
because STM is conversational state, not merely a database read-through cache.

## Anti-Patterns to Avoid

- Invalidating before write success
- Forgetting invalidation on alternate code paths
- Manually mutating cached objects instead of invalidating
- Clearing whole caches when only one key changed

## Recommended Env Knobs

```dotenv
TOMORI_STATE_CACHE_TTL_MINUTES=10
USER_CACHE_TTL_MINUTES=30
EMOJI_STICKER_CACHE_TTL_MINUTES=10
CHANNEL_WHITELIST_CACHE_TTL_MINUTES=5
PERSONA_SPRITE_CACHE_TTL_MINUTES=10
PERSONA_SPRITE_MAX_PER_PERSONA=50
PERSONA_SPRITE_MAX_INSTRUCTIONS_LENGTH=300
PERSONA_SPRITE_PROMPT_MAX_COUNT=20
PERSONA_SPRITE_MESSAGE_CACHE_TTL_MINUTES=120
PERSONA_SPRITE_MESSAGE_RETENTION_DAYS=30
EMERGENCY_CACHE_CLEAR_ENABLED=true
EMERGENCY_CACHE_CLEAR_INCLUDE_STM=false
EMERGENCY_CACHE_CLEAR_DISCORD_VOLATILE=true
SHORT_TERM_MEMORY_TTL_HOURS=2
SHORT_TERM_MEMORY_SUMMARY_TTL_HOURS=4
SHORT_TERM_MEMORY_MAX_SUMMARY_LENGTH=500
SHORT_TERM_MEMORY_MIN_MESSAGES_FOR_SUMMARY=6
SHORT_TERM_MEMORY_MAX_MESSAGES_PER_CHANNEL=10
SHORT_TERM_MEMORY_MAX_OTHER_CHANNELS=3
```

## Practical Rule

If a code path writes DB state that a cache reads, keep the invalidation call in the same function directly after the write.
