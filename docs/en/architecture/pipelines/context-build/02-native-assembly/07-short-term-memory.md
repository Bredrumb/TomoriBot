---
title: "02.7: Short-Term Memory"
aiGenerated: true
---

The short-term memory contributor retrieves recent conversation summaries and category blocks from the current channel and other eligible channels. Models can read same-channel memory without tool support.

## Flow and ownership

The contributor `buildShortTermMemoryContext` in `src/utils/text/context/memories.ts` coordinates memory retrieval and prompt construction:

1. **Preconditions and gating**:
   - Requires a triggering user ID. Returns an empty result if absent.
   - Existing memory renders even when automatic summaries are off.
2. **Channel memory retrieval**:
   - **Same-channel memory**: Retrieves the active running summary or category block for the current channel.
   - **Other-channel memories**: Retrieves up to three recent conversation summaries from other channels (`MAX_OTHER_CHANNEL_MEMORIES = 3`), sorted by update recency.
   - **Privacy filtering**: `getChannelPrivacyReason` in `src/utils/discord/channelPrivacy.ts` owns the shared privacy check for STM, thought logs, and cross-channel tool targets. Role restrictions, private threads, manually private channels and their threads, and unresolved audiences are private; individual member overwrites do not trigger automatic privacy. With `stm_privacy_bypass` off, private sources are excluded before the recall limit. Destination privacy never filters recall, because only a private source can expose a private conversation. Source channels are resolved through Discord rather than relying on cached STM parent metadata, including after database hydration.
   - **Cross-server memory**: Folds in memories from other servers when the user has opted in via their personal settings. Each source server's configuration controls whether its private STM can leave; an unavailable source configuration excludes that server's entries. DM recall retains the user's explicit cross-server opt-in behavior.
3. **Render modes**:
   - `crude_summary` (default): Emits the summary or category block followed by recent raw messages.
   - `supersede`: When a summary or category block exists, raw messages for that channel are omitted.
   - Summaries and category text resolve `{@userId}` for the active persona. Raw messages preserve this token.
4. **Content placement**: Same-channel memory younger than 60 minutes, or any block carrying other-channel content, receives the `STM_TAIL_SLOT` marker. Native assembly defers that content even when the configured depth is `-1`. Stale same-channel-only content keeps its configured placement, with `-1` remaining above history.

## Positional injection contract

`applyPromptLayoutInserts` in `src/utils/text/context/promptLayout.ts` compares the fresh block's
tail-slot position with its configured dialogue-item depth and chooses the position closer to the
end. Saved depths retain their item-based meaning. Placement runs after native or preset assembly
so presets cannot pull fresh STM into an early marker.

## Constraints and rationale

- **Out-of-band delivery**: Preserving deferred `memoryInjectionItems` outside `contextItems` ensures that preset reassembly does not pull recency-sensitive notes into the system prefix.
- **Sharing exception**: `stm_privacy_bypass` permits the owning server's private STM to leave its channels; it never changes thought-log or cross-channel tool permissions, and its stored value retains its existing meaning.
- **Fail-safe execution**: Any error during short-term memory assembly logs a warning and returns an empty list, preventing memory lookup failures from aborting the turn.

## Source pointers

- `src/utils/text/context/memories.ts`: `buildShortTermMemoryContext` and freshness calculations.
- `src/utils/cache/shortTermMemoryCache.ts`: in-process short-term memory cache.
- `src/utils/db/repositories/ShortTermMemoryRepository.ts`: durable database persistence.
- `src/utils/chat/contextPipeline.ts`: `appendTailDirectives` positional dialogue splicing.
- `src/utils/text/context/promptLayout.ts`: positional insertion and tail-slot comparison.
- [Short-Term Memory Pipeline](/architecture/pipelines/memory/stm/): Working memory capture, background summaries, and cache lifecycles.
