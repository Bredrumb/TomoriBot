# 15. Expression Handling (Emojis & Stickers)

## Overview

TomoriBot features a sophisticated expression handling system that allows the bot to intelligently use Discord custom emojis and stickers in responses. The system includes:

- **Lazy synchronization** from Discord API to database (24-hour cache)
- **Automatic emoji conversion** from `:name:` format to `<:name:id>` Discord format
- **LLM-generated metadata** (descriptions and emotion keys for context)
- **Event-driven updates** when emojis/stickers are created/modified/deleted
- **Optimized database queries** to minimize redundant loads

---

## Architecture

### Data Flow

```
Discord API
    ↓ (fetch on cache miss)
Lazy Sync System
    ↓ (sync to DB)
PostgreSQL Database
    ↓ (load once per request)
In-Memory Cache (per request)
    ↓ (used by)
├─ LLM Context Builder (shows available expressions)
└─ Stream Orchestrator (converts :name: → <:name:id>)
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Lazy Emoji Sync** | `src/utils/cache/emojiLazySync.ts` | Syncs emojis from Discord to DB only when needed |
| **Lazy Sticker Sync** | `src/utils/cache/stickerLazySync.ts` | Syncs stickers from Discord to DB only when needed |
| **Emoji Event Handler** | `src/events/guildEmojisUpdate/refreshEmojis.ts` | Handles emoji create/update/delete events |
| **Sticker Event Handler** | `src/events/guildStickersUpdate/refreshStickers.ts` | Handles sticker create/update/delete events |
| **Context Builder** | `src/utils/text/contextBuilder.ts` | Adds emoji/sticker metadata to LLM prompts |
| **String Helper** | `src/utils/text/stringHelper.ts` | Converts `:name:` → `<:name:id>` format |
| **DB Read** | `src/utils/db/dbRead.ts` | Loads emojis/stickers from database |

---

## Database Schema

### `server_emojis` Table

Stores Discord emoji metadata with LLM-generated descriptions.

```sql
CREATE TABLE server_emojis (
    server_emoji_id SERIAL PRIMARY KEY,
    server_id INTEGER NOT NULL REFERENCES servers(server_id) ON DELETE CASCADE,
    emoji_disc_id TEXT NOT NULL,          -- Discord snowflake ID
    emoji_name TEXT NOT NULL,              -- Emoji name (e.g., "PepeSadge")
    emoji_desc TEXT DEFAULT '',            -- LLM-generated description
    emotion_key TEXT DEFAULT 'unset',      -- Emotion category (happy, sad, angry, etc.)
    is_animated BOOLEAN DEFAULT FALSE,     -- Whether emoji is animated
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, emoji_disc_id)
);
```

### `server_stickers` Table

Stores Discord sticker metadata with LLM-generated descriptions.

```sql
CREATE TABLE server_stickers (
    server_sticker_id SERIAL PRIMARY KEY,
    server_id INTEGER NOT NULL REFERENCES servers(server_id) ON DELETE CASCADE,
    sticker_disc_id TEXT NOT NULL,         -- Discord snowflake ID
    sticker_name TEXT NOT NULL,             -- Sticker name
    sticker_desc TEXT DEFAULT '',           -- LLM-generated description
    emotion_key TEXT DEFAULT 'unset',       -- Emotion category
    sticker_format INTEGER NOT NULL,        -- Discord StickerFormatType enum
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, sticker_disc_id)
);
```

---

## Lazy Sync System

### How It Works

The lazy sync system avoids expensive Discord API calls by implementing a **24-hour cache** using database timestamps.

**Sync Triggers:**
1. **First message** in a new server (cache empty)
2. **Cache expiration** (>24 hours since last sync)
3. **Count mismatch** (Discord has 50 emojis, DB has 1)
4. **Manual force sync** (via parameter)

### Sync Flow

```typescript
// tomoriChat.ts - triggered on every message
if (tomoriState.config.emoji_usage_enabled && guild) {
    await lazySyncGuildEmojis(guild, tomoriState.server_id);
    await lazySyncGuildStickers(guild, tomoriState.server_id);
}
```

**Inside `lazySyncGuildEmojis()`:**

```typescript
// 1. Check cache freshness
const [lastSync] = await sql`
    SELECT MAX(updated_at) as last_updated, COUNT(*) as emoji_count
    FROM server_emojis WHERE server_id = ${serverId}
`;

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const cacheIsFresh = lastSync &&
    (now - lastSync.last_updated < CACHE_DURATION_MS);

if (cacheIsFresh) {
    return false; // Skip sync, use DB cache
}

// 2. Fetch from Discord API
await guild.emojis.fetch();
const currentEmojis = Array.from(guild.emojis.cache.values());

// 3. Sync to database (see below)
```

### Database Sync Strategy

**Original (Broken):**
```typescript
// ❌ Postgres.js bulk syntax bug - only inserted 1 emoji!
await tx`
    INSERT INTO server_emojis
    ${tx(emojiValues, "server_id", "emoji_disc_id", ...)}
`;
```

**Fixed (Loop-based):**
```typescript
// ✅ Individual inserts - all 50 emojis inserted successfully
for (const emoji of emojiValues) {
    await tx`
        INSERT INTO server_emojis (server_id, emoji_disc_id, emoji_name, emoji_desc, emotion_key, is_animated)
        VALUES (${emoji.server_id}, ${emoji.emoji_disc_id}, ...)
        ON CONFLICT (server_id, emoji_disc_id) DO UPDATE SET
            emoji_name = EXCLUDED.emoji_name,
            updated_at = CURRENT_TIMESTAMP
    `;
}
```

**Performance Impact:**
- 50 individual INSERTs take ~50ms total (within transaction)
- Only happens once per 24 hours (or on cache miss)
- User-facing impact: **negligible**

---

## Event-Driven Updates

### Emoji/Sticker Change Events

When a user creates, updates, or deletes an emoji/sticker, Discord fires events that trigger immediate re-sync:

**Event Mapping:**
```typescript
// src/handlers/eventHandler.ts
client.on('emojiCreate', ...handlers);  → guildEmojisUpdate/refreshEmojis.ts
client.on('emojiUpdate', ...handlers);  → guildEmojisUpdate/refreshEmojis.ts
client.on('emojiDelete', ...handlers);  → guildEmojisUpdate/refreshEmojis.ts

client.on('stickerCreate', ...handlers);  → guildStickersUpdate/refreshStickers.ts
client.on('stickerUpdate', ...handlers);  → guildStickersUpdate/refreshStickers.ts
client.on('stickerDelete', ...handlers);  → guildStickersUpdate/refreshStickers.ts
```

**Event Handler Flow:**
1. Discord fires event (e.g., user renames `:Pepega:` to `:Pepega2:`)
2. Event handler fetches fresh emoji list from Discord
3. Syncs all emojis to database (preserves existing metadata)
4. Deletes stale emojis no longer in Discord

---

## Emoji Conversion

### Format Transformation

TomoriBot converts LLM-generated emoji syntax to Discord's required format:

**Input (LLM response):**
```
Ellen: hey! :PepeSadge: that's tough :CatVibe:
```

**Output (Discord message):**
```
Ellen: hey! <:PepeSadge:1382568794408357949> that's tough <:CatVibe:1382568747600183346>
```

### Implementation

**Location:** `src/utils/text/stringHelper.ts` → `cleanLLMOutput()`

```typescript
export function cleanLLMOutput(
    text: string,
    botName?: string,
    emojiStrings?: string[],  // Array of "<:name:id>" strings
    emojiUsageEnabled = true,
) {
    // ... other cleaning ...

    // Build emoji name → Discord format map
    const emojiMap = new Map<string, string>();
    for (const emojiStr of emojiStrings || []) {
        const match = emojiStr.match(/^<(a?):([^:]+):(\d+)>$/);
        if (match) {
            const [, isAnimated, name, id] = match;
            emojiMap.set(name.toLowerCase(), emojiStr);
        }
    }

    // Replace :name: with <:name:id>
    cleanedText = cleanedText.replace(
        /:([a-zA-Z0-9_]+):/g,
        (match, name) => emojiMap.get(name.toLowerCase()) || match
    );

    return cleanedText;
}
```

---

## LLM Context Integration

### Providing Expression Metadata to LLM

Emoji and sticker metadata is included in the system prompt to help the LLM choose appropriate expressions:

**Context Structure:**
```typescript
// src/utils/text/contextBuilder.ts

// Emoji context item
{
    tag: ContextItemTag.EMOJI_METADATA,
    content: `
        Available Custom Emojis (use format :name:):
        - :fajita: (neutral) - A blonde plush toy with a subtle smile
        - :PepeSadge: (sad) - Sad Pepe emote expressing disappointment
        - :CatVibe: (happy) - Animated cat vibing to music
        ...
    `
}

// Sticker context item
{
    tag: ContextItemTag.STICKER_METADATA,
    content: `
        Available Custom Stickers (mention by name):
        - EllenWave (happy) - Ellen waving hello
        - TomoriSad (sad) - Tomori looking disappointed
        ...
    `
}
```

**Metadata Generation:**

Use `/server initialize expressions` command to generate descriptions and emotion keys using vision-capable LLMs.

---

## Optimization: Query Reduction

### Problem Identified

**Before Optimization:**
```typescript
// tomoriChat.ts - Load emojis for emoji conversion
const emojis = await loadServerEmojis(serverId);  // Query #1

// contextBuilder.ts - Load emojis AGAIN for LLM context
const emojiMetadata = await sql`
    SELECT * FROM server_emojis WHERE server_id = ${serverId}
`;  // Query #2 - DUPLICATE!
```

**Result:** 2 identical queries per message

### Solution Implemented

**After Optimization:**
```typescript
// tomoriChat.ts - Load once
const loadedEmojis = await loadServerEmojis(serverId);
const loadedStickers = await loadServerStickers(serverId);

// Pass to buildContext
await buildContext({
    ...
    preloadedEmojis: loadedEmojis,      // ← No redundant query
    preloadedStickers: loadedStickers,  // ← No redundant query
});

// contextBuilder.ts - Use passed data
const emojiMetadata = (preloadedEmojis && preloadedEmojis.length > 0)
    ? preloadedEmojis  // ← Use passed data
    : await sql`SELECT ...`;  // ← Fallback to query if not provided
```

**Performance Gain:**
- **Before:** 5 queries per message
- **After:** 3 queries per message (-40% redundant queries)
- **Savings:** ~2 DB round-trips per message

---

## Performance Characteristics

### Query Breakdown

**First message in new server:**
```
Lazy sync emojis:
  - 1 SELECT (check cache) +
  - 1 SELECT (load existing metadata) +
  - 50 INSERT (individual upserts) +
  - 1 SELECT (find stale emojis) +
  - 1 SELECT (verify sync) = ~54 queries

Lazy sync stickers:
  - ~10 queries (5 stickers)

Load for context:
  - 0 queries (uses passed data)

Total: ~64 queries (one-time cost)
```

**Subsequent messages (cache fresh):**
```
Lazy sync check:
  - 1 SELECT (emoji cache check)
  - 1 SELECT (sticker cache check)

Load for conversion + context:
  - 1 SELECT (emojis)
  - 1 SELECT (stickers)

Total: 4 queries per message
```

**Frequency:**
- Full sync: Once per 24 hours per server
- Cache check: Every message (2 queries)
- Data load: Every message (2 queries)

---

## Configuration

### Feature Flags

**Per-server toggles:**

```typescript
// tomori_configs table
emoji_usage_enabled: boolean    // Default: true
sticker_usage_enabled: boolean  // Default: false
```

**Disable expressions:**
```sql
UPDATE tomori_configs
SET emoji_usage_enabled = false
WHERE server_id = 2;
```

### Rate Limiting

**Emoji repetition penalty:** `src/utils/text/emojiPenalty.ts`

Prevents the bot from overusing emojis by tracking recent usage and applying context penalties.

---

## Command: Expression Initialization

### `/server initialize expressions`

Generates descriptions and emotion keys for all emojis/stickers using vision-capable LLMs.

**Requirements:**
- Model must support `sees_images=true` and `supports_structoutput=true`
- Supported providers: Google (Gemini), OpenRouter (vision models)

**Process:**
1. Fetches all emojis/stickers from Discord
2. Downloads PNG images from Discord CDN
3. Sends images to LLM with structured output schema
4. Updates database with generated metadata

**Output:**
```json
{
  "classifications": [
    {
      "name": "PepeSadge",
      "emotion_key": "sad",
      "description": "Sad Pepe the Frog with tears, expressing disappointment"
    }
  ]
}
```

---

## Troubleshooting

### Emojis Not Converting

**Symptoms:**
- `:PepeSadge:` appears as-is instead of `<:PepeSadge:ID>`

**Diagnosis:**
```sql
-- Check if emojis are in database
SELECT emoji_name, emoji_disc_id
FROM server_emojis
WHERE server_id = 2;

-- Should return 50 rows (if guild has 50 emojis)
```

**Fixes:**
1. **Force refresh:** Change any emoji name to trigger event handler
2. **Check logs:** Look for `[Emoji Lazy Sync]` errors
3. **Verify feature flag:** `emoji_usage_enabled = true`

### Postgres.js Bulk Syntax Bug

**If you see only 1 emoji syncing despite logs showing 50:**

This was a bug we fixed where `tx(emojiValues, ...)` syntax only inserted the first row.

**Solution:** Already implemented - we use individual INSERTs in a loop.

### Missing Metadata

**Symptoms:**
- Emojis exist but have `emoji_desc = ''` and `emotion_key = 'unset'`

**Solution:**
Run `/server initialize expressions` to generate metadata using vision LLM.

---

## Best Practices

### For Developers

1. **Never bypass lazy sync** - Always let the cache system decide when to fetch
2. **Preserve metadata** - When syncing, always load existing metadata first
3. **Use transactions** - All sync operations should be atomic
4. **Individual INSERTs** - Don't use `tx(array, ...)` bulk syntax (known bug)
5. **Pass loaded data** - Avoid redundant queries by passing data between functions

### For Server Admins

1. **Initialize expressions early** - Run `/server initialize expressions` after adding emojis
2. **Use descriptive names** - Emoji names help the LLM choose appropriately
3. **Moderate emoji count** - Performance degrades with >100 emojis per server
4. **Monitor logs** - Check for sync errors in production

---

## Future Optimizations

### In-Memory Request Cache

**Current:** Every message loads emojis from DB (4 queries)

**Proposed:** Cache emoji data in memory for 5 minutes
```typescript
const emojiCache = new Map<number, { data: EmojiRow[], timestamp: number }>();

// First message: DB query
// Next 99 messages (5 min): Memory cache
// Savings: ~400 queries per 100 messages (-80%)
```

**Trade-offs:**
- ✅ Massive query reduction
- ✅ Lower database load
- ❌ Stale data if emoji changes
- ❌ Memory usage per server

### Bulk Insert Fix

**Current:** 50 individual INSERTs (~50ms)

**Proposed:** Fix Postgres.js or use native PostgreSQL COPY
```sql
COPY server_emojis (server_id, emoji_disc_id, ...)
FROM STDIN;
```

**Trade-offs:**
- ✅ Single query instead of 50
- ✅ ~10x faster sync
- ❌ More complex implementation
- ❌ Rare operation (once per 24hr) - low ROI

---

## Related Documentation

- **[5. Database Schema](5_DatabaseSchema.md)** - Full schema reference
- **[6. Event System](6_EventSystem.md)** - Event handler architecture
- **[8. AI Providers](8_AIProviders.md)** - LLM integration for metadata generation
- **[11. Utils](11_Utils.md)** - String helper utilities

---

## Summary

TomoriBot's expression handling system provides:

✅ **Automatic Discord emoji/sticker syncing** with 24-hour cache
✅ **Intelligent emoji conversion** from `:name:` to `<:name:id>` format
✅ **LLM-generated metadata** for context-aware expression usage
✅ **Event-driven updates** when expressions change
✅ **Optimized queries** to minimize database load

The system balances **functionality** (100% emoji conversion success) with **efficiency** (minimal DB queries and API calls), ensuring responsive bot performance even in servers with many custom expressions.
