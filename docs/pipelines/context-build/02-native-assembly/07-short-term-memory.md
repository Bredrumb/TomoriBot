---
title: "02.7: Short-Term Memory"
---

Recent conversation snippets from the DB-backed STM cache, plus tool-hint
emission (nudges) for the LLM to create and maintain short-term memory.

**File:** `src/utils/text/context/memories.ts:190-530`

## Mission

Surface two kinds of short-term memory to the LLM:

1. **Other-channel memories** — recent conversation summaries (or category
   blocks) from other channels in the same server (or cross-server if the
   user opted in).
2. **Same-channel memory** — the running summary or category block for the
   current channel (if one exists), plus an explicit tool-usage hint
   (update-nudge) for the `update_short_term_memory` tool, gated by the
   cadence counter.

The contributor *also* emits a lower-priority tail directive
(`createPromptText`) when no same-channel summary/categories exist yet but
the conversation has accumulated enough crude messages — telling the LLM to
*create* a short-term memory after responding. The create-nudge is **not**
cadence-gated.

## Categories

Servers can configure up to `STM_MAX_CATEGORIES` (default 5) categories via
`/server stm categories-edit`. Each category has a `label`, `description`,
and `position`. The tool schema dynamically builds one string property per
category slug.

When only the default `summary` category exists, the system operates in
**single-summary fallback mode** — identical to pre-category behavior.

When additional categories are present, the system enters **category mode**.
Category-mode nudges support the `{category_labels}` placeholder, which is
replaced with the comma-separated list of configured labels.

## Render modes

Two render modes control how same-channel and other-channel memories are
presented in context:

| Mode | Key | Behavior |
|---|---|---|
| Supersede (default) | `supersede` | When a summary/categories exist, crude messages for that channel are replaced entirely by the summary/category block. |
| Crude + Summary | `crude_summary` | Crude messages are always shown AND the summary/category block is appended additively alongside them. |

The render mode is set per-server via `/server stm parameters` and stored in
`server_stm_configs.render_mode`.

## Cadence gating

A `turnsSinceRefresh` counter on each live STM row tracks
bot-participation cycles (not raw inbound messages). The counter is
incremented by `incrementStmTurnCounter()` in post-turn effects after each
STM write.

- **Update-nudge** — only fires when
  `turnsSinceRefresh >= refreshCadence` (from `stmConfig`, default `1`).
  This prevents the LLM from being nudged to update STM every single turn
  when the cadence is set higher.
- **Create-nudge** — is **not** cadence-gated. It fires whenever crude
  messages reach the threshold and no summary/categories exist yet.

When `turnsSinceRefresh` is undefined (new or legacy rows), it defaults to
`refreshCadence`, preserving backwards-compatible "always nudge" behavior.

## Nudge / prompt customization

Three overridable prompt strings per server, stored in
`server_stm_configs`:

| Field | Purpose |
|---|---|
| `tool_description_override` | Custom description for the `update_short_term_memory` tool schema |
| `create_nudge_override` | Custom text for the create-nudge tail directive |
| `update_nudge_override` | Custom text for the update-nudge context item |

All overrides go through `sanitizeUnknownTemplatePlaceholders` after macro
expansion via `toolPromptMacroResolver.expand(...)`. In category mode,
`{category_labels}` is resolved before sanitization.

Configurable via `/server stm prompt-edit`.

## DB persistence

STM is backed by the `short_term_memories` table with write-through cache:

| Column | Purpose |
|---|---|
| `scope_kind` | `server` or `user` — determines scoping |
| `categories` | JSONB — keyed by slug, values are category text |
| `summary` | TEXT — single-blob summary (fallback mode) |
| `turns_since_refresh` | Counter for cadence gating |

Every STM tool write updates both the in-memory cache and the durable DB
row. Reads hit the cache first with DB fallback.

### STM janitor

A periodic timer (`src/timers/stmJanitor.ts`) purges rows older than
`STM_JANITOR_RETENTION_DAYS` (default 90 days). This cleans up orphaned
STM rows for channels/servers that are no longer active.

## Input

Substantial — see signature in `memories.ts:190-203`. Notable:

- `triggeringUserId`, `currentChannelId`, `currentServerId`
- `tomoriState` (provides `persona_lineage_id`, `persona_id`,
  `llm.has_tools`, `llm.llm_provider`, `server_id`)
- `triggererName`, `botName`
- `personalMemoriesEnabled` (passed to `convertMentions`)
- `isUserImpersonation`
- `explicitLongTermMemoryIntent` — when true, suppresses the STM-tool hint
  (the user is asking for a long-term action, not short-term)
- `currentParentChannelId` — for private-channel inheritance in threads
- `toolPromptMacroResolver`, `convertMentions`

## Output

```ts
{
  memoryItems: StructuredContextItem[];   // 0..N items appended to contextItems
  createPromptText?: string;              // optional lower-priority tail directive
}
```

Tagged `KNOWLEDGE_SHORT_TERM_MEMORY` on every emitted item. `role: "user"`
(not `system`) so they're interleaved with conversation flow rather than
sitting in the system header.

The native builder appends `memoryItems` to `contextItems` and pushes
`createPromptText` (if present) onto `lowerPriorityTailDirectives`. The
chat pipeline's per-turn stage 01 inserts the lower-priority directive
before the latest dialogue pair.

## Side effects

- **STM config + category load** — `getStmConfig(serverId)` and
  `getStmCategories(serverId)` for render mode, cadence, nudge overrides,
  and category definitions.
- **STM cache reads**:
  - `getShortTermMemoriesForUser(userId, channelId, lineageId)` — for DMs
    or cross-server flow
  - `getShortTermMemoriesForServer(serverId, channelId, lineageId)` —
    server-scoped
  - `getShortTermMemoryForUserChannel` / `getShortTermMemoryForServerChannel`
    — current-channel summary/categories
- **User row read** — `getCachedUserRow` for `shortterm_cache_crossserver_opt_in`.
- **Private-channel filtering** — if the current channel is *not* private
  and `stm_privacy_bypass` is false, drops STM entries whose
  `channelId` or `parentChannelId` is in `private_channel_ids`.
- **Cross-server folding** — when the user opted in *and* we're in a
  guild (not DM), other-server STM entries are folded into the
  "other-channel memories" list alongside same-server ones.
- **Tool-hint expansion** — `toolPromptMacroResolver.expand(...)` resolves
  `{short_term_memory_tool}` etc. for the active provider.
- **Nudge sanitization** — `sanitizeUnknownTemplatePlaceholders` strips
  unresolved `{placeholder}` tokens after macro expansion.
- **Mention conversion** on every emitted memory text.

## Invariants

After this stage runs:

- Returns `{ memoryItems: [], createPromptText: undefined }` on any
  unhandled error (logged, not thrown).
- Other-channel memories are sorted by `lastUpdated` DESC and capped at
  `MAX_OTHER_CHANNEL_MEMORIES` (default 3).
- The same-channel summary/category item *and* the tool-update hint are
  emitted as separate `KNOWLEDGE_SHORT_TERM_MEMORY` items so preset
  reassembly can slot them together.
- The tool-hint is suppressed when: `llm.has_tools` is false,
  `llm_provider === "novelai"`, or `explicitLongTermMemoryIntent` is true
  (the user is asking for long-term action, the STM hint would compete).
- The update-nudge is additionally gated by cadence:
  `turnsSinceRefresh >= refreshCadence` must be true.
- `createPromptText` (the create-nudge tail directive) is emitted only
  when: there's no same-channel summary/categories, the channel has
  `>= crudeMessageCount` messages cached (from `stmConfig`, falling back
  to `MIN_MESSAGES_FOR_SUMMARY`), and STM-tool is available. The
  create-nudge is **not** cadence-gated.
- In category mode, both create-nudge and update-nudge texts include
  the resolved `{category_labels}` list.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `SHORT_TERM_MEMORY_MIN_MESSAGES_FOR_SUMMARY` | `6` | Fallback threshold for emitting the create-nudge tail directive |
| `SHORT_TERM_MEMORY_MAX_OTHER_CHANNELS` | `3` | Cap on other-channel memory items |
| `SHORT_TERM_MEMORY_TTL_HOURS` | `12` | TTL for crude conversation entries in cache |
| `SHORT_TERM_MEMORY_SUMMARY_TTL_HOURS` | `24` | TTL for summary entries in cache |
| `SHORT_TERM_MEMORY_MAX_SUMMARY_LENGTH` | `1500` | Max length of a single summary/category value |
| `SHORT_TERM_MEMORY_MAX_MESSAGES_PER_CHANNEL` | `10` | Max crude messages stored per channel |
| `STM_MAX_CATEGORIES` | `5` | Maximum number of categories per server |
| `STM_JANITOR_RETENTION_DAYS` | `90` | Days before orphaned STM rows are purged |

> [!NOTE]
> `STM_REFRESH_CADENCE_DEFAULT` is declared in `.env.optional.example` but
> not wired to source code — the default cadence of `1` is hardcoded in
> both the migration and the runtime fallback.

| Source | Field | Effect |
|---|---|---|
| `server_stm_configs` | `refresh_cadence`, `render_mode`, `crude_message_count` | Cadence gating, render behavior, create-nudge threshold |
| `server_stm_configs` | `tool_description_override`, `create_nudge_override`, `update_nudge_override` | Prompt customization |
| `stm_categories` | `label`, `description`, `position` | Dynamic category schema |
| `tomoriConfig` | `private_channel_ids`, `stm_privacy_bypass` | STM privacy filtering |
| `userRow` | `shortterm_cache_crossserver_opt_in` | Cross-server memory folding |

### Commands

| Command | Purpose |
|---|---|
| `/server stm parameters` | Configure cadence, render mode, crude message count |
| `/server stm prompt-edit` | Set tool description, create-nudge, and update-nudge overrides |
| `/server stm categories-edit` | Define category labels and descriptions |
| `/persona stm edit` | Hand-edit live STM for a persona in the current channel |

## Extension points

| Surface | Plugin-relevance |
|---|---|
| STM storage adapter (`shortTermMemoryCache.ts`, `ShortTermMemoryRepository.ts`) | Now DB-backed with write-through cache. Extension point is a custom storage adapter replacing the repository layer. |
| Same-channel summary/category format | Coupled to `update_short_term_memory` tool output; changing the format changes both. |
| Per-provider hint format | Nudge text is now server-configurable via overrides. Extension point shifts to per-provider hint formatting (e.g. different phrasing for different LLM providers). |
| Cross-server opt-in policy | Coupled to the `users.shortterm_cache_crossserver_opt_in` column; user-facing toggle is the `/personalize` command. |
| Provider-specific STM-tool availability | `llm_provider === "novelai"` hardcoded; a plugin adding a provider that doesn't support STM tools would extend this gate. |

## Related docs

- STM DB schema: → [database schema](../../../subsystems/database-schema.md)
  (`short_term_memories`, `server_stm_configs`, `stm_categories` tables)
- STM tool definition: tool registry (→ [tool-loop pipeline](../../../tool-loop/))
- `update_short_term_memory` tool execution: → folded into stage 03 of
  the chat per-turn loop
  ([`03-run-generation-turn.md`](../../chat/06-per-turn/03-run-generation-turn))
- Post-turn STM write + cadence increment: →
  [`04-post-turn-effects.md`](../../chat/06-per-turn/04-post-turn-effects)
- STM janitor timer: `src/timers/stmJanitor.ts`
