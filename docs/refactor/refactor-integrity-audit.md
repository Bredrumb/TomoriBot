# Refactor Integrity Audit

Snapshot date: 2026-05-13

Line counts below use the local audit script's physical-line count, including blank lines.

This audit records which completed refactor phases produced real responsibility-owned modules, and which produced a thin facade over a new god file. It is the working inventory for Phase 5.5 in `PLUGIN-ARCH_REFACTOR-PREREQUISITES.md`.

## Local Check

Run the lightweight facade scan with:

```bash
bun run audit-refactor-integrity
```

For CI or pre-merge blocking, use:

```bash
bun run scripts/maintenance/checkRefactorIntegrity.ts --strict
```

The script flags:

- thin files that delegate to much larger implementation files
- active `*.legacy.ts` files
- oversized `runtime.ts`, `orchestrator.ts`, and `turnRunner.ts` files
- new submodules that mostly re-export from a legacy or runtime implementation

The script is a guardrail, not a complete architectural proof. Reviewers still need to compare the findings against the table below.

## Inventory

| Phase item | Current surface | Hidden or remaining implementation | Status | Owner / responsibility | Follow-up action |
|---|---:|---:|---|---|---|
| #1 Fragment locales | `src/locales/en-US/` 36 files, 6,184 lines; `src/locales/ja/` 36 files, 6,195 lines | None identified | Real split | Locale categories | No Phase 5.5 action. Keep `check-locales` green. |
| #2 Simplify `stringHelper.ts` | `src/utils/text/stringHelper.ts`, 12 lines | Processor modules under `src/utils/text/processors/` | Acceptable compatibility barrel | Text processors | No Phase 5.5 action from this audit. This is not a gold-standard coordinator example. |
| #3 Decouple `index.ts` | `src/index.ts`, 24 lines | `src/init/*` modules | Real split | Startup initialization | No Phase 5.5 action. |
| #4b Repository pattern | Repository classes under `src/utils/db/repositories/` | `repositoryReadSql.ts`, 3,803 lines; `repositoryWriteSql.ts`, 2,931 lines | Partial / facade risk | Repository-owned SQL by domain | Split read/write SQL into domain-owned repository modules, then shrink/delete the compatibility SQL files. |
| #5 `/tool status` split | `src/commands/tool/status.ts`, 32 lines | `src/utils/metrics/statusCommandMetrics.ts`, 2,131 lines | Facade-only split | Status collectors and renderers | Split collectors, formatters, page/render helpers, and command orchestration. |
| #5 `/tool compact` split | `src/commands/tool/compact.ts`, 33 lines | `src/utils/compaction/compactOrchestrator.ts`, 1,102 lines | Facade-only split | Compaction workflow stages | Split modal parsing, history/media extraction, summary generation, preview rendering, and persistence. |
| #6 Base stream adapter | Provider adapters and `BaseStreamAdapter` | Provider-specific large files remain provider-owned | No facade finding | Provider stream adapters | No Phase 5.5 action unless a provider adapter starts mixing unrelated responsibilities. |
| #6.5 Provider registry | `src/utils/provider/providerInfoRegistry.ts` and provider-local `providerInfo.ts` files | None identified | Real split | Provider metadata discovery | No Phase 5.5 action. |
| #7 Tool registry split | `src/tools/toolRegistry.ts`, 514 lines | `src/tools/availability.ts`, 387 lines | Real partial split | Tool registry vs. availability | No immediate facade action. Continue future tool execution decomposition only if needed. |
| #8 Discord UI helpers | `src/utils/discord/interactionHelper.ts`, 1 line; `src/utils/discord/ui/` mostly thin wrappers | `interactionHelper.legacy.ts`, 2,742 lines | Facade-only split | Discord UI flows | Move confirmation, modal, status component, generic pagination, and persona pagination implementation into owned modules; delete legacy file. |
| #8 Webhook helpers | `src/utils/discord/webhookManager.ts`, 1 line; `src/utils/discord/webhook/` mostly thin wrappers | `webhookManager.legacy.ts`, 1,281 lines | Facade-only split | Webhook lifecycle, identity, dispatch, fallback | Move active implementation into owned webhook modules; delete legacy file after import migration. |
| #9 Matrix bridge | `matrixManager.ts`, 9 lines; public responsibility files mostly thin | `src/utils/bridges/matrix/runtime.ts`, 1,405 lines | Facade-only split | Matrix client, events, rooms, state sync, user mapping, media | Split runtime into real responsibility modules; shrink `runtime.ts` to a compatibility barrel or delete it. |
| #10 Context builder | `contextBuilder.ts`, 1,998 lines; `src/utils/text/context/` partial modules | Major context assembly logic still inline | Partial split | Context assembly pipeline | Re-audit remaining inline responsibilities and move mention/link normalization, history shaping, media attribution, memory/RAG/template assembly, and preset reassembly where appropriate. |
| #11 Stream orchestrator | `streamOrchestrator.ts`, 1,995 lines; `src/utils/discord/stream/` partial modules | Major stream state and delivery logic still inline | Partial split | Stream state machine | Move stop handling, thought-log assembly, markdown-table attachments, buffer flushing, and Discord UI delivery where appropriate. |
| #12b / #12c Chat | `tomoriChat.ts`, 88 lines; `admission.ts`, 248 lines; `channelQueue.ts`, 299 lines | `turnRunner.ts`, 7,856 lines | Incomplete; current entrypoint is not the target coordinator | Chat admission, queueing, context, provider turn, tool loop, response, post-turn effects | Keep #12c open. `tomoriChat.ts` still does `createChatInvocation()` then `runChatTurn()`, not the stage-shaped coordinator. Drain `turnRunner.ts` into the planned modules. |
| #13 Event handler eager-load | Not completed in this snapshot | N/A | Out of scope | Event loading | Do after Phase 5.5 if still useful. |

## Chat Coordinator Finding

The current chat entrypoint is not the expected shape:

```ts
const invocation = createChatInvocation(...);
await runChatTurn(invocation);
```

The expected shape remains:

```ts
const incoming = normalizeChatInvocation(...);
const admission = await evaluateChatAdmission(incoming);
if (admission.disposition !== "run") {
  await handleChatDisposition(admission);
  return;
}

await runWithChannelLock(admission, async (lockedTurn) => {
  const turnPlan = await planChatTurns(lockedTurn);

  for (const turn of turnPlan.turns) {
    const context = await buildChatTurnContext(turn);
    const responseSink = createChatResponseSink(context);
    const result = await runGenerationTurn(context, responseSink);

    await runPostTurnEffects(context, result);
  }
});
```

Do not mark #12c complete until the event file exposes this stage narrative and `turnRunner.ts` is either deleted or reduced to glue. Response delivery must be represented as a response sink used during generation because Discord streaming happens while the provider turn is running.

## Intentional Large File Rule

A large file can remain only when all of these are true:

- it owns one clear responsibility
- its public surface is narrow and named after that responsibility
- it has focused regression or smoke coverage
- the audit table records why splitting it would make the code worse

No currently flagged Phase 5.5 file is approved as intentionally large.

## Intentional Barrel Rule

A barrel/shim file (≤120 lines whose body is mostly `export * from ...` or thin re-export blocks) can remain only when **one** of these is true:

1. **Deliberate subsystem public-API boundary.** The barrel defines the named, narrow surface that callers outside the subsystem are expected to import from. The audit table records the boundary, the consumers it serves, and why direct imports into internals are discouraged.
2. **Tracked migration shim.** The barrel exists to defer an import rewrite. The audit table records (a) the target phase or subtask that deletes it, and (b) a rough import-site count so the deletion isn't open-ended.

A barrel is **never** acceptable when any of these is true:

- it delegates to a `.legacy.ts` file (active legacy implementation behind a fresh-looking name is the facade-only pattern Phase 5.5 exists to eliminate)
- it delegates to a single same-purpose implementation file that is materially larger than the barrel itself (the implementation file is the real owner; the barrel is camouflage)
- it has no entry in this audit doc (untracked barrels rot in place)

`bun run scripts/maintenance/checkRefactorIntegrity.ts --strict` flags facade-shaped barrels via `thin facade to large file` and `thin facade to legacy file`. Allowlisting a barrel means adding it to the table below with rationale, not silencing the script.

### Approved barrels

| Path | Lines | Kind | Rationale | Deletion phase (if shim) |
|---|---:|---|---|---|
| `src/utils/text/stringHelper.ts` | 12 | Migration shim | Phase 1 #2 / OD-R-7 — preserved to avoid a 200-file import rewrite landing inside the Phase 1 PR | **Phase 5.5 (orphan barrel cleanup subtask)** |

Any barrel not in this table that the audit script flags is a refactor regression. Resolve by either deleting the barrel or filing a justified row before merging.
