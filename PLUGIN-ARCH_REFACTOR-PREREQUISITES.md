# Plugin Architecture: Refactor Prerequisites

**This document has been split.** The canonical plan now lives at [`plans/refactor/README.md`](plans/refactor/README.md).

## Why the split

The original single-file plan (~1,098 lines) was bundling all phases — past, present, and future — into one context surface. Two problems:

1. **Cheating-by-borrowing.** An agent reading the whole file could borrow Phase 6 vocabulary (e.g., "repositories", "junction tables") to make Phase 5 work look richer than it was. This is one of the failure modes that produced the facade-only refactors that Phase 5.5 now exists to undo.
2. **Context bloat.** Agents working on Phase 6 had no reason to load Phase 1 history; agents working on Phase 5.5d had no reason to load Phase 7.

The split lets the [agent prompt template](plans/refactor/prompts/agent-phase-template.md) require an agent to read only the phase doc + declared prerequisites + shared rules — making cross-phase scope creep structurally harder.

## Where to go

- **Phase index, status, dependency graph:** [`plans/refactor/README.md`](plans/refactor/README.md)
- **Per-phase docs:** [`plans/refactor/phases/`](plans/refactor/phases/)
- **Shared rules (docs alignment, ongoing practices, open decisions, risks):** [`plans/refactor/shared/`](plans/refactor/shared/)
- **Agent prompt template:** [`plans/refactor/prompts/agent-phase-template.md`](plans/refactor/prompts/agent-phase-template.md)
- **Refactor integrity audit (Phase 5.5 inventory):** [`docs/refactor/refactor-integrity-audit.md`](docs/refactor/refactor-integrity-audit.md)

## Phase 5.5 was also split internally

Phase 5.5 (refactor integrity pass) was a single mega-phase in the original plan. It is now four independently-shippable sub-phases:

- [**5.5a** Legacy-file elimination](plans/refactor/phases/phase-5.5a-legacy-elimination.md) — `*.legacy.ts` deletion + `stringHelper.ts` orphan cleanup
- [**5.5b** DB SQL domain split](plans/refactor/phases/phase-5.5b-db-sql-split.md) — `repositoryReadSql.ts` + `repositoryWriteSql.ts` → domain modules
- [**5.5c** Subsystem decomposition](plans/refactor/phases/phase-5.5c-subsystem-decomposition.md) — status, compact, matrix, contextBuilder, streamOrchestrator
- [**5.5d** Chat god-file drain](plans/refactor/phases/phase-5.5d-chat-drain.md) — `turnRunner.ts` → 8 named stage owners

See [`plans/refactor/phases/phase-5.5-overview.md`](plans/refactor/phases/phase-5.5-overview.md) for the rationale, success definition, and shared audit gate.
