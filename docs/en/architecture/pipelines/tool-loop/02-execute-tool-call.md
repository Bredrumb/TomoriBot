---
title: "02: Execute Tool Call"
---

`executeToolCall` validates, gates, and dispatches a single tool call from the provider. It returns a
discriminated outcome indicating whether to restart the turn with enriched context, abort execution,
or record a history entry and continue the tool chain.

## Gating and dispatch flow
<!-- anchor: gating-and-dispatch-flow -->

When the provider emits a `function_call` status, the stage processes the call through an ordered
sequence of validation and safety gates before invoking the registry:

1. **Payload validation:**
   The stage verifies that `streamResult.data` contains a valid tool name. If the payload is missing
   or lacks a name, it logs an error and returns `{ kind: "abort", status: "error" }`.

2. **Stop request check:**
   The stage inspects `StreamOrchestrator` for pending stop requests. If a user issued `/kill`, it
   returns `{ kind: "abort", status: "stopped_by_user" }`. If a follow-up message arrived instead,
   it clears the interrupt flag and proceeds with tool execution; the follow-up message is already
   queued in the channel queue and does not abort an in-flight tool chain.

3. **Truncated arguments refusal:**
   If the stream adapter flagged `functionCall.argumentsTruncated`, the tool is refused without
   dispatch. Adapters set this flag when a provider cuts off a JSON payload mid-stream. Dispatching a
   tool with only the subset of keys that arrived whole would cause tools that overwrite stored state
   (such as memory categories) to delete missing keys. The stage drops the recovered arguments from
   `functionCall.args`, logs an error, emits a hidden thought log, and returns `{ kind: "history" }`
   with a synthetic failure response explaining the truncation. The outer loop increments its
   consecutive error counter, giving the model an opportunity to reissue a complete call.

4. **Deliberate tool mode allowlist gate:**
   When deliberate tool mode is active for the turn, the stage checks `deliberateToolAllowedNames`.
   If the tool was not admitted by trigger intent during context planning, dispatch is blocked. The
   stage returns a synthetic failure response (`blocked_by_deliberate_tool_mode`) directly to the model,
   allowing it to adapt its response without surfacing a user-visible error.

5. **Registry execution under watchdog:**
   The stage marks the channel's active tool name via `setChannelActiveToolName` and runs
   `ToolRegistry.executeTool` under `runUnderWatchdog`. Dispatch races against a per-tool timeout
   (`TOOL_EXECUTION_TIMEOUT_MS`, default 300 s) and the turn-level kill signal (`turnAbortSignal`).
   A plain timeout yields `{ success: false }`, allowing the model to handle the failure; a kill
   signal returns `{ kind: "abort", status: "stopped_by_user" }`. The active tool name is cleared
   in the `finally` block when the race settles. Tools that do not honor abort can continue their
   external work after the caller stops awaiting them. A timeout does not roll back their effects.

## Expression delivery and side effects
<!-- anchor: expression-delivery-and-side-effects -->

Tool execution coordinates several turn-level side effects:

- **Expression delivery:** If a tool returns a `stickerSelection` payload (used by expression tools),
  the stage calls `deliverExpression` immediately. Expression delivery enforces a strict single-expression
  allowance per persona turn via `ChatTurnContext.expressionDelivery`. A repeated call returns
  `sticker_already_sent` without posting to Discord. If an earlier send timed out or was unconfirmed,
  subsequent expression attempts in that turn are refused to avoid duplicate visible messages.
  Successful delivery marks `responseDelivered = true`, which allows a sticker-only turn to settle
  as `completed` rather than failing as an empty response.
- **Usage tracking:** Successful non-blocked tool calls record a `tool_used` metric in `statRepository`
  for non-DM channels.
- **Diagnostic notices:** Failed tool calls emit a hidden thought-log notice containing redacted
  arguments. When deliberate tool mode admitted a tool via a trigger match, the stage emits a hidden
  notice recording the matched trigger pattern.
- **One-shot memory guard:** A successful `update_short_term_memory` call sets
  `streamingContext.disableShortTermMemoryUpdate = true`, blocking subsequent memory updates within the
  same turn.

## Return outcomes
<!-- anchor: return-outcomes -->

The stage returns one of three outcome kinds:

1. **`{ kind: "restart" }`:**
   Triggered when `handleEnhancedContextRestart` consumes a `context_restart_*` payload. The outer
   loop resets error counters and continues without recording a tool history entry.
2. **`{ kind: "abort", status }`:**
   Triggered on malformed payloads, cancellation stops, or aborted expression sends. The outer loop
   exits immediately with the specified turn status.
3. **`{ kind: "history", historyEntry, ... }`:**
   Standard completion. The stage packages the call and response into a `ToolHistoryEntry`.
   Visible text streamed before the tool call is converted into `preToolCallTextParts` on the history
   entry, and the outer loop clears `accumulatedModelParts` so trailing prefill does not duplicate
   already-delivered text.

## Source pointers
<!-- anchor: source-pointers -->

- `src/utils/chat/toolLoop.ts`: `executeToolCall`, `buildPreToolCallTextParts`, `emitFailedToolCallThoughtLog`.
- `src/tools/toolRegistry.ts`: `ToolRegistry.executeTool`.
- `src/utils/chat/expressionDelivery.ts`: `deliverExpression`, `buildExpressionToolResult`.
- `src/types/tool/interfaces.ts`: `ToolContext`, `ToolResult`.
