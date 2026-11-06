---
title: "02.7: Short-Term Memory"
aiGenerated: true
---

The short-term memory contributor retrieves recent conversation summaries and category blocks across server channels and emits cadence-gated tool nudges.

## Flow and ownership

The contributor `buildShortTermMemoryContext` in `src/utils/text/context/memories.ts` coordinates memory retrieval and prompt construction:

1. **Preconditions and gating**:
   - Requires a triggering user ID. Returns an empty result if absent.
   - When automatic short-term memory is disabled (`short_term_memory_enabled === false`), the bot suppresses the cadence nudge and the write tool. Existing memory content still renders so operators can curate memories manually.
2. **Channel memory retrieval**:
   - **Same-channel memory**: Retrieves the active running summary or category block for the current channel.
   - **Other-channel memories**: Retrieves up to three recent conversation summaries from other channels (`MAX_OTHER_CHANNEL_MEMORIES = 3`), sorted by update recency.
   - **Privacy filtering**: Excludes other-channel memories originating from private channels unless `stm_privacy_bypass` is active.
   - **Cross-server memory**: Folds in memories from other servers when the user has opted in via their personal settings.
3. **Render modes**:
   - `crude_summary` (default): Emits the summary or category block followed by recent raw messages.
   - `supersede`: When a summary or category block exists, raw messages for that channel are omitted.
4. **Unified cadence nudge (`nudgeItem`)**:
   - Emits a prompt hint instructing the model to invoke `{short_term_memory_tool}` after responding.
   - Gated by `turnsSinceRefresh >= refreshCadence` (default 5). The same counter and condition govern both initial creation and ongoing refresh.
   - Suppressed when the model lacks tools (`has_tools === false`), the provider is NovelAI, or an explicit long-term memory command is detected (`explicitLongTermMemoryIntent === true`). The model is the turn's planned model (channel or persona override included), not the server default.
   - The nudge and the same-channel block carry `requiresToolCalling`, so a fallback attempt that sends no tools drops both while other-channel memories stay.
   - Carries an empty `completionText` projection, so NovelAI request fitting also excludes a nudge built for another model before a personal override or fallback; actual memory contents remain eligible.
   - Returned out-of-band alongside `nudgeInjectionDepth` (default 2, placing it before the latest user/bot turn pair).
5. **Content placement**: Same-channel memory younger than 60 minutes, or any block carrying other-channel content, receives the `STM_TAIL_SLOT` marker. Native assembly defers that content even when the configured depth is `-1`. Stale same-channel-only content keeps its configured placement, with `-1` remaining above history.

## Positional injection contract

`applyPromptLayoutInserts` in `src/utils/text/context/promptLayout.ts` compares the fresh block's
tail-slot position with its configured dialogue-item depth and chooses the position closer to the
end. Saved depths retain their item-based meaning. The cadence nudge keeps its independent depth.
Registry order places STM content before its nudge when the positions coincide. These rules apply
after native or preset assembly; presets cannot pull fresh STM into an early marker.

## Constraints and rationale

- **Out-of-band delivery**: Preserving `nudgeItem` and deferred `memoryInjectionItems` outside `contextItems` ensures that preset reassembly does not pull recency-sensitive notes into the system prefix.
- **Explicit memory intent suppression**: When a user explicitly asks the bot to remember or store information permanently, the short-term memory nudge is suppressed so the model selects `create_long_term_memory` instead.
- **Fail-safe execution**: Any error during short-term memory assembly logs a warning and returns an empty list, preventing memory lookup failures from aborting the turn.

## Source pointers

- `src/utils/text/context/memories.ts`: `buildShortTermMemoryContext` and freshness calculations.
- `src/utils/cache/shortTermMemoryCache.ts`: in-process short-term memory cache.
- `src/utils/db/repositories/ShortTermMemoryRepository.ts`: durable database persistence.
- `src/utils/chat/contextPipeline.ts`: `appendTailDirectives` positional dialogue splicing.
- `src/utils/text/context/promptLayout.ts`: positional insertion and tail-slot comparison.
- [Short-Term Memory Pipeline](/architecture/pipelines/memory/stm/): Working memory capture, category upgrades, and cache lifecycles.
