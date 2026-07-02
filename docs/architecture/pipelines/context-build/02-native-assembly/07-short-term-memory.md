---
title: "02.7: Short-Term Memory"
---

Recent conversation snippets from the in-memory STM cache, plus tool-hint
emission for the LLM to maintain it.

**File:** `src/utils/text/context/memories.ts:102-326`

## Mission

Surface two kinds of short-term memory to the LLM:

1. **Other-channel memories** — recent conversation summaries from other
   channels in the same server (or cross-server if the user opted in).
2. **Same-channel memory** — the running summary for the current channel
   (if one exists), plus an explicit tool-usage hint for the
   `update_short_term_memory` tool.

The contributor *also* emits a lower-priority tail directive
(`createPromptText`) when no same-channel summary exists yet but the
conversation has accumulated enough messages — telling the LLM to *create*
a short-term memory after responding.

## Input

Substantial — see signature in `memories.ts:102-116`. Notable:

- `triggeringUserId`, `currentChannelId`, `currentServerId`
- `tomoriState` (provides `persona_lineage_id`, `persona_id`,
  `llm.has_tools`, `llm.llm_provider`)
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

- **STM cache reads**:
  - `getShortTermMemoriesForUser(userId, channelId, lineageId)` — for DMs
    or cross-server flow
  - `getShortTermMemoriesForServer(serverId, channelId, lineageId)` —
    server-scoped
  - `getShortTermMemoryForUserChannel` / `getShortTermMemoryForServerChannel`
    — current-channel summary
- **User row read** — `getCachedUserRow` for `shortterm_cache_crossserver_opt_in`.
- **Private-channel filtering** — if the current channel is *not* private
  and `stm_privacy_bypass` is false, drops STM entries whose
  `channelId` or `parentChannelId` is in `private_channel_ids`.
- **Cross-server folding** — when the user opted in *and* we're in a
  guild (not DM), other-server STM entries are folded into the
  "other-channel memories" list alongside same-server ones.
- **Tool-hint expansion** — `toolPromptMacroResolver.expand(...)` resolves
  `{short_term_memory_tool}` etc. for the active provider.
- **Mention conversion** on every emitted memory text.

## Invariants

After this stage runs:

- Returns `{ memoryItems: [], createPromptText: undefined }` on any
  unhandled error (logged, not thrown).
- Other-channel memories are sorted by `lastUpdated` DESC and capped at
  `MAX_OTHER_CHANNEL_MEMORIES` (default 3).
- The same-channel summary item *and* the tool-update hint are emitted as
  separate `KNOWLEDGE_SHORT_TERM_MEMORY` items so preset reassembly can
  slot them together.
- The tool-hint is suppressed when: `llm.has_tools` is false,
  `llm_provider === "novelai"`, or `explicitLongTermMemoryIntent` is true
  (the user is asking for long-term action, the STM hint would compete).
- `createPromptText` (the "create STM" tail directive) is emitted only
  when: there's no same-channel summary, the channel has
  `>= MIN_MESSAGES_FOR_SUMMARY` messages cached, and STM-tool is
  available.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `SHORT_TERM_MEMORY_MIN_MESSAGES_FOR_SUMMARY` | `6` | Threshold for emitting the "create STM" tail directive |
| `SHORT_TERM_MEMORY_MAX_OTHER_CHANNELS` | `3` | Cap on other-channel memory items |

| Source | Field | Effect |
|---|---|---|
| `tomoriConfig` | `private_channel_ids`, `stm_privacy_bypass` | STM privacy filtering |
| `userRow` | `shortterm_cache_crossserver_opt_in` | Cross-server memory folding |

## Extension points

| Surface | Plugin-relevance |
|---|---|
| STM cache backend (`shortTermMemoryCache.ts`) | Currently in-memory. A plugin replacing this with a persistent backend would extend the cache module, not this contributor. |
| Same-channel summary format | Coupled to `update_short_term_memory` tool output; changing the format changes both. |
| Tool-hint phrasing | Hardcoded English strings here; localization happens elsewhere. The hint text is the seam if a plugin wants alternate phrasing. → plugin plan candidate. |
| Cross-server opt-in policy | Coupled to `user_personalization_configs.shortterm_cache_crossserver_opt_in`; user-facing toggle is `/personal cache`. |
| Provider-specific STM-tool availability | `llm_provider === "novelai"` hardcoded; a plugin adding a provider that doesn't support STM tools would extend this gate. AC-2 (name-switch purge) lists this as a violation to eliminate. → plugin plan candidate. |

## Related docs

- Short-term memory cache: → no dedicated doc;
  `shortTermMemoryCache.ts` helper only
- STM tool definition: tool registry (→ [tool-loop pipeline](../../../tool-loop/))
- `update_short_term_memory` tool execution: → folded into stage 03 of
  the chat per-turn loop
  ([`03-run-generation-turn.md`](../../chat/06-per-turn/03-run-generation-turn))
