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
| #2 Simplify `stringHelper.ts` | Deleted in Phase 5.5a | Processor modules under `src/utils/text/processors/`; markdown-table helpers under `src/utils/text/markdownTable.ts` | Complete | Text processors | Import sites now reference the owning processor modules directly. |
| #3 Decouple `index.ts` | `src/index.ts`, 24 lines | `src/init/*` modules | Real split | Startup initialization | No Phase 5.5 action. |
| #4b Repository pattern | Repository classes under `src/utils/db/repositories/`; `repositoryReadSql.ts` 7-line barrel; `repositoryWriteSql.ts` 6-line barrel | Domain SQL lives in `src/utils/db/repositories/*Sql.ts`; large LLM/persona/server transaction modules are tracked below | Real domain split with tracked compatibility barrels | Repository-owned SQL by domain | Delete compatibility barrels in Phase 6 cleanup after downstream import stability is confirmed. |
| #5 `/tool status` split | `src/commands/tool/status.ts`, 32 lines; `src/utils/metrics/status/command.ts`, 73 lines | Deleted `statusCommandMetrics.ts` and `status/commandImplementation.ts`; owned modules under `src/utils/metrics/status/` are all <600 lines | Complete | Status command coordination, page builders, and redaction-aware formatters | No remaining status facade. Audit criterion used: delete the old barrel because it had 1 import site and callers know the command coordinator directly. |
| #5 `/tool compact` split | `src/commands/tool/compact.ts`, 33 lines | `src/utils/compaction/compactOrchestrator.ts`, 1,102 lines | Facade-only split | Compaction workflow stages | Split modal parsing, history/media extraction, summary generation, preview rendering, and persistence. |
| #6 Base stream adapter | Provider adapters and `BaseStreamAdapter` | Provider-specific large files remain provider-owned | No facade finding | Provider stream adapters | No Phase 5.5 action unless a provider adapter starts mixing unrelated responsibilities. |
| #6.5 Provider registry | `src/utils/provider/providerInfoRegistry.ts` and provider-local `providerInfo.ts` files | None identified | Real split | Provider metadata discovery | No Phase 5.5 action. |
| #7 Tool registry split | `src/tools/toolRegistry.ts`, 514 lines | `src/tools/availability.ts`, 387 lines | Real partial split | Tool registry vs. availability | No immediate facade action. Continue future tool execution decomposition only if needed. |
| #8 Discord UI helpers | `src/utils/discord/interactionHelper.ts`, 1 line; owned modules under `src/utils/discord/ui/` | `src/utils/discord/ui/interactionCore.ts` retains shared Discord UI internals after legacy-file deletion | Legacy file eliminated | Discord UI flows | Continue future extraction from shared internals when touching confirmation, modal, status, generic pagination, or persona pagination behavior. |
| #8 Webhook helpers | `src/utils/discord/webhookManager.ts`, 1 line; owned modules under `src/utils/discord/webhook/` | `src/utils/discord/webhook/webhookCore.ts` retains shared webhook internals after legacy-file deletion | Legacy file eliminated | Webhook lifecycle, identity, dispatch, fallback | Continue future extraction from shared internals when touching webhook lifecycle, identity, dispatch, fallback, or cache behavior. |
| #9 Matrix bridge | `matrixManager.ts`, 9 lines; public responsibility files mostly thin | `src/utils/bridges/matrix/runtime.ts`, 1,405 lines | Facade-only split | Matrix client, events, rooms, state sync, user mapping, media | Split runtime into real responsibility modules; shrink `runtime.ts` to a compatibility barrel or delete it. |
| #10 Context builder | `contextBuilder.ts`, 5 lines; owned modules under `src/utils/text/context/` are all <600 lines | Deleted `context/core/builderImplementation.ts` | Complete | Context assembly pipeline | Preserved `contextBuilder.ts` as the public API boundary because callers consume context assembly as one capability; audit keep criterion met with 11 import sites. |
| #11 Stream orchestrator | `streamOrchestrator.ts`, 1 line; owned modules under `src/utils/discord/stream/` are all <600 lines | Deleted `stream/core/orchestratorImplementation.ts` | Complete | Stream state machine, stop registry, buffer flushing, segment processing, message delivery, UI updates, and thought logs | Preserved `streamOrchestrator.ts` as the public API boundary because callers consume streaming as one capability; audit keep criterion met with 15 import sites. |
| #12b / #12c / 5.5d Chat | `tomoriChat.ts`, ~145 lines; stage modules under `src/utils/chat/` own distinct chat-stage responsibilities | Deleted `turnRunner.ts`; chat implementation lives in `admission.ts`, `admissionQueue.ts`, `channelQueue.ts`, `turnPlanner.ts`, `contextPipeline.ts`, `contextAnnotations.ts`, `contextEmbeds.ts`, `contextMedia.ts`, `generationTurn.ts`, `toolLoop.ts`, `responseEmitter.ts`, `postTurnEffects.ts`, and small queue/identity helpers | **Complete** | Chat admission, queueing, turn planning, context, provider turn, tool loop, response, post-turn effects | Coordinator exposes the target stage sequence; response delivery passes through a sink. Post-5.5d behavioral verification restored the pre-lock trigger gate, rewired the zero-caller exports, audited old helper preservation, and added lifecycle/provider fixtures. See `plans/refactor/phases/phase-5.5d-chat-drain.md` "Post-5.5d Verification" appendix. |
| #13 Event handler eager-load | Not completed in this snapshot | N/A | Out of scope | Event loading | Do after Phase 5.5 if still useful. |

## Chat Coordinator Finding

The current chat entrypoint exposes the expected stage narrative:

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

`turnRunner.ts` has been deleted, and response delivery is represented as a response sink used during generation because Discord streaming happens while the provider turn is running.

## Intentional Large File Rule

A large file can remain only when all of these are true:

- it owns one clear responsibility
- its public surface is narrow and named after that responsibility
- it has focused regression or smoke coverage
- the audit table records why splitting it would make the code worse

| Path | Lines | Responsibility | Rationale | Follow-up |
|---|---:|---|---|---|
| `src/utils/db/repositories/llmReadSql.ts` | 2,078 | LLM/provider/custom-endpoint read SQL | Model catalog, OpenRouter scope filtering, provider config reads, override reads, and custom endpoint reads share fallback resolution and model-row validation. A read/write split is already applied; further splitting should happen with Phase 6 schema table ownership changes to avoid scattering OpenRouter scope behavior prematurely. | Revisit during Phase 6 provider-table cleanup. |
| `src/utils/db/repositories/llmWriteSql.ts` | 1,204 | LLM/provider/custom-endpoint write SQL | Channel/persona override restoration, saved provider config writes, custom endpoint writes, and OpenRouter registration writes share validation and restore semantics. Keeping write-side provider mutation SQL together preserves the cache-invalidation boundary exposed by `LlmRepository`. | Revisit during Phase 6 provider-table cleanup. |
| `src/utils/db/repositories/personaReadSql.ts` | 686 | Persona state loading SQL | `loadTomoriState` and `loadAllPersonasForServer` intentionally stay together because both construct the same composite persona runtime state from tomori rows, config, memory, rotation keys, NAI presets, and fallback model references. | Split only if Phase 6 separates runtime state from config tables. |
| `src/utils/db/repositories/serverWriteSql.ts` | 873 | Server setup, reminder, and random-trigger write SQL | `setupServer` is one atomic transaction that creates server, persona, config, and initial emoji rows; reminder and random-trigger writes share scheduled-work nudge behavior. Splitting before Phase 6 table ownership changes would separate transactional setup context from its server repository owner. | Revisit after Phase 6 server/persona table partitioning. |

## Intentional Barrel Rule

A barrel/shim file (≤120 lines whose body is mostly `export * from ...` or thin re-export blocks) can remain only when **one** of these is true:

1. **Deliberate subsystem public-API boundary.** The barrel defines the named, narrow surface that callers outside the subsystem are expected to import from. The audit table records the boundary, the consumers it serves, and why direct imports into internals are discouraged.
2. **Tracked migration shim.** The barrel exists to defer an import rewrite. The audit table records (a) the target phase or subtask that deletes it, and (b) a rough import-site count so the deletion isn't open-ended.

A barrel is **never** acceptable when any of these is true:

- it delegates to a `.legacy.ts` file (active legacy implementation behind a fresh-looking name is the facade-only pattern Phase 5.5 exists to eliminate)
- it delegates to a single same-purpose implementation file that is materially larger than the barrel itself (the implementation file is the real owner; the barrel is camouflage)
- it has no entry in this audit doc (untracked barrels rot in place)

### Decision criteria — when a refactor leaves a thin facade, keep or delete?

When you split a god file `foo.ts` into named-responsibility modules (`fooA.ts`, `fooB.ts`, `fooC.ts`), the original `foo.ts` location can either become a thin re-export barrel, or be deleted entirely. Use these criteria to decide — agents should NOT default to "either is fine."

**Keep `foo.ts` as a barrel (and add it to the Approved barrels table)** when ALL of these are true:

- The split modules are conceptually consumed *as a unit* — most callers want "the foo capability," not a specific sub-module
- The internal split is an implementation detail callers shouldn't depend on (you might re-split `fooA`/`fooB` later without breaking consumers)
- The barrel marks a stable subsystem boundary (e.g., the chat layer treats "context building" or "stream orchestration" as one capability)
- ≥3 distinct call sites currently import from `foo.ts`

**Delete `foo.ts` entirely** when ANY of these is true:

- Each split module has a distinct purpose and callers know exactly which one they want (e.g., `cooldownRead.ts` vs. `cooldownWrite.ts` — no caller wants "cooldown" as one bag)
- ≤2 call sites import from `foo.ts`, and rewriting them is cheap
- The barrel is leftover migration scaffolding and removing it forces consumers to be specific (which is a feature, not a bug)
- Keeping the barrel would tempt future contributors to dump unrelated re-exports into it

**Heuristic when the criteria conflict:** if the named modules each address a distinct concern that callers reason about separately, **delete** — favor explicit imports. If the named modules collectively implement one capability that callers think of as one thing, **keep** — favor a stable public boundary.

### Facade-rename smell (mandatory check)

A barrel that delegates to a sibling file matching `**/core/*Implementation.ts`, `**/internals/*.ts`, `**/_impl/*.ts`, or any other "internals dumping ground" name where the sibling file is itself >600 lines is the facade-rename anti-pattern: the original god file was just `mv`'d into a subfolder with a generic name. This is **never** acceptable, even with an Approved barrels entry, because the work the audit doc exists to enforce hasn't actually happened.

If you find yourself wanting to create such a sibling, the right move is to split the sibling's contents into named-responsibility modules (`fooHistory.ts`, `fooMemories.ts`, etc.) and have the barrel re-export from those instead. The `core/*Implementation.ts` pattern is detected by the audit script (see "Local Check" above).

`bun run scripts/maintenance/checkRefactorIntegrity.ts --strict` flags facade-shaped barrels via `thin facade to large file` and `thin facade to legacy file`. Allowlisting a barrel means adding it to the table below with rationale, not silencing the script.

### Approved barrels

| Path | Lines | Kind | Rationale | Deletion phase (if shim) |
|---|---:|---|---|---|
| `src/utils/db/repositoryReadSql.ts` | 7 | Migration shim | Phase 5.5b - preserved as a compatibility surface for downstream/internal branches still importing the former read SQL module; current repo import-site count is 0. | **Phase 6 cleanup** |
| `src/utils/db/repositoryWriteSql.ts` | 6 | Migration shim | Phase 5.5b - preserved as a compatibility surface for downstream/internal branches still importing the former write SQL module; current repo import-site count is 0. | **Phase 6 cleanup** |
| `src/utils/text/contextBuilder.ts` | 5 | Public API boundary | Phase 5.5c - callers consume context building as one subsystem capability while mention normalization, preset routing, native assembly, memories, RAG, server assets, participants, and dialogue history live in responsibility-owned modules; current repo import-site count is 11. | N/A |
| `src/utils/discord/streamOrchestrator.ts` | 1 | Public API boundary | Phase 5.5c - callers consume Discord streaming as one subsystem capability while stop requests, buffer flushing, segment processing, message delivery, UI updates, errors, text config, mention resolution, and thought logs live in responsibility-owned modules; current repo import-site count is 15. | N/A |

Any barrel not in this table that the audit script flags is a refactor regression. Resolve by either deleting the barrel or filing a justified row before merging.
