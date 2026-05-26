<!-- ARCH-ALIGNMENT: prereq-phase-5.5d -->

# Stage 02 — `executeToolCall`

Validate, gate, dispatch, and record one tool call from the provider.

**File:** `src/utils/chat/toolLoop.ts:197-331`

## Mission

Given a `function_call` stream result, run the named tool and return a
discriminated outcome that tells the outer loop whether to restart (context was
enriched), abort (fatal condition), or append a history entry and continue.

The stage enforces the deliberate-tool-mode allowlist before reaching the
registry, retains the affordance window on success, emits a hidden trigger
notice when a deliberate-mode trigger matched, and delegates context-enrichment
restarts to
[stage 03 — `handleEnhancedContextRestart`](03-enhanced-context-restart.md).

## Input

- `params: ToolLoopParams` — full loop context.
- `streamResult: StreamResult` — the `function_call` result from stage 01;
  `streamResult.data` carries the raw function-call payload.
- `iteration: number` — current loop iteration index (used to set
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
    historyEntry: ToolHistoryEntry;
  }
```

- **`"restart"`** — `handleEnhancedContextRestart` consumed the result; the
  outer loop does `continue` without pushing to `functionHistory`.
- **`"abort"`** — a fatal condition was hit (malformed call, stop request,
  consecutive error cap); outer loop calls `buildResult(status)` immediately.
- **`"history"`** — normal outcome; outer loop pushes `historyEntry` to
  `functionHistory` and checks `endTurn` / `shouldEndAfterPreToolText`.

## Side effects

Steps in execution order:

1. **Validate function-call data** — if `streamResult.data` is missing or has
   no `name`, returns `{kind: "abort", status: "error"}` and logs the
   malformed result.

2. **Stop-request check** — calls
   `StreamOrchestrator.hasStopRequest(params.context.channel.id)`. If a stop
   is pending, returns `{kind: "abort", status: "stopped_by_user"}` before any
   tool runs.

3. **Build `ToolContext`** — assembles the context object passed to every tool.
   Key fields derived from `ChatTurnContext`:
   - `channel`, `client`, `message`, `userId`, `guildId`
   - `tomoriState`, `locale`, `provider` (provider name string)
   - `streamContext` (the live `StreamingContext`)
   - `webhook`, `personaUsername`, `personaAvatarUrl` (from `responseTarget`)
   - `activePersonaId`, `isUserImpersonation`, `impersonatedUserId`
   - `suppressProgressNotices` — set when `shouldSurfaceUserErrors` is false
   - `contextItems`, `messageIdMap` — live references (tools may read these)
   - `showKillHint` — true once `iteration >= SOFT_WARN_ITERATION_THRESHOLD`

4. **Deliberate-tool-mode allowlist gate** — if
   `context.deliberateToolModeActive` is true and `deliberateToolAllowedNames`
   is set and the requested tool is not in the allowed set, the tool is *not*
   dispatched. A synthetic failure response is produced instead:
   ```
   { status: "blocked_by_deliberate_tool_mode", functionName, allowedToolNames }
   ```
   This is model-visible (returned as a tool response) so the model can adapt
   its next turn without a user-facing error.

5. **`ToolRegistry.executeTool(functionName, args, toolContext)`** — actual
   dispatch. See `src/tools/toolRegistry.ts:216`. Returns `ToolResult`:
   ```ts
   { success: boolean; data?: unknown; error?: string;
     message?: string; endTurn?: boolean; imageMetadata?: … }
   ```

6. **`retainSuccessfulToolAffordance`** — on success, extends the deliberate-
   tool-mode affordance window for this channel so short follow-up turns
   ("do it again") keep the tool exposed for `deliberateToolContextTurns`
   additional turns. No-op when deliberate-tool-mode is inactive.

7. **Deliberate-trigger hidden notice** — if `deliberateToolTriggerMatchByToolName`
   has an entry for this tool and mode is active, sends a hidden embed via
   `routeHiddenToolNotice` (thought-log only; not shown to users) describing
   which trigger phrase caused deliberate mode to expose the tool.

8. **Enhanced-context restart check** — calls
   [`handleEnhancedContextRestart`](03-enhanced-context-restart.md)
   (`toolLoop.ts:333-364`) with `toolResult.data`. If it returns `true`,
   returns `{kind: "restart"}`.

9. **Build function response** — wraps `toolResult.data` (success) or a
   standardized error object (failure) into the `functionResponse` shape:
   ```ts
   { functionResponse: { name, response: { result: … } } }
   ```

10. **Return `{kind: "history"}`** with `historyEntry` (the paired
    `functionCall` + `functionResponse` + optional `imageMetadata`).

## Invariants

After this stage runs:

- A tool was dispatched at most once per call (the deliberate-mode synthetic
  failure short-circuits before `executeTool`).
- If `kind === "restart"` is returned, `functionHistory` will **not** receive
  an entry for this tool call — the restart mechanism replaces the tool
  response with enriched context.
- `consecutiveToolErrors` in the outer loop is reset to `0` on `success ===
  true` or `kind === "restart"`.
- Tool execution duration is logged at `INFO` level
  (`"Function call completed: ${name} (${ms}ms)"`).

## Extension points

| Surface | Plugin-relevance |
|---|---|
| `ToolRegistry.executeTool` | The tool registration contract is the seam — A plugin adding a new tool registers it with the `ToolRegistry`. → plugin plan candidate |
| Deliberate-tool-mode allowlist (`deliberateToolAllowedNames`) | Internal — controlled by `turnPlanner`; tool plugins declare their trigger patterns, not the gating logic |
| `ToolContext` shape | The context contract — tools depend on its fields; adding a field here widens the contract for all tools |
| `retainSuccessfulToolAffordance` | Internal — deliberate-tool-mode retention window; operational parameter, not plugin-relevant |
| `handleEnhancedContextRestart` | See [stage 03](03-enhanced-context-restart.md) — the `context_restart_*` namespace is the seam |

## Related docs

- Tool registry: → `docs/systems/tool-system.md` <!-- TBD-XREF:legacy -->
- Enhanced-context restart: → [stage 03 — `handleEnhancedContextRestart`](03-enhanced-context-restart.md)
- Deliberate tool mode: → `src/utils/tools/deliberateToolMode.ts`
- Tool-loop coordinator: → [`README.md`](README.md)
