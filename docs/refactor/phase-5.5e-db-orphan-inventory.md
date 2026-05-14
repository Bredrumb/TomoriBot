# Phase 5.5e — DB Root Orphan Inventory & Classification

**Status:** Inventory produced. Decisions below resolve every conditional left open in [`phase-5.5e-db-folder-consolidation.md`](../../plans/refactor/phases/phase-5.5e-db-folder-consolidation.md).

**Scope:** Every `.ts` file currently at `src/utils/db/` root (26 files total) is enumerated and classified. No file is unaccounted for.

---

## End-state folder structure

```
src/utils/db/
├── client.ts                          # infrastructure
├── initializeDatabase.ts              # infrastructure
├── sqlSecurity.ts                     # infrastructure
├── sqlSplitter.ts                     # infrastructure
├── ragAvailability.ts                 # renamed from ragDetection.ts
└── repositories/
    ├── index.ts                       # ≤50 lines: instances + types only
    ├── IRepository.ts
    ├── ServerRepository.ts            # + emojiStickerSync + managedWebhookDb
    ├── UserRepository.ts              # + personalSpotlight
    ├── PersonaRepository.ts           # + persona-scoped memoryLimits checks
    ├── ConfigRepository.ts
    ├── LlmRepository.ts
    ├── ToolRepository.ts              # + guildMcpDb
    ├── RagRepository.ts
    ├── ImportExportRepository.ts
    ├── PersonalMemoryRepository.ts    # + checkPersonalMemoryLimit
    ├── ServerMemoryRepository.ts      # + checkServerMemoryLimit
    ├── ShortTermMemoryRepository.ts
    ├── ConditioningMemoryRepository.ts # + conditioningDb
    ├── WhitelistRepository.ts         # NEW
    ├── PresetRepository.ts            # NEW
    ├── CooldownRepository.ts          # NEW
    └── internal/
        └── sql/                       # Go-style internal/ — private to repositories/**
            ├── configReadSql.ts
            ├── configWriteSql.ts
            ├── llmReadSql.ts
            ├── llmWriteSql.ts
            ├── memoryReadSql.ts
            ├── memoryWriteSql.ts
            ├── personaReadSql.ts
            ├── personaWriteSql.ts
            ├── serverReadSql.ts       # + emoji/sticker/webhook SQL
            ├── serverWriteSql.ts      # + emoji/sticker/webhook SQL
            ├── toolReadSql.ts         # + MCP SQL
            ├── toolWriteSql.ts        # NEW (currently no write file)
            ├── userReadSql.ts         # + spotlight SQL
            ├── userWriteSql.ts        # + spotlight SQL
            ├── importExportReadSql.ts # from db/repositoryExportSql.ts (753 lines)
            ├── importExportWriteSql.ts # from db/repositoryImportSql.ts (754 lines)
            ├── conditioningReadSql.ts # NEW
            ├── conditioningWriteSql.ts # NEW
            ├── whitelistReadSql.ts    # NEW
            ├── whitelistWriteSql.ts   # NEW
            ├── presetReadSql.ts       # NEW
            ├── presetWriteSql.ts      # NEW
            ├── cooldownReadSql.ts     # NEW
            └── cooldownWriteSql.ts    # NEW
```

**Outside `src/utils/db/`** (Group E + Group F moves):

```
src/utils/persona/personaAccess.ts     # moved from db/personaAccess.ts
src/utils/misc/memoryLimits.ts         # env-loading half of db/memoryLimits.ts
```

**Privacy convention:** `repositories/internal/**` is accessible only from `repositories/**`. Anything outside `repositories/` that imports from `internal/sql/` is a violation. The audit-script extension (see "Audit script extension" subtask in the plan) enforces this at CI time.

**Why nested under `repositories/`, not at `db/internal/`:** the `internal/` boundary in Go is "only the parent directory and its subdirectories may import." Placing `internal/` at `db/` would let `db/client.ts` and `db/initializeDatabase.ts` reach into per-domain SQL — which they have no business doing. Nesting under `repositories/` matches the actual privacy intent.

---

## Method

For each root file we recorded:

1. **LOC** — raw line count from `wc -l`.
2. **Public surface** — exported symbols (functions, types, constants).
3. **Classification** — one of: `Infrastructure`, `Fold into <Repository>`, `New Repository`, `Move out of db/`.
4. **Justification** — the budget math or domain reasoning behind the call.

The 5.5b 600-line per-module budget is the primary forcing function. Repositories already over budget (`ConfigRepository` 681, `LlmRepository` 791, plus several `*Sql.ts` files) drive most of the "new repository" decisions.

---

## Repository headroom (post-5.5b baseline)

| Repository | LOC | Headroom to 600 | Notes |
|---|---:|---:|---|
| `PersonaRepository` | 102 | +498 | Plenty of room |
| `ConditioningMemoryRepository` | 131 | +469 | Plenty of room |
| `ServerMemoryRepository` | 151 | +449 | Plenty of room |
| `RagRepository` | 155 | +445 | Plenty of room |
| `ShortTermMemoryRepository` | 166 | +434 | Plenty of room |
| `ToolRepository` | 171 | +429 | Plenty of room |
| `PersonalMemoryRepository` | 192 | +408 | Plenty of room |
| `ImportExportRepository` | 245 | +355 | Modest room |
| `ServerRepository` | 405 | +195 | Tight; depends on what folds in |
| `UserRepository` | 551 | +49 | Already near budget |
| `ConfigRepository` | 681 | −81 | **Over budget already** |
| `LlmRepository` | 791 | −191 | **Over budget already** |

SQL siblings (`*ReadSql.ts` / `*WriteSql.ts`) under `repositories/` are not counted against the class budget — they will live in `repositories/internal/sql/` per 5.5e's stated rule (Go-style `internal/` privacy convention).

---

## File-by-file inventory (26 files)

### Group A — Infrastructure (stays at `db/` root or under `db/` infrastructure)

| File | LOC | Public surface | Disposition |
|---|---:|---|---|
| `client.ts` | 208 | `sql`, connection lifecycle | Stay at `db/` root |
| `initializeDatabase.ts` | 108 | DB bootstrap routine | Stay at `db/` root |
| `sqlSecurity.ts` | 116 | `validateTomoriConfigFields()` and other allowlist guards | Stay at `db/` root |
| `sqlSplitter.ts` | 129 | SQL file splitter helper | Stay at `db/` root |

All four are connection / startup / security infrastructure with no domain ownership. Confirmed unchanged from plan.

### Group B — Misclassified by the plan (move into `repositories/internal/sql/`)

| File | LOC | Public surface | Disposition | Why |
|---|---:|---|---|---|
| `repositoryExportSql.ts` | 753 | Per-table export SQL constants used by `ImportExportRepository` | **Move to `repositories/internal/sql/importExportReadSql.ts`** | Despite the `repository*` prefix this is one repository's SQL. Plan's "infrastructure" label was based on filename, not content. |
| `repositoryImportSql.ts` | 754 | Per-table import SQL constants used by `ImportExportRepository` | **Move to `repositories/internal/sql/importExportWriteSql.ts`** | Same reasoning as above. |
| `repositoryReadSql.ts` | 7 | `export * from` barrel into 7 `repositories/*ReadSql.ts` files | **Delete** | Once `internal/sql/` becomes private (the stated 5.5e convention), an external barrel into it is architecturally wrong. |
| `repositoryWriteSql.ts` | 6 | `export * from` barrel into 6 `repositories/*WriteSql.ts` files | **Delete** | Same reasoning as above. |

**Action required outside this file:** grep for consumers of `@/utils/db/repositoryReadSql` and `@/utils/db/repositoryWriteSql` before deletion — they must already be importing from the per-domain SQL files (or, ideally, only from Repository classes after the index.ts drain).

### Group C — Folds into existing Repository (with SQL routed to `internal/sql/`)

| File | LOC | Target Repository | Class additions (est.) | Why |
|---|---:|---|---:|---|
| `emojiStickerSync.ts` | 331 | `ServerRepository` | ~80 | Plan already noted ServerRepository owns `loadEmojis` / `loadStickers`. Sync logic is server-scoped. SQL (~250 lines) routes to `internal/sql/serverWriteSql.ts`. |
| `managedWebhookDb.ts` | 197 | `ServerRepository` | ~70 | Single-table, server-scoped. Encryption + lazy key rotation pattern matches `guildMcpDb`'s — both are server-scoped encrypted credentials. New `WebhookRepository` would be over-decomposed for one table. |
| `guildMcpDb.ts` | 237 | `ToolRepository` | ~110 | MCP servers are tool sources; `ToolRepository` has +429 headroom. Encryption logic adds private helpers, not new domain. Honors the user's saved feedback `[[feedback_reuse_existing_patterns]]` — mirror established patterns rather than invent new repositories. |
| `conditioningDb.ts` | 358 | `ConditioningMemoryRepository` | ~130 | Conditioning history is the natural extension of conditioning memory. +469 headroom on the target. SQL routes to a new `internal/sql/conditioningWriteSql.ts`. |
| `personalSpotlight.ts` | 361 | `UserRepository` | ~120 | Personal spotlights are user-scoped state per channel. UserRepository headroom is tight (+49) but SQL extraction to `internal/sql/` keeps the class growth bounded. **If post-fold UserRepository exceeds 650**, escalate to a new `SpotlightRepository` — record the decision in the PR description. |

### Group D — New Repository required

| New Repository | Folds | Combined source LOC | Why a new repository |
|---|---|---:|---|
| `WhitelistRepository` | `channelWhitelist.ts` (283), `personaWhitelist.ts` (122), `roleWhitelist.ts` (71) | 476 | Folding into `ServerRepository` (405) → ~880 even with SQL extracted — well past budget. Whitelists form a coherent standalone domain (channel + role + persona filtering, plus pure functional helpers like `isPersonaAllowedByWhitelistStatus` and `filterPersonasByWhitelist`). |
| `PresetRepository` | `presetExport.ts` (214), `presetImport.ts` (264), `stPresetDb.ts` (285), `sillyTavernImport.ts` (545) | 1308 | Folding into `ImportExportRepository` (245) → ~1553 and conflates two domains: TomoriBot's own export/import vs SillyTavern card ingestion. Presets are a distinct concern (per-persona personality blobs, ST card conversion, ST node CRUD). |
| `CooldownRepository` | `cooldownManager.ts` (365), `cooldownsCleanup.ts` (82), `messageCooldown.ts` (305) | 752 | Already mandated by the plan. The duplication between `cooldownManager` and `messageCooldown` (both have `isExemptFromCooldown`, both have whitelist-aware variants) is a refactoring opportunity — collapse to one canonical pair of `check…` / `set…` methods on the repository, with the duplicate exit-points becoming convenience overloads. |

### Group E — Move out of `db/` entirely

| File | LOC | Destination | Why |
|---|---:|---|---|
| `personaAccess.ts` | 22 | `src/utils/persona/personaAccess.ts` (or similar) | Pure functional composition of `isPersonaAllowedByWhitelistStatus` + `isPersonaAllowedByPersonalSpotlight`. No DB access. Belongs to the persona/filter utility layer, not the repository layer. |
| `ragDetection.ts` | 45 | Either stays at `db/` root (rename to `ragAvailability.ts`) **or** folds into `initializeDatabase.ts` | Two cached pgvector availability checks. Startup-time infrastructure, not a domain repository. `RagRepository` does CRUD on `documents`/chunks and shouldn't depend on availability detection. **Recommendation:** keep at `db/` root and rename to make the infrastructure role explicit. |

### Group F — Mixed: split between locations

| File | LOC | Destinations |
|---|---:|---|
| `memoryLimits.ts` | 504 | Split three ways: (1) `getMemoryLimits()` + env helpers + content validators → `src/utils/misc/memoryLimits.ts` (no DB access, pure env-var loading and string-length validation); (2) `checkPersonalMemoryLimit()` → `PersonalMemoryRepository`; (3) `checkServerMemoryLimit()` → `ServerMemoryRepository`; (4) `checkTriggerWordLimit()`, `checkSampleDialogueLimit()`, `checkAttributeLimit()` → `PersonaRepository`. The env-only block (~250 lines) is the largest piece and is the only part that today violates "infrastructure stays at `db/` root, domain logic lives in repositories." |

---

## Conditional decisions resolved (with rationale)

The plan left four "or new X if surface justifies" hedges. The inventory commits to one path each:

| Plan hedge | Decision | Why |
|---|---|---|
| Whitelists → `ServerRepository` **or** new `WhitelistRepository` | **New `WhitelistRepository`** | Folding pushes ServerRepository past budget (~880). Whitelists are a coherent domain. |
| MCP → `ToolRepository` **or** new `McpRepository` | **`ToolRepository`** | Headroom is +429; MCP servers are tool sources. Honors reuse-existing-patterns preference. |
| Webhook → `ServerRepository` **or** new `WebhookRepository` | **`ServerRepository`** | Single-table, ~70 class-line addition. New repository would be over-decomposed. |
| Presets → `ImportExportRepository` **or** new `PresetRepository` | **New `PresetRepository`** | 1308 combined LOC and a distinct domain (SillyTavern ingestion ≠ TomoriBot export/import). |

---

## Exhaustiveness check

Files at `src/utils/db/` root: **26** (per `Glob src/utils/db/*.ts`).

Files classified above:

- Group A (4): `client`, `initializeDatabase`, `sqlSecurity`, `sqlSplitter`
- Group B (4): `repositoryExportSql`, `repositoryImportSql`, `repositoryReadSql`, `repositoryWriteSql`
- Group C (5): `emojiStickerSync`, `managedWebhookDb`, `guildMcpDb`, `conditioningDb`, `personalSpotlight`
- Group D (10): `channelWhitelist`, `personaWhitelist`, `roleWhitelist`, `presetExport`, `presetImport`, `stPresetDb`, `sillyTavernImport`, `cooldownManager`, `cooldownsCleanup`, `messageCooldown`
- Group E (2): `personaAccess`, `ragDetection`
- Group F (1): `memoryLimits`

Total: 4 + 4 + 5 + 10 + 2 + 1 = **26**. Matches.

No file at `db/` root is unaccounted for.

---

## Suggested execution order (for the fold subtasks)

1. **Read-only audits first.** Grep usages of `repositoryReadSql.ts` / `repositoryWriteSql.ts` (Group B barrels) — confirm consumers already use direct imports, then delete the barrels.
2. **Group C folds** (existing repositories with headroom) — lowest risk, no new repository scaffolding.
3. **Group F split** (`memoryLimits`) — touches multiple repositories but each addition is small.
4. **Group D new repositories** — `CooldownRepository` first (already mandated, deduplicates `cooldownManager` ↔ `messageCooldown`), then `WhitelistRepository`, then `PresetRepository`.
5. **Group E moves** — pure relocations; do last so all callers have stabilized.
6. **Group B SQL relocations** (`repositoryExportSql` / `repositoryImportSql` → `repositories/internal/sql/`) — final structural move, coincides with the audit-script extension that flags any new `db/` root domain files.

---

## Open follow-ups (outside 5.5e's scope, but flagged)

- `LlmRepository` (791) and `ConfigRepository` (681) are already over budget before 5.5e. They aren't growing from any fold here, but the audit-script extension (cohabiting-siblings check) should also surface "Repository class > 600 LOC" as a separate finding for Phase 6 to address.
- `llmReadSql.ts` (2078) and `llmWriteSql.ts` (1204) are extreme cases that suggest the LLM domain may need a further split (per-provider repository or per-table repository). Out of scope for 5.5e but worth noting.
