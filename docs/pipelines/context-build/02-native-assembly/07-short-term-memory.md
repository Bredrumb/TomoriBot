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
   current channel (if one exists).

Separately, the contributor emits a single **unified nudge** (`nudgeItem`)
for the `update_short_term_memory` tool, gated by the cadence counter. The
same nudge covers BOTH cases — "no STM yet, please create one" and "STM
exists, please refresh it" — so there is no longer a distinct create vs.
update nudge. The nudge is returned out-of-band (not inside `memoryItems`)
so the pipeline can inject it at a configurable dialogue depth.

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
incremented unconditionally by `incrementStmTurnCounter()` in post-turn
effects after each bot turn — it advances whether or not the bot actually
created/updated an STM — and is reset to `0` only when the bot calls
`update_short_term_memory` (`resetStmTurnCounter()`).

- **Unified nudge** — fires when `turnsSinceRefresh >= refreshCadence`
  (from `stmConfig`, default `5`). The same gate applies to both the
  create case (no STM yet) and the update case (existing STM). Because the
  counter keeps climbing until the bot uses the tool, the nudge re-appears
  every turn once due and only clears after a successful STM write.

When `turnsSinceRefresh` is undefined (channel with no STM row at all), it
defaults to `0`, so a fresh channel is not nudged until the bot has
participated in `refreshCadence` turns.

## Nudge injection depth

The nudge is injected positionally by the chat pipeline
(`insertAtDialogueDepth` in `contextAnnotations.ts`) at
`server_stm_configs.nudge_injection_depth`. Depth counts individual dialogue
TURNS from the bottom (a user turn and a bot turn are separate turns, **not**
pairs):

- `0` — tail, after every dialogue turn (literal last position)
- `1` — before the final turn
- `2` — before the latest user/bot pair (**default**; mirrors the legacy
  create-nudge placement)
- `N` — before the Nth turn from the bottom (clamps to the earliest dialogue
  turn when fewer than N exist, rather than jumping to tail)

Only `DIALOGUE_HISTORY` items are counted; `DIALOGUE_SAMPLE` example
dialogues are excluded from the walk.

## Nudge / prompt customization

Two overridable prompt strings per server, stored in `server_stm_configs`:

| Field | Purpose |
|---|---|
| `tool_description_override` | Custom description for the `update_short_term_memory` tool schema |
| `update_nudge_override` | Custom text for the unified create/update nudge |

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
  nudgeItem?: StructuredContextItem;      // unified create/update nudge (out-of-band)
  nudgeInjectionDepth: number;            // dialogue depth for nudge injection (default 2)
}
```

Tagged `KNOWLEDGE_SHORT_TERM_MEMORY` on every emitted item. `role: "user"`
(not `system`) so they're interleaved with conversation flow rather than
sitting in the system header.

The native builder appends `memoryItems` to `contextItems` and forwards
`nudgeItem` + `nudgeInjectionDepth` (through `BuildContextResult`, preserved
across preset reassembly) to the chat pipeline's `appendTailDirectives`,
which calls `insertAtDialogueDepth` to splice the nudge in at the configured
depth after dialogue history is assembled.

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

- Returns `{ memoryItems: [], nudgeInjectionDepth: 0 }` on any unhandled
  error (logged, not thrown).
- Other-channel memories are sorted by `lastUpdated` DESC and capped at
  `MAX_OTHER_CHANNEL_MEMORIES` (default 3). Crude messages rendered in the
  Mode B additive blocks and the no-summary fallback listing are capped to
  the most recent `crude_message_count` (from `stmConfig`, falling back to
  `DEFAULT_CRUDE_MESSAGE_COUNT`).
- The same-channel summary/category item is emitted in `memoryItems`; the
  unified nudge is returned separately in `nudgeItem` for positional
  injection.
- The nudge is suppressed when: `llm.has_tools` is false,
  `llm_provider === "novelai"`, or `explicitLongTermMemoryIntent` is true
  (the user is asking for long-term action, the STM hint would compete).
- The nudge is gated by cadence: `turnsSinceRefresh >= refreshCadence` must
  be true, for both the create and update cases.
- In category mode, the nudge text includes the resolved `{category_labels}`
  list.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `SHORT_TERM_MEMORY_DEFAULT_CRUDE_MESSAGE_COUNT` | `6` | Fallback crude-message render depth when a server has no `crude_message_count` set |
| `SHORT_TERM_MEMORY_MAX_OTHER_CHANNELS` | `3` | Cap on other-channel memory items |
| `SHORT_TERM_MEMORY_TTL_HOURS` | `12` | TTL for crude conversation entries in cache |
| `SHORT_TERM_MEMORY_SUMMARY_TTL_HOURS` | `24` | TTL for summary entries in cache |
| `SHORT_TERM_MEMORY_MAX_SUMMARY_LENGTH` | `1500` | Max length of a single summary/category value |
| `SHORT_TERM_MEMORY_MAX_MESSAGES_PER_CHANNEL` | `10` | Max crude messages stored per channel |
| `STM_MAX_CATEGORIES` | `5` | Maximum number of categories per server |
| `STM_JANITOR_RETENTION_DAYS` | `90` | Days before orphaned STM rows are purged |

> [!NOTE]
> The default cadence of `5` and the default `nudge_injection_depth` of `2`
> are set in migration 035 and mirrored as runtime fallbacks in
> `memories.ts`.

| Source | Field | Effect |
|---|---|---|
| `server_stm_configs` | `refresh_cadence`, `render_mode`, `crude_message_count`, `nudge_injection_depth` | Cadence gating, render behavior, crude render cap, nudge position |
| `server_stm_configs` | `tool_description_override`, `update_nudge_override` | Prompt customization |
| `stm_categories` | `label`, `description`, `position` | Dynamic category schema |
| `tomoriConfig` | `private_channel_ids`, `stm_privacy_bypass` | STM privacy filtering |
| `userRow` | `shortterm_cache_crossserver_opt_in` | Cross-server memory folding |

### Commands

| Command | Purpose |
|---|---|
| `/server stm parameters` | Configure cadence, render mode, crude message count, nudge depth |
| `/server stm prompt-edit` | Set tool description and the unified nudge override |
| `/server stm categories-edit` | Define category labels and descriptions |
| `/persona stm edit` | Hand-edit live STM for a persona in the current channel |
| `/help stm` | In-Discord guide to the STM customization surface |

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
