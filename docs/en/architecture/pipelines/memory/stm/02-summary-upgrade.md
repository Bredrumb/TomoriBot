---
title: "STM 02: Summary Upgrade"
---

LLM-initiated replacement of the crude conversation at render time with a
compact, durable LLM-authored summary.

**Files:**
- `UpdateShortTermMemoryTool` — `src/tools/functionCalls/updateShortTermMemoryTool.ts`
- `updateShortTermMemorySummary` — `src/utils/cache/shortTermMemoryCache.ts:518-574`

## Mission

When the LLM calls the `update_short_term_memory` tool during the tool-loop,
it provides a `summary` string that distills the current conversation into a
compact, model-friendly representation. `UpdateShortTermMemoryTool.execute()`
validates the input, extracts channel/server/persona metadata from the tool
context, and calls `updateShortTermMemorySummary()`, which writes the summary
string into both the user-scoped and server-scoped STM cache entries and their
durable database rows for this channel.

On the next turn, the context-build STM stage renders the `summary` field
instead of the raw `messages` array, reducing token cost and giving the LLM
a self-authored context rather than a verbose turn-by-turn log. Upgraded
entries also enjoy a longer TTL (`SHORT_TERM_MEMORY_SUMMARY_TTL_HOURS`,
default 24 h) compared to the crude conversation TTL (12 h default).

Silent operation — no embed or user-facing message is sent.

## Input

- `args.summary: string` — the LLM-authored summary (max `MAX_SUMMARY_LENGTH`
  chars; default 1 500; truncated silently if over limit).
- `context: ToolContext` — provides `userId`, `channel.id`, `guildId`,
  `tomoriState.persona_id`, `tomoriState.persona_lineage_id`.
- `context.streamContext.explicitLongTermMemoryIntent` — if `true`, this tool
  is not offered (see intent gate in [memory README](../README)).
- `context.streamContext.disableShortTermMemoryUpdate` — if `true`, execution
  is blocked (per-turn deduplication guard).

## Output

`Promise<ToolResult>` — `{ success: true, message: "..." }` on success; error
result on validation failure or blocked execution.

## Side effects

- **STM cache `summary` field updated** — both user-scoped and server-scoped
  entries for this `(userId, channelId, personaId)` gain or replace their
  `summary` string.
- **Durable summary rows updated** — both scopes are written through to
  `short_term_memories`, allowing the summary to be hydrated after a restart.
- **`lastUpdated` refreshed** — the TTL clock restarts on the updated entries.
- **`streamingContext.disableShortTermMemoryUpdate = true`** — set by the
  tool-loop after successful execution (prevents re-calling this tool in the
  same turn).
- **No cache invalidation** — the live STM entry is updated directly before the
  database write, so no downstream cache needs invalidating.

## Invariants

After a successful execute:

- The STM cache entry for `(userId, channelId, personaId)` contains a
  non-empty `summary` field of at most `MAX_SUMMARY_LENGTH` characters.
- Existing `messages` in the entry are preserved — the summary is written
  alongside them, not instead of them at the data layer. The context-build
  reader chooses summary over messages at render time.
- At most one successful execution occurs per generation turn.

## Guards (all block execution)

| Guard | Code location |
|---|---|
| `explicitLongTermMemoryIntent` flag is `true` | `isAvailableForContext()` at `updateShortTermMemoryTool.ts:64`; also re-checked in `execute()` at `:81` |
| `disableShortTermMemoryUpdate` flag is `true` | `isAvailableForContext()` at `:69`; also re-checked in `execute()` at `:89` |
| Provider is `"novelai"` | `isAvailableFor()` at `:48` — excluded due to token-budget constraints |

## Extension points

| Surface | Plugin-relevance |
|---|---|
| `updateShortTermMemorySummary()` | Internal — summary write is a direct cache mutation; no plugin-relevant seam. The `summary` field replaces crude conversation globally for the channel key; there is no per-plugin namespace. |
| `MAX_SUMMARY_LENGTH` | Env-var configurable (`SHORT_TERM_MEMORY_MAX_SUMMARY_LENGTH`, default 1 500). Not a plugin seam. |
| Summary TTL | Env-var configurable (`SHORT_TERM_MEMORY_SUMMARY_TTL_HOURS`, default 24). Not a plugin seam. |

## Configuration

| Source | Key / Env var | Default | Purpose |
|---|---|---|---|
| Env var | `SHORT_TERM_MEMORY_MAX_SUMMARY_LENGTH` | `1500` | Max summary length before truncation |
| Env var | `SHORT_TERM_MEMORY_SUMMARY_TTL_HOURS` | `24` | TTL for entries that have a summary |

## Related docs

- Intent gate that may suppress this tool: → [memory pipeline README — intent detection gate](../README)
- STM passive capture that this stage supersedes for context rendering: → [`stm/01-passive-capture.md`](01-passive-capture.md)
- Tool-loop that invokes this stage: → [tool-loop Stage 02 `executeToolCall`](../../../tool-loop/02-execute-tool-call)
- Read side that prefers `summary` over `messages`: → [context-build STM stage](../../../context-build/02-native-assembly/04-stm-memories)
