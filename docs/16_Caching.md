# 16. In-Memory Caching System

This document describes TomoriBot's in-memory caching system, which reduces database queries by 60-70% through TTL-based caching with event-driven invalidation.

## Table of Contents

- [Overview](#overview)
- [Why Caching?](#why-caching)
- [Cache Types](#cache-types)
  - [TomoriState Cache](#tomoristate-cache)
  - [User Cache](#user-cache)
  - [Emoji/Sticker Cache](#emojisticker-cache)
- [Configuration](#configuration)
- [Cache Invalidation](#cache-invalidation)
- [Adding Cache Support to New Code](#adding-cache-support-to-new-code)
- [Monitoring and Debugging](#monitoring-and-debugging)
- [Architecture Decisions](#architecture-decisions)

---

## Overview

TomoriBot uses a TTL (Time-To-Live) based in-memory caching system to reduce database load. The system follows these principles:

1. **Read-through caching**: Cache miss triggers DB query, result is cached
2. **Event-driven invalidation**: Commands that modify data invalidate relevant caches
3. **Graceful fallback**: On DB errors, stale cache is returned if available
4. **Configurable TTLs**: Cache durations can be tuned via environment variables

## Why Caching?

### The Problem

Before caching, every message triggered multiple database queries:

| Component | Queries per Message |
|-----------|---------------------|
| TomoriState (server config) | 3-4 queries |
| User data (author) | 2-3 queries |
| User data (per mention) | 2-3 queries × N |
| Emoji/Sticker lists | 2-4 queries |
| **Total** | **10-15+ queries** |

With high message volume, this resulted in excessive database costs.

### The Solution

Caching reduces this to **0-1 queries** for most messages:

| Scenario | Queries |
|----------|---------|
| All caches hit | 0 |
| TomoriState miss only | 3-4 |
| User cache miss only | 2-3 |
| First message after config change | Same as before (then cached) |

**Expected hit rate**: 60-70%+ in normal usage patterns.

---

## Cache Types

### TomoriState Cache

**Location**: `src/utils/cache/tomoriStateCache.ts`

**What it caches**: Complete server configuration loaded by `loadTomoriState()`.

| Data | Source Table |
|------|--------------|
| Bot personality, nickname, attributes | `tomoris` |
| API keys, temperature, permissions, triggers | `tomori_configs` |
| Model provider, codename, capabilities | `llms` |
| Server-wide learned facts | `server_memories` |

**Cache structure**:
```typescript
Map<serverDiscId, {
  state: TomoriState,  // Full bot config object
  cachedAt: number     // Timestamp for TTL check
}>
```

**Default TTL**: 10 minutes

**Key functions**:
```typescript
import {
  getCachedTomoriState,
  invalidateTomoriStateCache
} from "@/utils/cache/tomoriStateCache";

// Read (auto-caches on miss)
const state = await getCachedTomoriState(serverDiscId);

// Invalidate after DB write
invalidateTomoriStateCache(serverDiscId);
```

---

### User Cache

**Location**: `src/utils/cache/userCache.ts`

**What it caches**: User preferences and per-server blacklist status.

| Data | Source Table |
|------|--------------|
| Nickname, language, personal memories | `users` |
| Privacy level | `users` |
| Blacklist status (per server) | `personalization_blacklist` |

**Cache structure**:
```typescript
Map<userDiscId, {
  userRow: UserRow | null,
  privacyLevel: PrivacyLevel,
  blacklistStatus: Map<serverDiscId, boolean>,  // Lazy-loaded per server
  cachedAt: number
}>
```

**Default TTL**: 30 minutes

**Key functions**:
```typescript
import {
  getCachedUserRow,
  getCachedPrivacyLevel,
  getCachedBlacklistStatus,
  invalidateUserCache,
  invalidateUserBlacklistCache
} from "@/utils/cache/userCache";

// Read functions (auto-cache on miss)
const user = await getCachedUserRow(userDiscId);
const privacy = await getCachedPrivacyLevel(userDiscId);
const isBlacklisted = await getCachedBlacklistStatus(serverDiscId, userDiscId);

// Invalidate after user data change
invalidateUserCache(userDiscId);

// Invalidate only blacklist (more granular)
invalidateUserBlacklistCache(serverDiscId, userDiscId);
```

---

### Emoji/Sticker Cache

**Location**: `src/utils/cache/emojiStickerCache.ts`

**What it caches**: Server emoji and sticker lists for expression handling.

**Default TTL**: 10 minutes

**Key functions**:
```typescript
import {
  getCachedEmojiStickerData,
  invalidateEmojiStickerCache
} from "@/utils/cache/emojiStickerCache";
```

---

## Configuration

All cache TTLs are configurable via environment variables:

```bash
# .env or .env.local

# TomoriState cache: server config, personality, memories
TOMORI_STATE_CACHE_TTL_MINUTES=10

# User cache: user preferences, privacy level, personal memories
USER_CACHE_TTL_MINUTES=30

# Emoji/Sticker cache: server emoji and sticker lists
EMOJI_STICKER_CACHE_TTL_MINUTES=10
```

### Tuning Guidelines

| Scenario | Recommended TTL |
|----------|-----------------|
| High-traffic servers | Lower (5-10 min) for fresher data |
| Low-traffic servers | Higher (30-60 min) to reduce DB load |
| Development/testing | Very low (1-2 min) for quick feedback |
| Config changes not reflecting | Check invalidation is working, or lower TTL |

---

## Cache Invalidation

### When to Invalidate

Caches must be invalidated **after successful database writes** that modify cached data.

| Action | Cache to Invalidate | Function |
|--------|---------------------|----------|
| `/config *` commands | TomoriState | `invalidateTomoriStateCache(serverDiscId)` |
| `/teach *` commands | TomoriState | `invalidateTomoriStateCache(serverDiscId)` |
| `/forget *` commands | TomoriState | `invalidateTomoriStateCache(serverDiscId)` |
| `/persona default` | TomoriState | `invalidateTomoriStateCache(serverDiscId)` |
| `/server trigger *` | TomoriState | `invalidateTomoriStateCache(serverDiscId)` |
| `/personal *` commands | User cache | `invalidateUserCache(userDiscId)` |
| `/server blacklist` | Blacklist only | `invalidateUserBlacklistCache(serverId, userId)` |
| `remember_this_fact` tool (server) | TomoriState | `invalidateTomoriStateCache(serverDiscId)` |
| `remember_this_fact` tool (user) | User cache | `invalidateUserCache(targetUserDiscId)` |

### Invalidation Pattern

```typescript
// 1. Perform database write
await sql`UPDATE tomori_configs SET ... WHERE ...`;

// 2. Invalidate cache BEFORE success response
invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

// 3. Send success response
await replyInfoEmbed(interaction, locale, { ... });
```

**Important**: Always invalidate **after** the DB write succeeds but **before** the success message. This ensures the next message sees fresh data.

---

## Adding Cache Support to New Code

### For New Commands That Modify TomoriState

1. **Add import**:
```typescript
import {
  getCachedTomoriState,
  invalidateTomoriStateCache
} from "@/utils/cache/tomoriStateCache";
// Path varies by directory depth: ../../, ../../../, etc.
```

2. **Replace `loadTomoriState` calls**:
```typescript
// Before
const tomoriState = await loadTomoriState(serverId);

// After
const tomoriState = await getCachedTomoriState(serverId);
```

3. **Add invalidation before success message**:
```typescript
// After DB write, before success response
invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);
```

### For New Commands That Modify User Data

1. **Add import**:
```typescript
import { invalidateUserCache } from "@/utils/cache/userCache";
```

2. **Add invalidation after DB write**:
```typescript
// For user preference changes
invalidateUserCache(interaction.user.id);

// For blacklist changes
invalidateUserBlacklistCache(serverDiscId, targetUserDiscId);
```

### For New Tools That Modify Data

Tools (function calls) that write to the database also need invalidation. See `memoryTool.ts` for an example:

```typescript
// After successful server memory save
invalidateTomoriStateCache(serverId);

// After successful personal memory save
invalidateUserCache(targetUserDiscordIdArg);
```

---

## Monitoring and Debugging

### Log Messages

The cache system logs all operations. Look for these patterns:

```
[TomoriState Cache] MISS for server 123456789 - loading from DB
[TomoriState Cache] Cached state for server 123456789 (tomori: BotName)
[TomoriState Cache] HIT for server 123456789 (age: 45s)
[TomoriState Cache] STALE for server 123456789 (age: 605s)
[TomoriState Cache] Invalidated cache for server 123456789

[User Cache] MISS for user 987654321 - loading from DB
[User Cache] Cached user 987654321 (nickname: UserName, privacy: 0)
[User Cache] HIT for user 987654321 (age: 120s)
[User Cache] Blacklist MISS for user 987654321 in server 123456789
[User Cache] Invalidated cache for user 987654321
```

### Cache Statistics

Each cache tracks hit/miss statistics:

```typescript
import { getTomoriStateCacheStats } from "@/utils/cache/tomoriStateCache";
import { getUserCacheStats } from "@/utils/cache/userCache";

const tomoriStats = getTomoriStateCacheStats();
// { hits: 150, misses: 23, hitRate: "86.71%", cacheSize: 5 }

const userStats = getUserCacheStats();
// { hits: 200, misses: 30, hitRate: "86.96%", cacheSize: 15,
//   blacklistHits: 50, blacklistMisses: 10, blacklistHitRate: "83.33%" }
```

### Troubleshooting

| Symptom | Possible Cause | Solution |
|---------|---------------|----------|
| Config changes not reflecting | Missing invalidation call | Add `invalidateTomoriStateCache()` after DB write |
| Old user data showing | Missing user invalidation | Add `invalidateUserCache()` after DB write |
| High cache miss rate | TTL too low | Increase TTL via env var |
| Stale data persisting | Invalidation not called | Check command/tool has invalidation |
| Memory growth | Cache not clearing | Check `clearCache()` functions exist |

### Manual Cache Clear

For debugging, you can clear caches programmatically:

```typescript
import { clearTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { clearUserCache } from "@/utils/cache/userCache";

clearTomoriStateCache();  // Clears all TomoriState entries
clearUserCache();         // Clears all user entries
```

---

## Architecture Decisions

### Why In-Memory (Not Redis)?

1. **Simplicity**: No additional infrastructure required
2. **Latency**: In-process memory access is faster than network calls
3. **Scale**: Single-instance bot doesn't need distributed cache
4. **Memory**: Estimated ~25MB total (well under container limits)

### Why TTL-Based?

1. **Self-healing**: Stale data eventually refreshes even if invalidation fails
2. **Simplicity**: No complex dependency tracking needed
3. **Predictable**: Easy to reason about cache behavior

### Why Event-Driven Invalidation?

1. **Immediate consistency**: Changes reflect on next message
2. **Targeted**: Only invalidates affected entries, not entire cache
3. **Efficient**: No polling or scheduled refreshes needed

### Trade-offs

| Benefit | Trade-off |
|---------|-----------|
| Reduced DB queries | Slightly stale data possible |
| Lower latency | Memory usage increases |
| Simple implementation | Must remember to invalidate |
| Configurable TTLs | Requires tuning for optimal performance |

---

## Files Reference

| File | Purpose |
|------|---------|
| `src/utils/cache/tomoriStateCache.ts` | TomoriState caching |
| `src/utils/cache/userCache.ts` | User data and blacklist caching |
| `src/utils/cache/emojiStickerCache.ts` | Emoji/sticker list caching |
| `src/events/messageCreate/tomoriChat.ts` | Main consumer of cached data |
| `src/tools/functionCalls/memoryTool.ts` | Tool with cache invalidation |
| `src/commands/config/**/*.ts` | Commands with TomoriState invalidation |
| `src/commands/personal/**/*.ts` | Commands with User cache invalidation |
