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
    ├── ServerRepository.ts            # core: setup, emojis/stickers, webhooks, blacklist
    ├── ServerScheduleRepository.ts    # NEW: reminders + random triggers (split from ServerRepository)
    ├── UserRepository.ts              # + personalSpotlight (folded; 965 lines post-fold — under 1,000 limit, no SpotlightRepository needed)
    ├── PersonaRepository.ts           # + persona-scoped memoryLimits checks
    ├── ConfigRepository.ts            # monitor: ~1,132 combined — split if >1,200 after inlining
    ├── LlmModelRepository.ts          # NEW (split from LlmRepository): global model catalog
    ├── LlmProviderRepository.ts       # NEW (split from LlmRepository): saved configs + OpenRouter registrations
    ├── LlmOverrideRepository.ts       # NEW (split from LlmRepository): channel/persona override assignments
    ├── ToolRepository.ts              # + guildMcpDb
    ├── RagRepository.ts
    ├── ImportExportRepository.ts      # monitor: ~1,730 combined — split by direction if >1,200 after inlining
    ├── PersonalMemoryRepository.ts    # + checkPersonalMemoryLimit
    ├── ServerMemoryRepository.ts      # + checkServerMemoryLimit
    ├── ShortTermMemoryRepository.ts
    ├── ConditioningMemoryRepository.ts # + conditioningDb
    ├── WhitelistRepository.ts         # NEW (also absorbs whitelist delegation methods from ServerRepository)
    ├── PresetRepository.ts            # NEW
    └── CooldownRepository.ts          # NEW
```

**No `internal/sql/` subfolder.** All SQL is inlined as `private` methods on the owning Repository class. The existing `*ReadSql.ts` / `*WriteSql.ts` files are dissolved into their repository and deleted. The public/private boundary is enforced by TypeScript's `private` keyword, not by folder convention.

**Outside `src/utils/db/`** (Group E + Group F moves):

```
src/utils/persona/personaAccess.ts     # moved from db/personaAccess.ts
src/utils/misc/memoryLimits.ts         # env-loading half of db/memoryLimits.ts
```

---

## Method

For each root file we recorded:

1. **LOC** — raw line count from `wc -l`.
2. **Public surface** — exported symbols (functions, types, constants).
3. **Classification** — one of: `Infrastructure`, `Fold into <Repository>`, `New Repository`, `Move out of db/`.
4. **Justification** — the budget math or domain reasoning behind the call.

The 5.5b 600-line per-module budget is the primary forcing function. Repositories already over budget (`ConfigRepository` 681, `LlmRepository` 791, plus several `*Sql.ts` files) drive most of the "new repository" decisions.

---

## Repository headroom (combined class + SQL, post-5.5b baseline)

Budget is ~1,000 lines per Repository file once SQL is inlined. SQL sibling LOC is now counted directly — it will be dissolved into the class as `private` methods.

| Repository | Class LOC | SQL sibling LOC | **Combined** | Headroom to 1,000 | Notes |
|---|---:|---:|---:|---:|---|
| `RagRepository` | 137 | 0 | **137** | +863 | Fine |
| `ToolRepository` | 156 | 23 | **179** | +821 | Fine; +~110 from guildMcpDb fold |
| `ConditioningMemoryRepository` | 119 | 0 | **119** | +881 | Fine; +~130 from conditioningDb fold |
| `ShortTermMemoryRepository` | 147 | 213 | **360** | +640 | Fine (memoryReadSql 49 + memoryWriteSql 164 are shared; assign proportionally) |
| `PersonalMemoryRepository` | 175 | 0 | **175** | +825 | Fine; +~small from memoryLimits fold |
| `ServerMemoryRepository` | 138 | 0 | **138** | +862 | Fine; +~small from memoryLimits fold |
| `PersonaRepository` | 91 | 717 | **808** | +192 | Fine; +~small from memoryLimits fold |
| `UserRepository` | 490 | 407 | **897** | +103 | ~~Tight; +~120 from personalSpotlight fold~~ → **965 post-fold (under 1,000). No SpotlightRepository split.** |
| `ImportExportRepository` | 223 | 1,507 | **1,730** | −730 | **Over budget.** PresetRepository split reduces this (preset SQL moves out); re-measure after that split before deciding whether a further split is needed |
| `ConfigRepository` | 600 | 532 | **1,132** | −132 | **Over budget.** Evaluate split during implementation; domain boundary TBD in PR |
| `ServerRepository` | 352 | 1,278 | **1,630** | −630 | **Over budget** before orphan folds (+~150 class). Split during implementation; see size rule in plan |
| `LlmRepository` | 706 | 3,007 | **3,713** | −2,713 | **Severely over budget. MUST split in this phase.** Domain split (e.g., `LlmProviderRepository` + `LlmModelRepository`) determined during implementation |

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

### Group B — Misclassified by the plan (inline into owning Repository, then delete)

| File | LOC | Public surface | Disposition | Why |
|---|---:|---|---|---|
| `repositoryExportSql.ts` | 753 | Per-table export SQL constants used by `ImportExportRepository` | **Inline as `private` methods into `ImportExportRepository`; delete file** | One repository's SQL — belongs inside that repository, not in a separate file. |
| `repositoryImportSql.ts` | 754 | Per-table import SQL constants used by `ImportExportRepository` | **Inline as `private` methods into `ImportExportRepository`; delete file** | Same reasoning. Note: `ImportExportRepository` combined LOC will be ~1,730 after inlining — the `PresetRepository` split (Group D) must happen first to reduce that before assessing whether a further split is needed. |
| `repositoryReadSql.ts` | 7 | `export * from` barrel into 7 `repositories/*ReadSql.ts` files | **Delete** | SQL siblings are being inlined; an external barrel into them is doubly wrong once they're gone. |
| `repositoryWriteSql.ts` | 6 | `export * from` barrel into 6 `repositories/*WriteSql.ts` files | **Delete** | Same reasoning. |

**Action required outside this file:** grep for consumers of `@/utils/db/repositoryReadSql` and `@/utils/db/repositoryWriteSql` before deletion — they must already be importing from the Repository classes (or direct per-domain SQL files) via the index.ts drain. Any remaining direct SQL imports are a secondary smell to fix at the same time.

### Group C — Folds into existing Repository (with SQL routed to `internal/sql/`)

| File | LOC | Target Repository | Class additions (est.) | Why |
|---|---:|---|---:|---|
| `emojiStickerSync.ts` | 331 | `ServerRepository` | ~80 | Plan already noted ServerRepository owns `loadEmojis` / `loadStickers`. Sync logic is server-scoped. SQL (~250 lines) inlined as private methods on `ServerRepository`. |
| `managedWebhookDb.ts` | 197 | `ServerRepository` | ~70 | Single-table, server-scoped. Encryption + lazy key rotation pattern matches `guildMcpDb`'s — both are server-scoped encrypted credentials. New `WebhookRepository` would be over-decomposed for one table. |
| `guildMcpDb.ts` | 237 | `ToolRepository` | ~110 | MCP servers are tool sources. Encryption logic adds private helpers, not new domain. Honors the user's saved feedback `[[feedback_reuse_existing_patterns]]` — mirror established patterns rather than invent new repositories. |
| `conditioningDb.ts` | 358 | `ConditioningMemoryRepository` | ~130 | Conditioning history is the natural extension of conditioning memory. SQL inlined as private methods; combined LOC stays well under 1,000. |
| `personalSpotlight.ts` | 361 | `UserRepository` | ~120 | ✅ **Done.** Post-fold `UserRepository` is 965 lines — under 1,000. No `SpotlightRepository` split required. |

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

### Original plan hedges

The plan left four "or new X if surface justifies" hedges. The inventory commits to one path each:

| Plan hedge | Decision | Why |
|---|---|---|
| Whitelists → `ServerRepository` **or** new `WhitelistRepository` | **New `WhitelistRepository`** | Folding pushes ServerRepository past budget (~880 class-only; combined even larger). Whitelists are a coherent domain. The whitelist delegation methods already on `ServerRepository` move to `WhitelistRepository` at the same time. |
| MCP → `ToolRepository` **or** new `McpRepository` | **`ToolRepository`** | MCP servers are tool sources. Honors reuse-existing-patterns preference. |
| Webhook → `ServerRepository` **or** new `WebhookRepository` | **`ServerRepository`** | Single-table, ~70 class-line addition. New repository would be over-decomposed. |
| Presets → `ImportExportRepository` **or** new `PresetRepository` | **New `PresetRepository`** | 1308 combined LOC and a distinct domain (SillyTavern ingestion ≠ TomoriBot export/import). |

### Over-budget repository splits (resolved here — not deferred to implementing agent)

#### LlmRepository → 3-way split

Combined ~3,713 lines. The domain has three distinct concerns visible in the function inventory:

| New repository | Public API (from current `LlmRepository` / `llmReadSql` / `llmWriteSql`) | Tables owned |
|---|---|---|
| `LlmModelRepository` | `loadAvailableLlms`, `getLlmsByIds`, `loadById`, `loadLlmById`, `loadByProviderAndCodename`, `loadAvailableModelsForProvider`, `loadDefaultModel`, `loadSmartestModel`, `loadDefaultVisionModel`, `loadUniqueProviders`; all `loadAvailable*`, `loadDefault*`, `load*ById`, `load*ByProviderAndCodename` for embedding / diffusion / video-generation models | `llms`, `embedding_models`, `diffusion_models`, `video_generation_models` |
| `LlmProviderRepository` | `loadSavedProviderConfigs`, `loadSavedProviderConfig`, `upsertSavedProviderConfig`, `deleteSavedProviderConfig`; user-scoped variants; `upsertCustomEndpoint`, `deleteCustomEndpoint`; all `loadOpenRouterModelRegistrations*`, `loadScopedOpenRouter*`, `upsertOpenRouterModelRegistration*`, `deleteOpenRouterModelRegistration*` (all modality variants) | `saved_provider_configs`, `user_saved_provider_configs`, `custom_endpoints`, `openrouter_*_registrations` |
| `LlmOverrideRepository` | `getChannelLlmOverride`, `getAllChannelLlmOverridesForServer`, `setChannelLlmOverride`, `deleteChannelLlmOverride`, `clearAllChannelLlmOverridesForServer`; `loadPersonaLlmOverridesForServer`, `setPersonaLlmOverride`, `clearAllPersonaLlmOverridesForServer`; `setFallbackLlms`, `setFallbackModelRefs`, `restoreOverridesFromSnapshot`, `cleanupDeadChannelOverrides` | `channel_llm_overrides`, `persona_llm_overrides`, fallback refs |

`toExportShape()` / `fromExportShape()` moves to `LlmProviderRepository` (saved provider configs and OpenRouter registrations are the exportable state; model catalog is global seed data).

#### ServerRepository → 2-way split (after whitelist and orphan folds)

Scheduling is cleanly separable from server identity. After extracting scheduling and extracting whitelists to `WhitelistRepository`, `ServerRepository` core lands at ~342 class + ~730 inline SQL ≈ ~1,070 lines — marginally over the 1,000-line heuristic, but `setupServer` is a single unavoidably large transaction (~400 SQL lines), not domain fragmentation. This exception is acceptable and should be documented inline in the repository.

| New repository | Public API | Tables owned |
|---|---|---|
| `ServerRepository` (core) | `setup`, `loadEmojis`, `loadStickers`, `isBlacklisted`, `getBlacklistedMemberIds`, `getBraveApiKeyStatus`; webhook methods from `managedWebhookDb` fold | `servers`, `server_emojis`, `server_stickers`, `managed_webhooks` (+ whatever `setupServer` initializes) |
| `ServerScheduleRepository` (**NEW**) | `getDueReminders`, `getNextReminderTime`, `getReminderById`, `getUserReminderCount`, `deleteReminderById`, `getPendingRemindersForUser`, `addReminder`, `rescheduleReminder`, `updateReminder`; `getDueTriggers`, `getNextTriggerTime`, `getServerTriggers`, `getServerTriggerCount`, `getTriggerByPersonaAndChannel`, `insertTrigger`, `upsertTrigger`, `deleteTrigger`, `rescheduleTrigger` | `reminders`, `random_triggers` |

`toExportShape()` / `fromExportShape()` stays on `ServerRepository` core (server setup state is what's exported; schedule state is transient).

#### ConfigRepository — monitor, do not pre-split

Combined ~1,132 lines. `ConfigRepository` (600 class) + `configReadSql` (245) + `configWriteSql` (287). This is over the 1,000-line heuristic by ~132 lines. However, the config domain is inherently uniform (the class manages a single coherent config-read-write surface). **Decision: inline SQL and re-measure during implementation.** If the combined file exceeds 1,200 lines after inlining, split at the domain boundary identified at that point; document the decision in the PR description.

#### ImportExportRepository — re-evaluate after PresetRepository split

PresetRepository absorbs ~1,308 LOC of preset/SillyTavern SQL. After that split, the remaining export/import SQL (`repositoryExportSql.ts` 753 + `repositoryImportSql.ts` 754) is still ~1,507 lines. The class itself is 223 lines. Combined ~1,730 → still over budget. **Decision: after inlining, if the combined file exceeds 1,200 lines, split by export vs. import direction** (`ImportRepository` handles `fromExportShape` and bulk-import SQL; `ExportRepository` handles `toExportShape` and snapshot SQL). Document the chosen split in the PR description.

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

1. **Read-only audits first.** Grep usages of `repositoryReadSql.ts` / `repositoryWriteSql.ts` (Group B barrels) — confirm consumers already use Repository class imports or direct SQL-file imports, then delete the barrels.
2. **Group C folds** (existing repositories with headroom) — lowest risk, no new repository scaffolding. Inline SQL from the orphan files as private methods while folding.
3. **Group F split** (`memoryLimits`) — touches multiple repositories but each addition is small.
4. **Group D new repositories** — `CooldownRepository` first (deduplicates `cooldownManager` ↔ `messageCooldown`), then `WhitelistRepository` (also migrates whitelist delegation methods from `ServerRepository`), then `PresetRepository`.
5. **Large repository splits** — inline SQL for over-budget repos and split simultaneously:
   - `LlmRepository` → `LlmModelRepository` + `LlmProviderRepository` + `LlmOverrideRepository`
   - `ServerRepository` → `ServerRepository` (core) + `ServerScheduleRepository`
   - Inline remaining `*ReadSql.ts` / `*WriteSql.ts` for in-budget repos (ConfigRepository, PersonaRepository, UserRepository, etc.)
6. **Group B SQL dissolution** — inline `repositoryExportSql` / `repositoryImportSql` into `ImportExportRepository` as private methods; delete the source files.
7. **Group E moves** — pure relocations; do last so all callers have stabilized.
8. **Audit-script extension** — add the surviving-SQL-siblings and cohabiting-siblings checks; run with `--strict` to confirm zero findings.

---

## Open follow-ups (outside 5.5e's scope, but flagged)

- The audit-script extension should also surface a "Repository file > 1,000 lines" finding so no future repository silently drifts past the budget after 5.5e ships.
- Phase 6 creates ~12 new `server_*_configs` tables from `tomori_configs`. Each new table will need read/write methods in a repository — that repository assignment is decided in Phase 6 step #14, not here. The repository splits done in 5.5e should be stable enough that Phase 6 only needs to **add** new methods, not restructure existing repositories.
