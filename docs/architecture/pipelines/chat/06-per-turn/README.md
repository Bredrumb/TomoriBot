---
title: "06: Per-Turn Loop"
sidebar:
  label: "Overview"
  groupLabel: "06: Per-Turn"
---

This folder documents the **body of the loop** in
[`tomoriChat.ts`](../README) — the four stages that execute once per
responding persona inside `runWithChannelLock`.

## Loop semantics

```ts
for (const turn of turnPlan.turns) {
  const context = await buildChatTurnContext(turn);          // 01
  const responseSink = createChatResponseSink(context);      // 02
  const result = await runGenerationTurn(context, responseSink); // 03
  await runPostTurnEffects(context, result);                 // 04
}
```

- **Iteration scope:** one iteration = one persona's reply attempt. A
  3-persona reply runs the body 3 times under a single channel lock.
- **Carried state:** stages 01–03 share the same `ChatTurnContext` closure.
  Stage 01 builds it; stages 02–03 may mutate it (`responseTarget`,
  `tomoriState`, `contextItems`). Stage 04 reads it after generation finishes.
- **No persona-to-persona dependency:** each iteration is structurally
  independent. The next iteration sees the *Discord-visible* effects of the
  previous one (the previous persona's reply now appears in the channel
  history), but not its in-memory state.
- **Multi-persona reality:** when `turnPlan.turns.length > 1`, only the
  *first* persona runs in this loop. Stage 05 (`planChatTurns`) queues the
  rest at the *front* of the channel queue so they replay immediately after
  lock release. So in practice each loop instance runs body once or twice,
  not for all matched personas at once.

## Stage index

| # | Stage | File | Mission |
|---|-------|------|---------|
| 01 | `buildChatTurnContext` | [`01-build-context.md`](./01-build-context) | Assemble the LLM-visible prompt for this turn. |
| 02 | `createChatResponseSink` | [`02-create-response-sink.md`](./02-create-response-sink) | Resolve Discord delivery target + emit/finalize callbacks. |
| 03 | `runGenerationTurn` | [`03-run-generation-turn.md`](./03-run-generation-turn) | Drive provider call with fallback chain + key rotation. |
| 04 | `runPostTurnEffects` | [`04-post-turn-effects.md`](./04-post-turn-effects) | Run the post-generation side-effect sequence. |

## Cross-references

- Stage 01 delegates to the [context-build pipeline](../../context-build/).
- Stage 03 delegates to the [tool-loop pipeline](../../tool-loop/)
  and the [provider pipeline](../../provider/).
- Stage 04 writes to [memory](../../memory/) and
  schedules boomerang follow-ups via `crossChannelMessageTool`.
