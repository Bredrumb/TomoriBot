<!-- ARCH-ALIGNMENT: prereq-phase-5.5d -->

# STM Stage 01 — `writeShortTermMemory` → `storeShortTermMemory`

Captures the completed conversation turn into the in-process short-term
memory cache immediately after generation finishes.

**Files:**
- `writeShortTermMemory` (module-private) — `src/utils/chat/postTurnEffects.ts:129-181`
- `storeShortTermMemory` — `src/utils/cache/shortTermMemoryCache.ts:317-378`

## Mission

After every successful generation turn, `runPostTurnEffects` calls
`writeShortTermMemory`, which assembles a slice of the conversation history
and stores it so the context-build pipeline can surface it on the next turn
as cross-channel or cross-persona awareness.

The function takes the `simplifiedMessages` already built by the context
pipeline (up to the last 10 user/persona entries), appends the new persona
responses from this turn, and writes the combined slice into the STM cache.
A separate write is issued for each unique responding `personaId` so that
personas with distinct IDs each maintain their own conversational continuity.

`storeShortTermMemory` writes two entries per call:

1. **User-scoped key** (`shortterm:user:userId:channelId[:personaId]`) —
   enables the STM reader to scope retrieval to a specific user's history
   across all channels.
2. **Server-scoped key** (`shortterm:server:serverId:channelId[:personaId]`)
   — enables the STM reader to retrieve server-shared history visible to all
   users in the same channel. Skipped for DM sessions (`serverId === "DM"`).

Any existing `summary` field from a prior `update_short_term_memory` call is
preserved — `storeShortTermMemory` carries forward `existing?.summary` when
constructing the new entry.

## Input

- `context: ChatTurnContext` — provides `simplifiedMessages`, `userDiscId`,
  `channel.id`, `serverDiscId`, `serverName`, `channelName`, `isDMChannel`,
  and `turn.requestSnapshot.triggererPrivacyLevel`.
- `result: GenerationTurnResult` — provides `personaResponses[]` (each entry
  has `text`, `personaId`, `personaLineageId`, `personaName`).

## Output

`Promise<void>` — no return value. The cache is updated as a side effect.

## Side effects

- **STM cache entries written** — two `Map` entries (user + server) per unique
  persona ID in `result.personaResponses`. In DM sessions, one entry only
  (user-scoped).
- **`stats.stores`** — incremented once per `storeMemoryEntry` call (internal
  to the cache module).

## Invariants

After this stage runs for a non-empty, non-stop generation result:

- The STM cache contains an entry for `(userDiscId, channelId, personaId)` —
  reflecting up to the last 10 messages from this turn.
- If a summary existed in a prior entry for this key, it is preserved in the
  new entry.
- The `lastUpdated` timestamp on the entry is set to `Date.now()` at write
  time.

## Skip conditions

`writeShortTermMemory` returns early (no write) when any of the following hold:

| Condition | Field checked |
|---|---|
| Turn was a stop-response | `context.isStopResponse` |
| No conversation history built this turn | `context.simplifiedMessages.length === 0` |
| Triggerer has `PrivacyLevel.FULL` | `context.turn.requestSnapshot.triggererPrivacyLevel` |
| No persona responded (empty result) | `result.personaResponses.length === 0` |

## Extension points

| Surface | Plugin-relevance |
|---|---|
| `storeShortTermMemory()` | **A plugin extending channel-memory tagging or cross-server STM scoping would extend here.** The function signature accepts `personaId` and `personaLineageId` for scoping — new scope dimensions (e.g., thread lineage) would be added as additional parameters. → plugin plan candidate |
| TTL constants (`SHORT_TERM_MEMORY_TTL_HOURS`, `SHORT_TERM_MEMORY_MAX_MESSAGES_PER_CHANNEL`) | Env-var configurable. Not a plugin seam — operational tuning only. |
| Message slice logic (`simplifiedMessages.slice(-10)`) | Internal — `MAX_MESSAGES_PER_CHANNEL` is the env-var control surface. |

## Configuration

| Source | Key / Env var | Default | Purpose |
|---|---|---|---|
| Env var | `SHORT_TERM_MEMORY_TTL_HOURS` | `12` | Crude conversation TTL (hours) |
| Env var | `SHORT_TERM_MEMORY_MAX_MESSAGES_PER_CHANNEL` | `10` | Max messages stored per channel entry |

## Related docs

- This stage's output is consumed by: → [context-build STM stage](../../../context-build/02-native-assembly/04-stm-memories.md)
- STM summary upgrade that replaces the crude messages written here: → [`stm/02-summary-upgrade.md`](02-summary-upgrade.md)
- Post-turn effects that call this stage: → [chat per-turn Stage 04](../../../chat/06-per-turn/04-post-turn-effects.md)
- `ShortTermMemoryEntry` type: `src/utils/cache/shortTermMemoryCache.ts:37`
