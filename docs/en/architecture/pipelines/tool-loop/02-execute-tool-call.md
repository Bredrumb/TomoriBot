---
title: "02: Execute Tool Call"
---

Validate, gate, dispatch, and record one tool call from the provider.

- **File**: `src/utils/chat/toolLoop.ts`

## Mission

Given a `function_call` stream result, run the named tool and return a
discriminated outcome that tells the outer loop whether to restart (context was
enriched), abort (fatal condition), or append a history entry and continue.

The stage enforces the deliberate-tool-mode allowlist before reaching the
registry, retains the affordance window on success, emits a hidden trigger
notice when a deliberate-mode trigger matched, and delegates context-enrichment
restarts to
[stage 03: `handleEnhancedContextRestart`](03-enhanced-context-restart.md).

## Input

- `params: ToolLoopParams`: full loop context.
- `streamResult: StreamResult`: the `function_call` result from stage 01;
  `streamResult.data` carries the raw function-call payload.
- `iteration: number`: current loop iteration index (used to set
  `showKillHint` in `ToolContext` once the soft-warn threshold is reached).

## Output

A discriminated union:

```ts
| { kind: "restart" }
| { kind: "abort"; status: GenerationTurnResult["status"] }
| {
    kind: "history";
    functionName: string;
    success: boolean;
    endTurn: boolean;
    responseDelivered: boolean;
    historyEntry: ToolHistoryEntry;
  }
```

- **`"restart"`**: `handleEnhancedContextRestart` consumed the result; the
  outer loop does `continue` without pushing to `functionHistory`.
- **`"abort"`**: a fatal condition was hit (malformed call, stop request,
  a stop observed just before an expression send); outer loop calls `buildResult(status)` immediately.
- **`"history"`**: normal outcome; outer loop pushes `historyEntry` to
  `functionHistory` and checks `endTurn` / `shouldEndAfterPreToolText`.

## Side effects

Steps in execution order:

1. **Validate function-call data**: if `streamResult.data` is missing or has
   no `name`, returns `{kind: "abort", status: "error"}` and logs the
   malformed result.

2. **Stop-request check**: a regular stop returns
   `{kind: "abort", status: "stopped_by_user"}` before any tool runs. A stale
   follow-up interrupt is different: the follow-up is already queued, so the
   interrupt is cleared and the active tool chain continues. The same
   distinction is checked again after tool execution.

3. **Build `ToolContext`**: assembles the context object passed to every tool.
   Key fields derived from `ChatTurnContext`:
   - `channel`, `client`, `message`, `userId`, `guildId`
   - `tomoriState`, `locale`, `provider` (provider name string)
   - `streamContext` (the live `StreamingContext`)
   - `webhook`, `personaUsername`, `personaAvatarUrl` (from `responseTarget`)
   - `activePersonaId`, `isUserImpersonation`, `impersonatedUserId`
   - `suppressProgressNotices`: set when `shouldSurfaceUserErrors` is false
   - `contextItems`, `messageIdMap`: live references (tools may read these)
   - `showKillHint`: true once `iteration >= SOFT_WARN_ITERATION_THRESHOLD`
   - `abortSignal`: the turn-level `AbortSignal` from `getChannelTurnAbortSignal`.
     Tools that forward this to their `fetch` calls get true HTTP-level
     cancellation when `/kill` fires.

4. **Truncated-argument refusal**: when the adapter recovered `functionCall.args` from an
   incomplete provider payload it sets `FunctionCall.argumentsTruncated`. The tool is *not*
   dispatched. A recovered payload holds only the keys that arrived whole, and for a tool whose
   arguments replace stored state (the short-term memory category map, for example) writing
   that subset silently drops everything else. No tool's semantics survive a partial call, so
   the stage returns `{kind: "history"}` with a synthetic failure response:
   ```
   { status: "tool_execution_failed", tool_name, reason }
   ```
   The `reason` names the cause and the outcome, so the model retries with a complete call
   instead of assuming the update landed. The recovered subset is cleared from
   `functionCall.args` before the history entry is built, so the replayed assistant turn does
   not show the model arguments it never finished writing. The visit counts toward
   `MAX_CONSECUTIVE_TOOL_ERRORS`, which is what bounds a model that keeps reissuing a truncated
   call. Unlike the other exits above, this one still emits the hidden thought-log notice the
   ordinary failure path emits, and logs at `error` level: `log.warn` is filtered out whenever
   `RUN_ENV=production`, which is the only environment a provider truncation happens in. See
   [stage 03 of the provider pipeline](../provider/03-chunk-normalization.md) for the repair
   itself.

   This refusal precedes the allowlist gate below, so a truncated call to a tool deliberate
   mode also hides reports the truncation rather than the allowlist rejection: the payload
   being cut short is the cause the model can act on.

5. **Deliberate-tool-mode allowlist gate**: if
   `context.deliberateToolModeActive` is true and `deliberateToolAllowedNames`
   is set and the requested tool is not in the allowed set, the tool is *not*
   dispatched. A synthetic failure response is produced instead:
   ```
   { status: "blocked_by_deliberate_tool_mode", functionName, allowedToolNames }
   ```
   This is model-visible (returned as a tool response) so the model can adapt
   its next turn without a user-facing error.

6. **`ToolRegistry.executeTool` with timeout + kill race**: actual dispatch,
   wrapped in a `Promise.race` against two cancellation promises:

   Before dispatch, the registry runs two separate availability gates whose
   rejection text differs because `error` is fed back to the model:
   - `tool.isAvailableFor(provider)`: static provider support. Rejection is
     logged at `error` level and reported as *not available for provider X*.
   - `tool.isAvailableForContext(provider, context)`: live turn state
     (per-turn dedup flags, model capabilities, configured server slots).
     Rejection is logged at `warn` level and reported as *not available for
     the current turn*, with an instruction not to retry it this turn. It must
     never be reported as a provider capability gap.

   An unknown built-in tool name returns a model-visible error with the closest registered name and the available names, so the model can correct its next call.

   - **Timeout promise**: resolves after `TOOL_EXECUTION_TIMEOUT_MS` (default
     5 min) with a synthetic `{ success: false, error: "timed out" }` result.
     The timer is fresh per tool call, so a chain of fast tools is unaffected.
   - **Kill promise**: resolves immediately if the turn-level `AbortSignal`
     fires (i.e., `/kill` was used while the tool was running).

   After the race, if `StreamOrchestrator.hasStopRequest` is true (kill was
   requested), the stage returns `{kind: "abort", status: "stopped_by_user"}`
   immediately; the failed result is never fed back to the model. For a plain
   timeout (no kill), the `{ success: false }` result is returned normally so
   the model can handle it gracefully.

   Returns `ToolResult`:
   ```ts
   { success: boolean; data?: unknown; error?: string;
     message?: string; endTurn?: boolean; imageMetadata?: … }
   ```

7. **Expression delivery**: a successful result carrying the private
   `ToolResult.stickerSelection` (only `select_sticker_for_response` sets it) is
   sent now by `deliverExpression` (`src/utils/chat/expressionDelivery.ts`), and
   the tool result is replaced by the delivery outcome before any later step reads
   it. Text the model wrote before the call is already posted, because the stream
   flushes pending text before it returns `function_call`.
   - The send is awaited outside the timeout and kill race, so the outcome is
     always known before history is built. The stop check runs once more
     immediately before each outbound POST, after webhook resolution and any
     avatar update; a stop there returns `{kind: "abort", status: "stopped_by_user"}`
     and nothing is posted.
   - Each persona turn allows one delivered expression through
     `ChatTurnContext.expressionDelivery`, shared by every tool-loop iteration,
     context restart, key rotation, and model fallback of that turn. Repeating the
     delivered expression returns `sticker_already_sent` without a send; a
     different one is refused and the first is never replaced. A definite refusal
     or a failed recheck leaves the allowance free for another attempt.
   - A send Discord never confirmed (a timeout or network failure) stays recorded
     as unconfirmed, and every later call in the turn is refused rather than risk
     a second visible copy. The REST client retries timeouts and 5xx responses on
     its own, so bot sends carry an enforced nonce that makes those retries return
     the first message. Webhook execution accepts no nonce, so webhook expressions
     go through `sendWebhookMessageOnce`, which makes a single attempt. A rate limit
     cannot duplicate, so this function waits and posts again within a shared
     30-second retry budget. It checks for a stop every 100 ms during waits and
     before every attempt. A delay beyond the remaining budget fails immediately
     with the expression allowance free. Stale-lock expiry is disabled while this
     delivery phase holds its watchdog exemption, so the retry budget bounds
     repeated rate-limit refusals.
   - Text this turn already delivered decides the identity, reusing the recorded
     webhook identity verbatim (including a sprite-decorated username). Before any
     text, the persona's `responseTarget` decides, never an earlier turn's speaker.
     The send is recorded in channel continuity, but never in
     `deliveredMessageRefs`, so a model fallback's superseded-message cleanup
     cannot delete it.
   - Accepted delivery records `sticker_used` (native, keyed by name) or
     `custom_expression_used` (keyed by stable id) once, and sets
     `responseDelivered`, so a sticker-only reply settles as `completed` rather
     than an empty response. The model sees only the sticker name and the
     outcome, never ids, links, or the media kind.

8. **`retainSuccessfulToolAffordance`**: on success, extends the deliberate-
   tool-mode affordance window for this channel so short follow-up turns
   ("do it again") keep the tool exposed for `deliberateToolContextTurns`
   additional turns. No-op when deliberate-tool-mode is inactive.

9. **Deliberate-trigger hidden notice**: if `deliberateToolTriggerMatchByToolName`
   has an entry for this tool and mode is active, sends a hidden embed via
   `routeHiddenToolNotice` (thought-log only; not shown to users) describing
   which trigger phrase caused deliberate mode to expose the tool.

10. **Enhanced-context restart check**: calls
   [`handleEnhancedContextRestart`](03-enhanced-context-restart.md)
   (`toolLoop.ts:537-568`) with `toolResult.data`. If it returns `true`,
   returns `{kind: "restart"}`.

11. **Reactivate one-shot STM guard**: a successful
   `update_short_term_memory` sets
   `streamingContext.disableShortTermMemoryUpdate = true`, so the tool's own
   availability and execution guards reject a second update in this turn.

12. **Build function response**: wraps `toolResult.data` (success) or a
   standardized error object (failure) into the `functionResponse` shape:
   ```ts
   { functionResponse: { name, response: { result: … } } }
   ```

13. **Preserve pre-tool text**: `buildPreToolCallTextParts` converts
    `streamResult.accumulatedText` (the visible text this stream iteration
    already delivered to Discord before the function call) into
    `preToolCallTextParts` on the history entry. Whitespace-only text yields
    `undefined`. Provider adapters merge these parts into the synthetic
    assistant tool-call turn on the follow-up call, so the model knows it
    already said that text and does not repeat it. Each iteration's entry
    carries only that iteration's text (stream state is fresh per
    `streamOnce` call). After the history entry is accepted, the outer loop
    clears the same text from `accumulatedModelParts`; otherwise OpenAI-style
    providers would also append it as a trailing assistant prefill.

14. **Return `{kind: "history"}`** with `historyEntry` (the paired
    `functionCall` + `functionResponse` + optional `imageMetadata` +
    optional `preToolCallTextParts`).

## Invariants

After this stage runs:

- A tool was dispatched at most once per call (the deliberate-mode synthetic
  failure and the truncated-argument refusal both short-circuit before
  `executeTool`).
- A call whose provider payload was truncated is never dispatched, and its
  recovered argument subset is never replayed to the model as the call it made.
- If `kind === "restart"` is returned, `functionHistory` will not receive
  an entry for this tool call; the restart mechanism replaces the tool
  response with enriched context.
- `consecutiveToolErrors` in the outer loop is reset to `0` on `success ===
  true` or `kind === "restart"`.
- If `/kill` fired during tool execution, `kind === "abort"` is returned
  immediately; no history entry is added and the model never sees the failed
  tool result.
- A tool timeout (no `/kill`) returns `kind === "history"` with
  `success: false`: the model is informed and can decide how to proceed.
- A queued follow-up never converts an in-progress tool chain into
  `stopped_by_user`; only a genuine stop does.
- At most one expression is delivered per persona turn, and an accepted one is
  never resent, replaced, or deleted by a later failure in the same turn.
- After a successful STM update, the live streaming context prevents another
  STM update in the same turn.
- Tool execution duration is logged at `INFO` level
  (`"Function call completed: ${name} (${ms}ms)"`).

## Extension points

| Surface | Plugin-relevance |
|---|---|
| `ToolRegistry.executeTool` | The tool registration contract is the seam: A plugin adding a new tool registers it with the `ToolRegistry`. → plugin plan candidate |
| Deliberate-tool-mode allowlist (`deliberateToolAllowedNames`) | Internal: controlled by `turnPlanner`; tool plugins declare their trigger patterns, not the gating logic |
| `ToolContext.abortSignal` | Tools that forward this to their `fetch` calls gain free cancellation on `/kill`. New tools should always thread it through. |
| `ToolContext` shape | The context contract: tools depend on its fields; adding a field here widens the contract for all tools |
| `retainSuccessfulToolAffordance` | Internal: deliberate-tool-mode retention window; operational parameter, not plugin-relevant |
| `handleEnhancedContextRestart` | See [stage 03](03-enhanced-context-restart.md): the `context_restart_*` namespace is the seam |

## Configuration

| Env var | Default | Minimum | Purpose |
|---|---|---|---|
| `TOOL_EXECUTION_TIMEOUT_MS` | `300000` (5 min) | `10000` (10 s) | Per-tool execution timeout; resets fresh for every tool call in a chain |

## Related docs

- Tool registry: → [`README.md`](README.md)
- Enhanced-context restart: → [stage 03: `handleEnhancedContextRestart`](03-enhanced-context-restart.md)
- Deliberate tool mode: → `src/utils/tools/deliberateToolMode.ts`
- Tool-loop coordinator: → [`README.md`](README.md)
