---
title: "Tool-Loop Pipeline"
sidebar:
  label: "Overview"
  groupLabel: "Tool Loop"
  order: 300
---

`runToolLoop` drives the streaming + tool-dispatch loop for one LLM generation
attempt. It is called by `runGenerationTurn` (chat per-turn stage 03) once per
model-fallback attempt, after the provider, config, and context have been
prepared. It loops until the provider completes, the user stops it, a limit is
hit, or a non-recoverable error occurs.

## Read order

1. `README.md` — this file (coordinator lifecycle, env config, ASCII flow)
2. `01-stream-once.md` — provider call with rolling SDK timeout
3. `02-execute-tool-call.md` — deliberate-mode gate, registry dispatch, affordance
4. `03-enhanced-context-restart.md` — context-enrichment restart signal
5. `04-build-result.md` — `GenerationTurnResult` assembly

## Stage flow

```
runToolLoop(ToolLoopParams)
     │
     │  init: streamResults=[], functionHistory=[],
     │         accumulatedModelParts=[], finalText="", detailsText=""
     │
 ╔═══╧═ for iteration = 0 .. MAX_FUNCTION_CALL_ITERATIONS ═════════════════╗
 ║                                                                          ║
 ║   [iteration == SOFT_WARN_ITERATION_THRESHOLD]                           ║
 ║       └─► "still working" embed (if shouldSurfaceUserErrors)             ║
 ║                                                                          ║
 ║   ┌── [01] streamOnce ─────────────────────────────────────────────┐    ║
 ║   │   provider.streamToDiscord + rolling AbortController timeout    │    ║
 ║   └───────────────────────────┬────────────────────────────────────┘    ║
 ║                               │ StreamResult.status                      ║
 ║          ┌────────────────────┴──────────────────────┐                  ║
 ║   terminal statuses                           "function_call"            ║
 ║   (completed / error / timeout /                     │                  ║
 ║    empty_response / stopped_by_user /                ▼                  ║
 ║    follow_up_interrupt)                   setChannelToolCallChainActive  ║
 ║          │                                           │                  ║
 ║          │                           ┌── [02] executeToolCall ────────┐ ║
 ║          │                           │  deliberate gate               │ ║
 ║          │                           │  → ToolRegistry.executeTool    │ ║
 ║          │                           │  → affordance retention        │ ║
 ║          │                           │  → [03] enhanced ctx restart   │ ║
 ║          │                           └──────────────┬─────────────────┘ ║
 ║          │                               kind=?     │                   ║
 ║          │                      ┌─────────┬─────────┘                   ║
 ║          │                   restart    abort     history                ║
 ║          │                      │         │         │                   ║
 ║          │                   continue  buildResult  push functionHistory ║
 ║          │                                          │                   ║
 ║          │                               endTurn or shouldEndAfterPreToolText?
 ║          │                               yes ──► buildResult("completed") ║
 ║          │                               no  ──► break (next iteration) ║
 ║          │                                                              ║
 ╚══════════╪══════════════════════════════════════════════════════════════╝
            │  [MAX_FUNCTION_CALL_ITERATIONS reached]
            │  └─► "max iterations" embed → buildResult("timeout")
            │
            ▼
       [04] buildResult → GenerationTurnResult
```

## Stage index

| File | Stage | Symbol | Mission |
|---|---|---|---|
| `01-stream-once.md` | 01 | `streamOnce` | One provider generation pass with rolling SDK timeout |
| `02-execute-tool-call.md` | 02 | `executeToolCall` | Deliberate-mode gate, registry dispatch, history assembly |
| `03-enhanced-context-restart.md` | 03 | `handleEnhancedContextRestart` | Context-enrichment restart signal from tool responses |
| `04-build-result.md` | 04 | `buildResult` | `GenerationTurnResult` assembly with details merge and thought-log identity |

## Cross-references

- **Caller:** chat per-turn stage 03 — `runGenerationTurn` in
  `src/utils/chat/generationTurn.ts` calls `runToolLoop` per model-fallback
  attempt. See
  [`docs/architecture/pipelines/chat/06-per-turn/03-run-generation-turn.md`](../chat/06-per-turn/03-run-generation-turn).
- **Provider streaming:** each iteration delegates actual LLM I/O to the
  provider pipeline. See
  [`docs/architecture/pipelines/provider/`](../provider/).
- **Tool registry:** `ToolRegistry.executeTool` is the dispatch surface in
  `src/tools/toolRegistry.ts`.

## Pipeline-wide concerns

### Verbatim Tool-Calling Workaround

`/config workarounds` can enable `verbatim_tool_calling_enabled` for Custom
OpenAI-compatible endpoints that stream only assistant text. The fallback parser
lives in `CustomStreamAdapter`, not in `toolLoop.ts`: it anchors on a known tool
name and converts a bare, code-span, or fenced tool call — even one preceded by
prose narration — into the same provider-agnostic `FunctionCall` shape as native
`delta.tool_calls`. From this pipeline's perspective, normal and
verbatim tool calls both enter at `streamResult.status === "function_call"` and
execute through `executeToolCall`, preserving deliberate-mode gating,
tool-timeout handling, enhanced-context restarts, and function history.

**Fallback-chain gating.** The verbatim *nudge* (the in-context instruction to
emit calls as a code span) and the verbatim *parser* must agree per attempt, or a
fallback leaks the call as text. The nudge is injected only when
`shouldInjectVerbatimToolCallingNudge` holds — `verbatim_tool_calling_enabled` **and**
the attempt's model has tools **and** its provider is `custom` (the only adapter
with the parser). Because the nudge is baked into base context from the *primary*
model, `generationTurn.prepareProviderContextItems` re-checks this per attempt and
**strips** the nudge for any attempt that fails it — e.g. a fallback to a native
tool-calling provider (Google, OpenRouter) or a custom endpoint without tools.
This keeps native fallbacks clean (they use `delta.tool_calls`) and avoids steering
them into text-form calls their adapter cannot parse. Known limitation: if the
*primary* is non-custom, the nudge is never injected, so a custom endpoint sitting
*later* in the chain will not receive it.

### Iteration state

The following state is shared across all iterations of the loop. Each call to
`streamOnce` receives the current snapshot of `accumulatedModelParts` and
`functionHistory` so the provider sees its own prior tool responses as part of
the growing conversation.

| Variable | Type | Role |
|---|---|---|
| `streamResults` | `StreamResult[]` | Accumulated per-iteration stream results (included in final `GenerationTurnResult`) |
| `functionHistory` | `ToolHistoryEntry[]` | Paired call/response records passed back to the provider on each subsequent iteration |
| `accumulatedModelParts` | `Record<string, unknown>[]` | Provider-native model turn parts accumulated across function-call iterations |
| `finalText` / `detailsText` | `string` | Last non-empty accumulated text and NovelAI scene-metadata suffix; updated on `completed` or `function_call` with pre-tool text |
| `consecutiveToolErrors` | `number` | Reset on success or restart; abort when it reaches `MAX_CONSECUTIVE_TOOL_ERRORS` |
| `thoughtLog` | `ThoughtLogPayload \| undefined` | Carried from whichever iteration last emitted one |

### `shouldEndAfterPreToolText` — pre-tool-text exit policy

When the provider emits text *before* a tool call (`streamResult.accumulatedText`
is non-empty) and `executeToolCall` returns `{kind: "history"}`, the loop checks
`shouldEndAfterPreToolText` before deciding to continue:

- Always exits for **NovelAI** (`providerIsApiFamily(provider, "novelai")`).
- Always exits when `functionName` is in
  `TOOLS_SUPPRESS_FOLLOWUP_AFTER_PRETOOL_TEXT` (currently:
  `"update_short_term_memory"`).

When triggered, the loop returns `buildResult("completed")` using the
pre-tool text rather than continuing to a follow-up generation.

**File:** `src/utils/chat/toolLoop.ts:366-371`

### Iteration guards

| Constant | Source | Default | Effect |
|---|---|---|---|
| `MAX_FUNCTION_CALL_ITERATIONS` | `BOT_MAX_FUNCTION_CALL_ITERATIONS` env | `100` | Hard ceiling; loop exits with `buildResult("timeout")` |
| `SOFT_WARN_ITERATION_THRESHOLD` | Hardcoded | `20` | Sends "still working" embed once at this iteration if `shouldSurfaceUserErrors` |
| `MAX_CONSECUTIVE_TOOL_ERRORS` | `BOT_MAX_CONSECUTIVE_TOOL_ERRORS` env | `5` | Consecutive tool failures before `emitToolErrorLoop` + `buildResult("error")` |
| `STREAM_SDK_CALL_TIMEOUT_MS` | `STREAM_SDK_CALL_TIMEOUT_MS` env | `120000` | Per-call SDK inactivity timeout (rolling; see stage 01) |
| `TOOL_EXECUTION_TIMEOUT_MS` | `TOOL_EXECUTION_TIMEOUT_MS` env | `300000` | Per-tool execution timeout; fresh per tool call — chains are unaffected (see stage 02) |
