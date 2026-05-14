# Refactor Regression Audit (Phases 1–5)

Snapshot date: 2026-05-14
Branch audited: `refactor/plugin-architecture`
Companion doc: [`refactor-integrity-audit.md`](refactor-integrity-audit.md) (structural / facade audit)

## Purpose

This audit asks a different question than the structural integrity audit. Where the integrity audit asks *"did we actually split god files, or just rename them?"*, this audit asks:

> **For each function that was deleted during Phases 1–5, did its behavior survive somewhere — renamed, relocated, or inlined — or did it silently disappear?**

A behavioral regression here is narrowly defined: a function performed a real, observable behavior; the function was deleted; and no equivalent code (by name OR by inlined body) exists in the current tree. Pure dead-code removal, rename-only moves, and intentional consolidations are NOT regressions.

This audit was prompted by the Phase 5.5d chat-drain regressions documented in [`plans/refactor/phases/phase-5.5d-chat-drain.md`](../../plans/refactor/phases/phase-5.5d-chat-drain.md) ("Post-5.5d Verification & Follow-up Work" appendix). After that incident — where ~8 exported functions and ~41 private helpers vanished from `turnRunner.ts` without behavioral replacement — the project owner asked: *have any earlier phases hidden the same kind of regression?*

**Phase 5.5 is intentionally out of scope here.** Its regressions are already tracked in the Phase 5.5d plan.

## Method

For each phase commit:

1. `git diff <commit>^..<commit> --diff-filter=D --name-only` enumerated fully-deleted files.
2. `git diff <commit>^..<commit>` searched for `^-export `, `^-function `, `^-async function ` to find function definitions that vanished from surviving files.
3. Each candidate deletion was checked against current `src/` with Grep — first by function name (catches renames), then by a 1–2 distinctive identifiers from the old body (catches inlining: string literals, unique variable names, magic numbers, branching shape).
4. A finding is only a regression if BOTH the name AND the distinctive-body search come up empty in the current tree.

Type-only deletions, deleted tests, and locale-file shuffles in Phase 1 were skipped — they cannot encode runtime behavior worth auditing.

## Scope of phase commits

| Phase | Commit | Title | Audit verdict |
|---|---|---|---|
| 1 | `d9d284bb` | Phase 1: Locales, String Helpers, Index Entry Point | Clean |
| 2.1 | `9836d968` | Phase 2: Data Access (1/2) | Clean |
| 2.2 | `b3a3bd5f` | Phase 2: Data Access (2/2) | Clean |
| 3.1 | `aff0b537` | Phase 3: Core Abstractions & Integrations (1/2) | Clean |
| 3.2 | `7a631afb` | Phase 3: Core Abstractions & Integrations (2/2) | Clean |
| 4 | `643aaef1` | Phase 4: Context & Output | Clean |
| 5 | `44c975e0` | Phase 5: Orchestrator | Clean (caveat below) |

**Caveat on Phase 5:** Phase 5 moved `tomoriChat.ts` (~9,500 lines) into `src/utils/chat/turnRunner.ts` as a near-verbatim relocation. The function bodies survived intact at that commit. The behavioral regressions later catalogued in the Phase 5.5d appendix (typing-on-every-message, eight zero-caller exports, ~41 missing private helpers) were introduced by Phase 5.5d's *drain* of `turnRunner.ts`, not by Phase 5's *move* into it. Phase 5 is therefore clean by this audit's definition; the regressions blamed on "the refactor" are sub-phase-5.5d-specific.

---

## Phase 1 — Locales, String Helpers, Index Entry Point

**Commit:** `d9d284bb`
**Audited:** `src/utils/text/stringHelper.ts` deletions, `src/index.ts` decomposition into `src/init/*`, locale split (only insofar as it deleted runtime behavior — content fragmentation skipped).

### Confirmed regressions
None.

### Renamed / relocated (NOT regressions)
- `chunkMessage`, `cleanLLMOutput`, `replaceMentionHandles`, `normalizeCustomEmojisForLlm`, `findMarkdownCodeRanges`, `truncateBeforeGenericSpeakerLine`, `isGenericSpeakerStopLabel`, `escapeRegExp` → moved to `src/utils/text/processors/` (`chunkProcessor.ts`, `llmOutputProcessor.ts`, `mentionProcessor.ts`, `formatters.ts`). All caller sites import from the new paths.
- `index.ts` bootstrap split into `src/init/*` modules with each step (client construction, command/event registration, db init, cache priming) named after its responsibility.

### Intentional deletions
- Monolithic locale files — split per phase plan, content preserved.

---

## Phase 2.1 — Data Access (1/2)

**Commit:** `9836d968`
**Audited:** Repository class extraction (`src/utils/db/repositories/*`), command/timer/tool re-pointing to repository APIs.

### Confirmed regressions
None.

### Notes
Phase 2.1 was a pure adapter-layer insertion: queries previously called inline against `Bun.sql` were wrapped in `*Repository` classes with the same SQL bodies. Compile errors at every caller site forced exhaustive rewiring, so silent behavior loss is structurally unlikely here.

---

## Phase 2.2 — Data Access (2/2)

**Commit:** `b3a3bd5f`
**Audited:** Status command extraction, compact command extraction, channel LLM cache extraction.

### Confirmed regressions
None.

### Renamed / relocated (NOT regressions)
- Status command internals → `src/utils/metrics/statusCommandMetrics.ts` and `src/utils/metrics/status/command.ts`; `src/commands/tool/status.ts` delegates via `executeStatusCommand`.
- Compact command internals → `src/utils/compaction/compactOrchestrator.ts` and submodules; `src/commands/tool/compact.ts` delegates via `executeCompactCommand`.
- Channel LLM cache (`setChannelLlmCache`, `invalidateChannelLlmCache`, `getChannelLlmCacheSize`, `invalidateAllChannelLlmCacheForServer`) → `src/utils/cache/channelLlmCacheStore.ts`, re-exported from `src/utils/cache/channelLlmCache.ts`.

---

## Phase 3.1 — Core Abstractions & Integrations (1/2)

**Commit:** `aff0b537`
**Audited:** Stream adapter base-class introduction.

### Confirmed regressions
None.

### Renamed / relocated (NOT regressions)
- Stream adapter classes (`AnthropicStreamAdapter`, `GoogleStreamAdapter`, `NovelaiStreamAdapter`, `OpenAICompatibleStreamAdapter`, `OpenrouterStreamAdapter`, `VertexStreamAdapter`) refactored to extend `BaseStreamAdapter`. Methods that were duplicated across adapters were hoisted; provider-specific overrides remain in the subclasses.

---

## Phase 3.2 — Core Abstractions & Integrations (2/2)

**Commit:** `7a631afb`
**Audited:** `interactionHelper.ts` split into `src/utils/discord/ui/*`; Matrix bridge reorganization into `src/utils/bridges/matrix/*`.

### Confirmed regressions
None.

### Renamed / relocated (NOT regressions)
- `interactionHelper.ts` exports split across `src/utils/discord/ui/{buttons,confirmation,embeds,errors,modals,pagination,statusComponents,interactionCore}.ts`. The original `interactionHelper.ts` barrel re-exports the public surface.
- Matrix bridge (`src/utils/matrix/index.ts`) deleted; behavior moved to `src/utils/bridges/matrix/{rooms,userMapping,events,...}.ts`. All previous exports resolvable via the new module hierarchy.

---

## Phase 4 — Context & Output

**Commit:** `643aaef1`
**Audited:** `contextBuilder.ts` decomposition; stream orchestrator decomposition.

### Confirmed regressions
None.

### Renamed / relocated (NOT regressions)
- Internal context-building functions extracted from monolithic `src/utils/text/contextBuilder.ts` into `src/utils/text/context/{history,memories,rag,templates,types}.ts`. Public API preserved via the barrel — see the integrity audit's "Approved barrels" table for the boundary rationale.
- Stream orchestration helpers split into `src/utils/discord/stream/bufferManager.ts` and `src/utils/discord/stream/uiUpdater.ts` (and siblings).

---

## Phase 5 — Orchestrator

**Commit:** `44c975e0`
**Audited:** Move of ~9,293 lines from `src/events/messageCreate/tomoriChat.ts` into `src/utils/chat/turnRunner.ts` and surrounding stage seeds (`admission.ts`, `channelQueue.ts`, `triggerProcessor.ts`, `webhookIdentity.ts`, etc.).

### Confirmed regressions
None **as of commit `44c975e0`**.

### Important caveat
Phase 5 was a **relocation refactor**: the bulk of `tomoriChat.ts` was moved into `turnRunner.ts` as one large function set, retaining names and bodies. At this commit no behavior was lost; the relocation produced a god file (`turnRunner.ts`) rather than dropping any code.

The behavioral regressions popularly attributed to "the refactor" were introduced by **Phase 5.5d's drain** of `turnRunner.ts` into stage modules, not by Phase 5. Those regressions are tracked in [`phase-5.5d-chat-drain.md`](../../plans/refactor/phases/phase-5.5d-chat-drain.md) and are explicitly out of scope here.

### Renamed / relocated at commit `44c975e0` (NOT regressions)
- `tomoriChat.ts` reduced to a thin delegating entry point.
- Stage seed modules created under `src/utils/chat/`: `admission.ts`, `channelQueue.ts`, `triggerProcessor.ts` (autochat predicates: `getAutochatRange`, `isAutochatConfiguredChannel`, `isAutochatCounterHit`, `isMatrixRelayMessage`, `isRealUserLikeMessage`, `isSelfTriggerMessage`), `generationTurn.ts` (`providerIsApiFamily`), `responseEmitter.ts` (`shouldSendWebhookError`), `webhookIdentity.ts` (`normalizeIdentityName`).
- History truncation: `dropOldestHistoryExchangePairs` inlined into `src/utils/text/contextTruncator.ts` as `dropOldestDroppableHistoryExchange`.

### Minor maintenance issue (NOT a regression)
- `parseIntegerEnvFlag` / `parseBooleanEnvFlag` were duplicated across `channelQueue.ts`, `responseEmitter.ts`, and `toolLoop.ts` during the drain. This is code duplication, not behavior loss — flag a follow-up to consolidate into a shared util when convenient.

---

## Summary

| Phase | Commits | Confirmed regressions | Notes |
|---|---|---:|---|
| 1 | `d9d284bb` | 0 | Pure relocation; locale split structural only. |
| 2 | `9836d968`, `b3a3bd5f` | 0 | Repository pattern insertion forced caller rewiring; low silent-loss risk. |
| 3 | `aff0b537`, `7a631afb` | 0 | Adapter base-class hoist + Matrix reorganization. |
| 4 | `643aaef1` | 0 | Context-builder split behind public barrel. |
| 5 | `44c975e0` | 0 | Relocation only; regressions came in 5.5d's drain, tracked separately. |

**Total Phase 1–5 behavioral regressions:** 0.

## Why this audit came up clean (and where to keep watching)

Phases 1–5 share a property that made silent behavior loss unlikely:

- **They were predominantly relocation refactors.** Files were deleted and recreated under new paths, but the function set inside was substantively the same. Import-site rewrites force compile errors at every caller, which surfaces missing functions immediately.

Phase 5.5d broke that pattern: it was a **reshape refactor**. It didn't move `runChatTurn()` to a new file — it dissolved it into named stages (`evaluateChatAdmission`, `planChatTurns`, `runGenerationTurn`, `runPostTurnEffects`) with different signatures and control flow. There was no 1:1 import rewrite to force errors; pieces of the old function body could be quietly dropped while the file still compiled and the regression harness still passed.

**Operational takeaway for future phases:**

- Relocation refactors (move file, keep function set) — low risk, structural audit sufficient.
- Reshape refactors (dissolve function into new control flow) — high risk, require a per-function before/after diff audit AND lifecycle/state-mutation fixtures, not just pure-function fixtures. Phase 5.5d's appendix proposes exactly such a contract for any future drain work; treat it as the template.

## Forward-looking risk: remaining phases

| Phase | Pattern | Regression risk | Required gate |
|---|---|---|---|
| **5.5e** db-folder-consolidation | Relocation (fold orphan modules into Repository classes, drop the `repositories/index.ts` free-function shim) | **Low.** Compile errors at every caller force exhaustive rewiring, same as Phases 1–4. | Structural audit (`checkRefactorIntegrity.ts --strict` + `bun run check`) is sufficient. Watch only for: signature changes when free functions become `this.`-bound methods, and stale free-function imports surviving the `index.ts` shim deletion. |
| **Phase 6** schema-normalization | **Reshape.** Splits `tomori_configs` into 12 tables, drops the `is_alter ? alter_triggers : trigger_words` ternary from 10+ readers, migrates user-personalization columns out of `users`. | **High — same shape as 5.5d.** The Repository abstraction hides SQL changes from callers, so there is no compile-error tripwire when reader logic is forgotten. | Behavior-preservation contract required (see [`phase-6-schema-normalization.md`](../../plans/refactor/phases/phase-6-schema-normalization.md) preamble): per-reader before/after verdicts, zero-caller method check, export/import round-trip + repository-method-body diff, lifecycle fixtures. |
| **Phase 7** localized cleanups | Localized surgeries (logger/DB circular dep, swallowed promises, sync I/O) | **Low.** Each task is bounded and the intent is behavior-flagged (#18 explicitly hunts behavior-swallowing patterns). | Standard quality gates. Special watch on #17: replacing `console.log` with the real logger could surface previously-hidden errors — that is a fix, not a regression, but it may *look* like new failures appeared. |

The single high-risk reshape ahead is Phase 6. Phase 5.5e and Phase 7 are structurally safer.

## Re-running this audit

The method above is mechanical enough to re-run before any future merge into `refactor/plugin-architecture` that deletes >100 lines from `src/utils/`:

1. `git diff <merge-base>..HEAD --diff-filter=D --name-only` — list deleted files.
2. `git diff <merge-base>..HEAD | grep -E '^-(export |async function |function )'` — list vanished function defs from surviving files.
3. For each, `Grep` the current tree by name, then by distinctive body identifier.
4. File a row above for each confirmed regression.

If a future phase is a reshape (not a relocation), this audit method is insufficient on its own — pair it with the diff-based behavior audit described in the Phase 5.5d appendix.
