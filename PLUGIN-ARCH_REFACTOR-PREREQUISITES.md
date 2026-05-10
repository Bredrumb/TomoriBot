# Plugin Architecture: Refactor Prerequisites

This document outlines the proposed refactoring tasks for TomoriBot, ordered by **dependency prerequisites (bottom-up)**. By refactoring foundational utilities and data-access layers first, we ensure that when we tackle the massive "God Files" (like `tomoriChat.ts`), they can immediately consume the new, clean APIs without needing to be rewritten twice.

> **Related plan:** `PLUGIN-ARCH_TASK-LIST.md` — depends on Phases 1, 2, 3, and 6 of this document. Several tasks below (especially the new #2.5 and #6.5) are explicit prerequisites for plugin architecture acceptance criteria.

> **Sizes last refreshed:** 2026-05-07. The DB god files have grown ~40% since the original plan, validating the urgency of Phase 2.

## How to read this plan

- **Cross-phase dependencies are explicit.** Any phase or numbered item that depends on another states it on a `**Prerequisite:**` or `**Plugin prereq:**` line. If a section has no such line, it has no upstream blockers in this plan.
- **Within a numbered item, checkboxes are roughly top-to-bottom.** But multi-instance lists (e.g., "Implement 9 repositories" in #4b, "Eliminate switches in 6 files" in #6.5, the 11 provider migrations in plugin Phase C) are **parallel-able** — any order, or simultaneously, unless an inline note says otherwise. The stacking is for inventory, not sequencing.
- **Quality gates always go last.** The closing `bun run check && bun run lint` (and `bun run check-locales` / `check-schema` where applicable) is the final checkbox of every numbered item by convention.
- **`.5` numbering** (e.g., #2.5, #6.5, #16.5) marks adjacent-but-distinct work that was added after the original numbering. It does not imply "do this halfway through the parent item" — it's a sibling task.
- **`a` / `b` splits** (e.g., #4a/#4b, #12a/#12b) are a hard sequential dependency: `b` cannot start until `a` is green. These are the exception, not the default.

## Documentation Alignment Protocol

Refactoring spans many phases and many PRs. The `/docs/` tree must stay aligned with whatever architectural state has actually shipped — but we will *not* clean-slate rewrite docs. Two conventions keep this honest:

### 1. ARCH-ALIGNMENT marker (top of every `/docs/` page)

Every documentation file gets an HTML comment at the top declaring the architectural state it describes:

```markdown
<!-- ARCH-ALIGNMENT: pre-refactor -->
```

Valid values:
- `pre-refactor` — describes TomoriBot before any of this plan ships (default for all existing docs today)
- `prereq-phase-N` — describes state after refactor Phase N has merged (e.g. `prereq-phase-2` = repositories live)
- `plugin-phase-X` — describes state after plugin migration Phase X has merged (e.g. `plugin-phase-C` = providers migrated)

**Reading rule:** If a doc's marker doesn't match the most-recently-shipped phase that touches its subject area, the doc is stale. Read it for historical intent, but verify against code before trusting.

**Writing rule:** When a phase ships, every doc listed in that phase's row of the tracker below gets its marker bumped to that phase identifier in the same PR. A phase that merges without bumping its docs is incomplete and must be followed up.

### 2. Documentation Alignment Tracker

Each phase below lists the `/docs/` pages it must update. The phase's quality-gate checklist includes a single closing subtask: "Update docs per Documentation Alignment Tracker; bump ARCH-ALIGNMENT markers." If a phase has no docs impact, the row is empty — skip the subtask.

| Phase | Docs to update on merge |
|---|---|
| **#1 Fragment locales** | `docs/systems/localization.md` |
| **#2 Simplify stringHelper** | `docs/systems/utils.md` (if stringHelper documented there) |
| **#2.5 Delete .backup file** | _(none)_ |
| **#3 Decouple index.ts** | `docs/core/entry-point.md`, `docs/core/architecture.md` |
| **#4a DB regression harness** | `docs/guides/testing-db-changes.md` (new), `docs/README.md` |
| **#4b Repository pattern** | `docs/systems/database-schema.md`, `docs/systems/caching.md`, `docs/core/architecture.md` |
| **#5 status.ts / compact.ts split** | `docs/systems/status-command.md` |
| **#6 BaseStreamAdapter** | `docs/ai/streaming.md`, `docs/ai/providers.md` |
| **#6.5 Provider auto-discovery + name-switch purge** | `docs/ai/providers.md`, `docs/guides/adding-new-provider.md` |
| **#7 toolRegistry split + MCP fix** | `docs/systems/tool-system.md` |
| **#8 UI / command loaders** | `docs/systems/command-system.md` |
| **#9 matrixManager modularization** | `docs/integrations/matrix-bridge.md` |
| **#10 contextBuilder modularization** | `docs/ai/context-assembly.md`, `docs/ai/rag.md` |
| **#11 streamOrchestrator split** | `docs/ai/streaming.md`, `docs/ai/text-flushing-and-chunking.md` |
| **#12a Chat regression harness** | `docs/guides/testing-chat-changes.md` (new), `docs/README.md` |
| **#12b tomoriChat deconstruction** | `docs/core/architecture.md`, `docs/systems/event-system.md` |
| **#13 eventHandler eager-load** | `docs/systems/event-system.md` |
| **#14 tomori_configs normalization** | `docs/systems/database-schema.md` |
| **#15 JSONB → junction tables** | `docs/systems/database-schema.md` |
| **#16 Separate state from config** | `docs/systems/database-schema.md` |
| **#16.5 Migration runner** | `docs/systems/database-schema.md` |
| **#17 Logger/DB circular dep** | `docs/systems/utils.md` (if logger documented there) |
| **#18 Eradicate `.catch(() => {})`** | _(none)_ |
| **#21 Eradicate sync I/O** | _(none)_ |

When a phase touches code that affects a doc not listed here, add the doc to this table in the same PR. The tracker is the source of truth for "did this phase update its docs?" — keep it current.

## Phase 1: Primitives & Foundation (The Bottom of the Tree)
*These files are imported by almost everything else. Cleaning them first prevents merge conflicts and cascading updates later.*

### 1. Fragment Locales (`src/locales/en-US.ts` & `ja.ts`)
- **What:** Split the massive locale files (`en-US.ts` 412KB, `ja.ts` 515KB) into category-based directories (`en-US/general.ts`, `en-US/commands.ts`, etc.).
- **Why:** Editing these prevents constant merge conflicts. Subsequent refactors will need to add or move localization strings.
- **Plugin prereq:** Required by `PLUGIN-ARCH_TASK-LIST.md` AC-5.

**Subtasks:**
- [ ] Decide category split (e.g., `general`, `commands`, `errors`, `tools`, `providers`, `bridges`)
- [ ] Create `src/locales/en-US/` and `src/locales/ja/` directories
- [ ] Move keys from `en-US.ts` into category files; ensure type structure preserved
- [ ] Mirror exact same keys in `ja/` files
- [ ] Update `localizer()` to merge slices into one tree at boot
- [ ] Update `check-locales` script to scan the new directory structure
- [ ] Delete old monolithic `en-US.ts` and `ja.ts`
- [ ] `bun run check && bun run lint && bun run check-locales` pass

### 2. Simplify `src/utils/text/stringHelper.ts`
- **What:** Break down the 73KB file of complex regex chains into specialized processors.

**Subtasks:**
- [ ] Inventory all exported functions in `stringHelper.ts`; group by purpose (emoji, markdown, mentions, normalization)
- [ ] Create `src/utils/text/processors/` with one file per group (`emojiProcessor.ts`, `markdownProcessor.ts`, etc.)
- [ ] Move functions to appropriate files; preserve signatures
- [ ] Replace `stringHelper.ts` with a barrel re-export for backwards compatibility, or update all import sites
- [ ] Add unit tests for the most complex regex chains before/during the move
- [ ] `bun run check && bun run lint` pass

### 2.5. Delete `tomoriChat.ts.backup` zombie file
**Subtasks:**
- [ ] Verify nothing imports `tomoriChat.ts.backup`
- [ ] Delete the file
- [ ] Confirm git history still contains it for archaeological needs

### 3. Decouple `src/index.ts` & Remove Hacks
- **What:** Split the 17KB `index.ts` into specialized initialization modules (`src/init/`). Replace `process.env` mutations with a typed config object.

**Subtasks:**
- [ ] Create `src/init/` directory
- [ ] Extract DB init into `src/init/database.ts`
- [ ] Extract Discord client init into `src/init/discord.ts`
- [ ] Extract event/command/tool loader bootstrapping into `src/init/loaders.ts`
- [ ] Extract Matrix bridge init into `src/init/bridges.ts` (until Phase E moves it to a plugin)
- [ ] Define typed `AppConfig` interface in `src/types/config.ts`
- [ ] Replace `process.env.X = ...` mutations with explicit config-object usage
- [ ] Reduce `index.ts` to a thin orchestrator that calls each `init/*` in order
- [ ] `bun run check && bun run lint` pass

---

## Phase 2: Data Access & State Isolation
*Abstracting how the bot talks to the database ensures that higher-level logic isn't tightly coupled to raw SQL queries.*

### 4a. Build the DB repository regression harness
- **What:** Build a snapshot-test harness covering the most behavior-sensitive read queries from `dbRead.ts` and a representative set of write paths from `dbWrite.ts`, **before** repository extraction begins. Same risk profile as #12 (chat orchestrator) — 115+ call sites are about to move; without coverage, subtle behavior drift (row order, missing JOIN, NULL handling, cache-invalidation timing) will surface weeks later as "stale persona" or "wrong memory" bugs.
- **Why split:** Just as #12a ships harness-first to provide value across any chat-adjacent refactor, #4a ships harness-first so #4b can be tackled with confidence — and so the harness catches regressions in any DB-touching work that happens *before* #4b lands.

**Subtasks:**
- [ ] Inventory the highest-risk queries: tomori state load, persona resolution, memory aggregation, server config read, RAG chunk retrieval, import/export round-trips
- [ ] Decide harness shape: seeded test DB + snapshot tests on query results? Recorded fixtures + comparison? Whichever is least flaky.
- [ ] Build the harness in `tests/regression/db/` (or equivalent)
- [ ] Cover at least one read and one write per intended repository (UserRepo, MemoryRepo, ConfigRepo, PersonaRepo, ServerRepo, LlmRepo, ToolRepo, RagRepo)
- [ ] Add at least one cache-invalidation assertion (write → cache cleared → next read goes to DB)
- [ ] Verify the harness catches a deliberately introduced regression (e.g., remove a JOIN, confirm test fails)
- [ ] Wire into `bun run test` so it runs in CI
- [ ] Document the harness in `docs/guides/testing-db-changes.md`
- [ ] `bun run check && bun run lint` pass

### 4b. Refactor Database God Files (`dbRead.ts` & `dbWrite.ts`)
- **What:** Break down `dbRead.ts` (134KB, 73 exports) and `dbWrite.ts` (105KB, 42 exports) into a Repository Pattern. Also fold `dataExport.ts` (30KB) and `dataImportV2.ts` (29KB) into appropriate repositories.
- **Prerequisite:** #4a must be complete and the harness green on the unmodified DB layer.
- **Plugin prereq:** Required by `PLUGIN-ARCH_TASK-LIST.md` AC-6.

**Subtasks (per repository — group exports by domain):**
- [ ] Inventory all exports in `dbRead.ts` + `dbWrite.ts`; classify by domain (user, memory variants, config, persona, server, tools, RAG, etc.)
- [ ] Create `src/utils/db/repositories/` directory
- [ ] Implement `UserRepository` (user reads/writes)
- [ ] Implement `ServerMemoryRepository` (server-scoped long-term memories)
- [ ] Implement `PersonalMemoryRepository` (per-user long-term memories)
- [ ] Implement `ConditioningMemoryRepository` (conditioning/persona-shaping memories)
- [ ] Implement `ShortTermMemoryRepository` (conversation-recency memories — split out per OD-R-2 to support anticipated future expansion)
- [ ] Implement `ConfigRepository` (tomori_configs, server settings)
- [ ] Implement `PersonaRepository` (tomoris, alter personas)
- [ ] Implement `ServerRepository` (servers, channel whitelist, whitelists)
- [ ] Implement `LlmRepository` (llms, fallback configs)
- [ ] Implement `ToolRepository` (tool config, MCP servers)
- [ ] Implement `RagRepository` (documents, chunks, embeddings)
- [ ] Implement `ImportExportRepository` (subsumes `dataExport.ts` + `dataImportV2.ts`)
- [ ] Migrate callers in `contextBuilder.ts`, `tomoriChat.ts`, and commands to use repositories
- [ ] Delete `dbRead.ts`, `dbWrite.ts`, `dataExport.ts`, `dataImportV2.ts` once unused
- [ ] Update cache invalidation patterns to live in repository methods (per CLAUDE.md rule)
- [ ] **Cache invalidation audit (mandatory):** grep the pre-refactor codebase for every existing `cacheInvalidate*`, `cache.invalidate*`, and equivalent call site. Produce a checklist of (call site → which repository method should now own this invalidation). Confirm every entry lands in the corresponding repository method post-migration. CLAUDE.md mandates invalidation-after-write in the same code path; with 115+ DB exports moving into repositories, it's easy to lose one in the shuffle and end up with a stale-cache bug that surfaces weeks later.
- [ ] Run #4a regression harness; investigate any deltas
- [ ] `bun run check && bun run lint` pass

### 5. Refactor `src/commands/tool/status.ts` and `compact.ts`
- **What:** Extract monolithic logic from `status.ts` (96KB) into `src/utils/metrics/` and from `compact.ts` (40KB) into a dedicated module.

**Subtasks:**
- [ ] Create `src/utils/metrics/` directory
- [ ] Extract diagnostic gathering (provider stats, DB stats, cache stats, MCP status) into focused files in `src/utils/metrics/`
- [ ] Reduce `status.ts` to slash-command routing + embed presentation only
- [ ] Create `src/utils/compaction/` directory
- [ ] Extract compaction orchestration logic from `compact.ts` into `src/utils/compaction/`
- [ ] Reduce `compact.ts` to slash-command routing only
- [ ] `bun run check && bun run lint` pass

---

## Phase 3: Core Abstractions & Integrations
*Refactoring the "middle layer" interfaces that the core engine relies on.*

### 6. Unify Provider Stream Adapters
- **What:** Create a base `StreamAdapter` class to replace isolated stream adapters.

**Subtasks:**
- [ ] Define abstract `BaseStreamAdapter` class in `src/types/stream/interfaces.ts` with shared lifecycle hooks
- [ ] Identify common stream-handling logic across `googleStreamAdapter.ts`, `openrouterStreamAdapter.ts`, `novelaiStreamAdapter.ts`, etc.
- [ ] Move shared logic into the base class
- [ ] Refactor each adapter to extend `BaseStreamAdapter`, overriding only provider-specific bits
- [ ] Verify each provider still streams correctly (manual smoke test per provider)
- [ ] `bun run check && bun run lint` pass

### 6.5. Auto-discover provider registry & purge name-based dispatch
- **What:** Replace the hardcoded `providerInfos` array and `providerFeatureImplementations` map in `src/utils/provider/providerInfoRegistry.ts:20-82` with folder-scan auto-discovery. Eliminate the 40+ hardcoded provider-name comparisons.
- **Plugin prereq:** Required by `PLUGIN-ARCH_TASK-LIST.md` AC-1 + AC-2. Highest-leverage single task for plugin readiness.

**Subtasks:**
- [ ] Refactor `providerInfoRegistry.ts` to scan `src/providers/*/providerInfo.ts` at boot (mirror `providerFactory.ts` glob pattern)
- [ ] Move each provider's feature implementation declarations into its own `providerInfo.ts` (out of the central map)
- [ ] Build the `providerFeatureImplementations` map dynamically at boot from discovered provider infos
- [ ] Replace the `ProviderFeatureImplementation` string-union type with a derived type from discovered providers
- [ ] Eliminate the 17 `llm_provider === "..."` comparisons in `events/messageCreate/tomoriChat.ts` (lines 5585-8067) — route through provider methods or capability resolvers
- [ ] Eliminate the 17 `providerName === "..."` comparisons in `commands/tool/prompt/snapshot.ts`
- [ ] Eliminate the 2 comparisons in `commands/tool/estimate/cost.ts`
- [ ] Convert `case "google":` switches in `commands/tool/status.ts` (2 cases) to provider-method dispatch
- [ ] Convert `case "..."` switches in `commands/tool/prompt/snapshot.ts` (11 cases) to provider-method dispatch
- [ ] Decide allowlist for legitimate UI-display switches in `commands/help/api-key.ts` (9 cases) — these are arguably user-facing copy, not orchestration
- [ ] Run grep to verify zero name-comparisons in core orchestration paths
- [ ] `bun run check && bun run lint` pass

### 7. Split `src/tools/toolRegistry.ts` & Fix MCP Hacks
- **What:** Separate tool management from execution. Remove the `process.stdout.write` monkey-patch in `mcpManager.ts`.

**Subtasks:**
- [ ] Inventory current `toolRegistry.ts` responsibilities; split into management vs. execution
- [ ] Create `src/tools/availability.ts` for tool-availability checks
- [ ] Audit the `process.stdout.write` monkey-patch in `src/utils/mcp/mcpManager.ts:79–93` (active during MCP init, restored at line 119). Its purpose is filtering banner art (`╔══╗` boxes) some MCP servers print to stdout on startup — *not* capturing JSON-RPC output, which already flows through `StdioClientTransport` per-child pipes.
- [ ] Per OD-R-4 (D): install the banner filter at the **per-child-process stream level**. For each MCP server spawned via `StdioClientTransport`, attach a transform stream to the child's stdout pipe that strips banner lines before the SDK forwards them.
- [ ] Remove the monkey-patch entirely; never touch the parent's `process.stdout`.
- [ ] Verify banner filtering still works (no `╔══╗` lines reach the bot's logs during MCP boot)
- [ ] Verify MCP tool output is still captured correctly (test brave-search, duckduckgo-search, fetch)
- [ ] `bun run check && bun run lint` pass

### 8. Simplify UI & Command Loaders
- **What:** Refactor `interactionHelper.ts` (109KB), `webhookManager.ts` (43KB), and `commandLoader.ts`.

**Subtasks:**
- [ ] Inventory `interactionHelper.ts` exports; group by purpose (modals, embeds, buttons, pagination, errors)
- [ ] Split into `src/utils/discord/ui/` directory with one file per group
- [ ] Inventory `webhookManager.ts`; split into webhook lifecycle, persona dispatch, fallback handling
- [ ] Move into `src/utils/discord/webhook/` directory
- [ ] Audit `commandLoader.ts` for ESM consistency; remove any remaining CJS patterns
- [ ] Replace any synchronous I/O (`fs.readdirSync`, etc.) with `Bun.file().*` async equivalents
- [ ] Update import sites where files moved
- [ ] `bun run check && bun run lint` pass

### 9. Modularize `src/utils/matrix/matrixManager.ts`
- **What:** Split the 59KB Matrix bridging logic.

**Subtasks:**
- [ ] Inventory `matrixManager.ts` responsibilities (event handling, state sync, user mapping, room management)
- [ ] Create `src/utils/matrix/events.ts` for Matrix event handling
- [ ] Create `src/utils/matrix/stateSync.ts` for state syncing
- [ ] Create `src/utils/matrix/userMapping.ts` for virtual persona user identity mapping
- [ ] Create `src/utils/matrix/rooms.ts` for room lifecycle/linking
- [ ] Reduce `matrixManager.ts` to a thin coordinator that wires the above modules
- [ ] Verify Matrix bridge still works end-to-end
- [ ] `bun run check && bun run lint` pass

---

## Phase 4: The Brain (Context & Output)
*Now that DB access and string utilities are clean, we can refactor the complex logic that builds prompts and manages Discord streams.*

### 10. Modularize `src/utils/text/contextBuilder.ts`
- **What:** Break down the 128KB context builder.

**Subtasks:**
- [ ] Inventory `contextBuilder.ts` responsibilities (RAG retrieval, memory loading, template assembly, history fetching)
- [ ] Create `src/utils/text/context/rag.ts` for RAG retrieval logic
- [ ] Create `src/utils/text/context/memories.ts` for memory assembly
- [ ] Create `src/utils/text/context/templates.ts` for template/persona assembly
- [ ] Create `src/utils/text/context/history.ts` for conversation history fetching
- [ ] Wire each module to use the repositories created in #4 instead of raw DB calls
- [ ] Reduce `contextBuilder.ts` to a thin orchestrator
- [ ] Verify context output is byte-identical to pre-refactor (snapshot test on a known input)
- [ ] `bun run check && bun run lint` pass

### 11. Split `src/utils/discord/streamOrchestrator.ts`
- **What:** Separate the 111KB stream management.

**Subtasks:**
- [ ] Inventory `streamOrchestrator.ts` responsibilities (buffering, UI updates, flush logic, stop conditions)
- [ ] Create `src/utils/discord/stream/bufferManager.ts` for buffering and flush logic
- [ ] Create `src/utils/discord/stream/uiUpdater.ts` for Discord message edits/UI updates
- [ ] Wire each module to use the unified stream adapters from #6
- [ ] Verify no remaining provider-name switches in this file (per #6.5)
- [ ] Manual smoke test: streaming response in Discord with at least 3 different providers
- [ ] `bun run check && bun run lint` pass

---

## Phase 5: The Final Boss (Orchestrators)
*With all underlying dependencies refactored, the largest and most complex files can be safely dismantled.*

### 12a. Build the chat regression harness
- **What:** Build a minimal regression harness for `tomoriChat.ts` behavior **before** any deconstruction work begins. Ships independently and provides value catching regressions across Phase 4 repository migrations and other refactors that touch chat-adjacent code, even if #12b slips.
- **Why split:** Refactoring 443KB of orchestration logic without tests is high-risk. The harness is a substantial sub-project on its own (probably weeks). Splitting it lets the harness ship and earn its keep before #12b starts.

**Subtasks:**
- [ ] Inventory the behaviors to cover: golden-path message handling, tool calls (function calls + REST + MCP), multi-persona triggering, error paths, edge cases (empty mentions, malformed replies, rate limits)
- [ ] Decide harness shape: snapshot tests against recorded conversations? Mocked Discord client + recorded provider responses? Whichever is least flaky.
- [ ] Build the harness in `tests/regression/chat/` (or equivalent)
- [ ] Record golden-path fixtures for at least 3 providers (Google, OpenRouter, NovelAI)
- [ ] Wire the harness into `bun run test` so it runs in CI
- [ ] Document the harness in `docs/guides/testing-chat-changes.md`
- [ ] Verify the harness catches a deliberately introduced regression (smoke test the smoke test)
- [ ] `bun run check && bun run lint` pass

### 12b. Deconstruct `src/events/messageCreate/tomoriChat.ts`
- **What:** Break down the 443KB (~9,500 line) core chat logic.
- **Prerequisite:** #12a must be complete and the harness green on the unmodified `tomoriChat.ts`.

> **Helper-file location rule:** `eventHandler.ts` shallow-scans each `src/events/<eventName>/` folder, registering every direct `.ts` file as a handler that fires on the named Discord event. Helper modules **must not** live as siblings of `tomoriChat.ts` — they would be auto-registered and fire on every messageCreate. Helpers go in `src/utils/chat/` and are imported by `tomoriChat.ts` like any other utility. This mirrors the existing pattern (`src/utils/text/contextBuilder.ts`, `src/utils/discord/streamOrchestrator.ts`).

**Subtasks:**
- [ ] Inventory `tomoriChat.ts` responsibilities at a section level (trigger detection, context building, streaming, tool execution, response emission, error handling)
- [ ] Create `src/utils/chat/triggerProcessor.ts` — detect mentions, replies, auto-message conditions, persona trigger words
- [ ] Create `src/utils/chat/orchestrator.ts` — coordinate context building, provider streaming, tool execution
- [ ] Create `src/utils/chat/responseEmitter.ts` — webhook dispatch, embed assembly, fallback handling
- [ ] Move helper utilities used only by `tomoriChat.ts` into `src/utils/chat/helpers/`
- [ ] Reduce `src/events/messageCreate/tomoriChat.ts` to a thin entry point that imports from `src/utils/chat/` and wires the three pieces together
- [ ] Confirm no new `.ts` files were added directly under `src/events/messageCreate/` (other than the existing handlers)
- [ ] Run regression harness from #12a; investigate any deltas
- [ ] Manual smoke test: full conversation flow with tools, multi-persona, and webhook responses
- [ ] `bun run check && bun run lint` pass

### 13. Optimize `src/handlers/eventHandler.ts`
- **What:** Load event handlers once at startup instead of dynamically importing on every event.

> **Invariant (must hold post-refactor):** `eventHandler.ts` continues to **shallow-scan** each `src/events/<eventName>/` folder — only direct `.ts` files in that folder are treated as handlers. This is what allows helpers (`src/utils/chat/`, `src/utils/text/`, etc.) to be imported by handlers without themselves being auto-fired. If any future change makes the scan recursive, every helper file under `src/events/messageCreate/<sub>/` would silently fire on every message — verify this property is preserved when refactoring.

**Subtasks:**
- [ ] Replace dynamic `await import(eventFile)` inside event listeners with eager imports at boot
- [ ] Cache the loaded handler functions in a Map keyed by event name
- [ ] Replace `fs.existsSync` and `fs.readdirSync` with `Bun.glob` async scans (per Ongoing rule #21)
- [ ] Confirm the scan remains **shallow** (no recursion into subfolders of `src/events/<eventName>/`); add a code comment documenting this property
- [ ] Verify event handlers still fire correctly after the change
- [ ] Benchmark event-handling latency before/after to confirm improvement
- [ ] `bun run check && bun run lint` pass

---

## Phase 6: Database Schema Normalization (V2)
*Because we implemented the Repository pattern in Phase 2, we can now alter the underlying database schema without touching **any** application logic outside of the Repositories.*

> **Note:** TomoriBot currently has no formal migrations directory (`scripts/db/migrations/` does not exist). Schema lives in `src/db/schema.sql`, `schema_rag.sql`, and `schema_stpreset.sql`. Phase 6 should also introduce a lightweight migration runner so plugins (per `PLUGIN-ARCH_TASK-LIST.md` AC-6) can ship their own schema changes alongside their code.

### 14. Normalize the `tomori_configs` God Table
- **What:** Split the massive table into focused tables.
- **Plugin prereq:** Required by `PLUGIN-ARCH_TASK-LIST.md` AC-6.

**Subtasks:**
- [ ] Audit `tomori_configs` columns; group by domain (LLM, image gen, video gen, NAI, autochannel, conditioning, security, etc.)
- [ ] Design replacement tables (e.g., `server_llm_configs`, `server_imagegen_configs`, `server_naichat_configs`, `server_autochannel_configs`)
- [ ] Write migration to create new tables and copy data from `tomori_configs`
- [ ] Update `ConfigRepository` (from #4) to read/write the new tables
- [ ] Add backwards-compatibility view `tomori_configs` (or shim in repository) during transition
- [ ] Migrate all callers to use the new repository methods
- [ ] Drop the old `tomori_configs` table once safe
- [ ] Update `dataExport.ts` / import logic to handle new schema
- [ ] `bun run check-schema` passes (no drift)

### 15. Refactor JSONB Arrays into Junction Tables
- **What:** Replace FK JSONB arrays with M2M junction tables.

**Subtasks:**
- [ ] Identify all JSONB array columns holding FK references (e.g., `fallback_llm_ids`, `autoch_disc_ids` if FK-shaped, etc.)
- [ ] Design junction tables for each (e.g., `tomori_fallback_llms` with `tomori_id` + `llm_id` + `priority`)
- [ ] Write migrations to create junction tables and backfill from JSONB columns
- [ ] Update repositories to use junction-table queries
- [ ] Add FK constraints to enforce referential integrity
- [ ] Drop the old JSONB columns once callers migrated
- [ ] `bun run check-schema` passes

### 16. Separate State from Configuration
- **What:** Move stateful columns out of static config schemas.

**Subtasks:**
- [ ] Identify stateful columns currently in config tables (e.g., `consecutive_failures`, `last_error_at`, runtime counters)
- [ ] Design dedicated state tables (e.g., `tomori_runtime_state`, `llm_health_state`)
- [ ] Migrate state columns out of config tables
- [ ] Update repositories to read state from new tables
- [ ] Update export/import logic to skip state tables (state is not exported)
- [ ] `bun run check-schema` passes

### 16.5. Introduce a migration runner
- **What:** Add a sequential migration system. Currently TomoriBot has none — schema lives in static `.sql` files.
- **Plugin prereq:** Required by `PLUGIN-ARCH_TASK-LIST.md` AC-6.

**Subtasks:**
- [ ] Create `src/db/migrations/` directory
- [ ] Define migration file naming convention (`NNN_description.sql`, zero-padded)
- [ ] Create `schema_migrations` tracking table on first boot
- [ ] Implement migration runner in `src/db/migrationRunner.ts` (read pending files, apply in order, record in tracking table)
- [ ] Wire the runner into `initializeDatabase.ts` to run on boot
- [ ] Convert existing `schema.sql`, `schema_rag.sql`, `schema_stpreset.sql` into baseline migration `001_baseline.sql`
- [ ] Add a `bun run db:migrate` script for manual application
- [ ] Document the migration workflow in `docs/systems/database-schema.md`
- [ ] Verify a fresh DB bootstraps cleanly via migrations only

**Rollback discipline (required for #14, #15, #16 to be safe):**
- [ ] Establish the rule: every migration ships with either a paired `NNN_description.down.sql` rollback OR a documented "if this fails, here's how to recover" runbook section in the migration's accompanying PR description. Forward-only migrations on the `tomori_configs` god table are a foot-gun and not acceptable.
- [ ] Add a CI check (or PR review checklist item) that fails if a migration in `src/db/migrations/` lacks a rollback artifact
- [ ] Document the rollback policy in `docs/systems/database-schema.md`
- [ ] For destructive migrations (DROP COLUMN, DROP TABLE), require a "soak period" of at least one release where the column/table is unused but still present, so rollback is a code revert rather than a data restore

---

## Phase 7: Localized Optimizations & "Hacky" Cleanups
*Smaller, targeted refactoring tasks that address specific technical debt, anti-patterns, and localized inefficiencies. These can be done in parallel or tackled whenever touching the respective systems.*

### 17. Break the Logger/DB Circular Dependency
- **What:** Refactor `logger.ts` and `db/client.ts` to remove circular dependency.

**Subtasks:**
- [ ] Diagnose the current circular import (which symbols are imported in which direction)
- [ ] Decide approach: event emitter pattern OR an intermediate `errorLogRepository.ts`
- [ ] Implement chosen pattern
- [ ] Update `db/client.ts` to use the actual logger instead of `console.log`
- [ ] Verify no new circular imports introduced (`bun run check`)
- [ ] `bun run check && bun run lint` pass

### 18. Eradicate Swallowed Promises (`.catch(() => {})`)
- **What:** Remove silent error swallowing.

**Subtasks:**
- [ ] Implement `safeReply()` utility in `src/utils/discord/safeReply.ts` that ignores expected Discord timeouts (code 10062, 40060, etc.) but logs everything else
- [ ] Grep the codebase for `.catch(() => {})` patterns
- [ ] Replace each instance with `safeReply()` (for Discord replies) or proper `.catch((err) => log.warn(...))` (for everything else)
- [ ] Audit `src/commands/config/model/fallback.ts` and `video.ts` specifically (called out by name)
- [ ] `bun run check && bun run lint` pass

### 19. *(Subsumed by Phase 3 #7)* Remove the `process.stdout.write` Monkey-Patch
- **Status:** This task was duplicated. It is now part of Phase 3 #7 ("Split `src/tools/toolRegistry.ts` & Fix MCP Hacks"). Kept here as a pointer so anyone reading Phase 7 in isolation finds it.

### 20. *(Reserved — was missing from numbering)*

### 21. Eradicate Synchronous I/O on the Main Thread
- **What:** Replace `fs.readFileSync`, `fs.existsSync`, `fs.readdirSync` with `Bun.file().*` async equivalents.

**Subtasks:**
- [ ] Grep for all `fs.*Sync` usages (~20+ instances expected)
- [ ] Audit each instance: callsite is sync-required (boot-only) or can be async?
- [ ] Replace boot-time-only sync calls with async + `await` chain at boot
- [ ] Replace runtime sync calls with `await Bun.file(path).json()` / `.text()` / `.exists()`
- [ ] Specific files to audit: `localTokenizerRegistry.ts`, `mcpConfig.ts`, `commandLoader.ts`, `eventHandler.ts`, `ioHelper.ts`
- [ ] Add in-memory caching where the same file is read repeatedly
- [ ] `bun run check && bun run lint` pass

---

## Open Design Decisions

These are choices the plan suggests but does not lock in — they need human-opinion before the relevant phase starts. Each lists the question, the options, the recommended default, and what's at stake. Once maintainer decides, replace the OD entry with the chosen path so the plan stops looking like it's still pending.

### OD-R-1: Locale category split (#1) — **DECIDED: (A)**
**Decision:** Fragment the global locale tree into `general`, `commands`, `errors`, `tools`, `providers`, `bridges` (6 categories), matching existing folder structures (`src/commands/`, `src/tools/`, `src/providers/`).
**Why:** (B) creates 25+ files for a marginal organizational gain. (C) underspecifies what counts as "core." (A) lines up with what already exists in code.
**Plugin convenience is independent of this choice:** every plugin owns its own `<plugin>/locales/{en-US,ja}.ts` slice regardless of how the global tree fragments. Deleting a plugin folder removes its locale keys cleanly — that promise comes from the plugin contract (`PLUGIN-ARCH_TASK-LIST.md` AC-5), not from this OD.

### OD-R-2: Repository granularity (#4) — **DECIDED: (C) + ShortTermMemory split**
**Decision:** 12 repositories: User, **ServerMemory, PersonalMemory, ConditioningMemory, ShortTermMemory** (Memory's four sub-domains split out — they live in different tables and ShortTermMemory is anticipated to grow), Config, Persona, Server, Llm, Tool, Rag, ImportExport.
**Why:** Splitting Memory up front avoids a future "fat MemoryRepository" refactor. ShortTermMemory in particular is expected to gain functionality, so investing in its own boundary now pays off. ImportExport stays as its own repo for the migration; can be merged into Server later if it proves too small.
**At stake:** Too few repos = god-file in repo clothing. Too many = boilerplate without value. The four-way Memory split is the deliberate exception, justified by separate tables and divergent future direction.

### OD-R-3: BaseStreamAdapter shape (#6) — **DECIDED: (A) inheritance**
**Decision:** Abstract `BaseStreamAdapter` class; provider adapters extend it and override hooks (`onContextBuild`, `onChunk`, `onFlush`, etc.).
**Why:** Existing adapter code is already class-shaped (`googleStreamAdapter`, `openrouterStreamAdapter`), so inheritance has a smaller diff. Future per-provider behavioral hooks (the plugin plan's "behavioral modifiers" use case) are served by subclass overrides — the contributor extends the base class and overrides the hook they need. (B) composition is theoretically more flexible but adds machinery without a current consumer.
**At stake:** This shape gets locked in at Phase 3 and influences how plugin providers extend the base in Phase C of the plugin plan.

### OD-R-4: MCP monkey-patch replacement (#7) — **DECIDED: (D) per-child-process stream filter**
**Re-grounded context:** The monkey-patch in `src/utils/mcp/mcpManager.ts:79–93` is bounded — it's swapped in only during MCP init and restored at line 119. Its purpose is filtering banner art (`╔══╗` boxes) some MCP servers print on startup, *not* capturing JSON-RPC output (which already goes through `StdioClientTransport` per-child pipes, line 10/166). The "stability crisis" framing in the original options was overstated.
**Decision:** (D) Filter banner output at the child-process stream level. Each MCP server is already spawned with `stdio: "pipe"` via `StdioClientTransport`; install a transform that strips banner lines from each child's stdout chunk before the SDK forwards it. Never touch the parent's `process.stdout`.
**Why:** Architecturally correct — banner filtering is a per-child concern, not a global one. Removes the monkey-patch entirely. No risk of corrupting parent stdout under any failure mode.
**At stake:** Stability + cleanliness. The original (A) "child-process isolation" is already in place via the SDK; the real fix is moving the filter into per-child pipes, not adding another layer of process isolation.

### OD-R-5: Logger/DB circular dep (#17) — **DECIDED: (B) errorLogRepository shim**
**Decision:** Introduce `src/utils/db/repositories/errorLogRepository.ts` (or fold it into an existing repo per OD-R-2). Logger calls into the repo, which has no logger import. Cycle broken with one new file.
**Why:** Smallest possible diff. The cycle is one-link-deep, so a one-file shim is the minimum-disruption fix. (A) event emitter is architecturally cleaner but introduces an event-bus pattern with no other use case in the codebase today — speculative complexity.
**At stake:** Diagnostic infrastructure — a broken logger means broken postmortems.

### OD-R-6: Down-migration shape (#16.5) — **DECIDED: (A) paired files + (C) runbook escape hatch**
**Decision:** Paired files in the same directory (`042_foo.up.sql` + `042_foo.down.sql`) for routine migrations. For migrations where a `.down.sql` is impractical (e.g., DROP COLUMN with data — a SQL file cannot restore lost rows), the migration ships a runbook section in the PR description instead. The CI rule below makes the absence of a rollback artifact visible, never silent.
**Why:** Paired files keep rollbacks adjacent to forward migrations — easy to find at 3am. The runbook escape hatch acknowledges that some forward migrations are inherently irreversible at the data level. Forbidding down-migrations from being silently skipped (per the CI rule in #16.5) preserves operational safety either way.
**At stake:** Operational safety. A schema migration that breaks production at 3am needs a clear path to undo, even if "undo" means executing a runbook rather than running a SQL file.

### OD-R-7: stringHelper migration approach (#2) — **DECIDED: (A) barrel re-export**
**Decision:** Replace `stringHelper.ts` with a barrel: `export * from "./processors/..."`. Existing import sites keep working. The barrel can be deleted in a follow-up cleanup once imports have been audited and updated.
**Why:** Lower risk, smaller diff per phase. (B) hard cutover makes #2 a much bigger PR with no behavioral benefit.
**At stake:** Diff size of the Phase 1 PR.

---

## Risks & Mitigations

The plugin plan has its own risk register at `PLUGIN-ARCH_TASK-LIST.md §9`. This section covers refactor-specific risks that the plugin plan does not.

### R-1: Phase 4b stale-cache regression surfaces weeks after merge
With 115+ DB exports moving into repositories, even with the #4a harness and the cache-invalidation audit, it is realistic that one invalidation site is missed and a stale-cache bug surfaces in production weeks later as "Tomori is using the old persona" or "memory updates not reflected." This class of bug is hard to reproduce locally and easy to misattribute to LLM hallucination.

**Mitigation:**
- The #4a harness must include at least one cache-invalidation assertion per repository (write → cache → re-read).
- After Phase 4b ships, instrument cache hit/miss rates for the first 2 weeks. A sudden hit-rate spike or stale-data report is the early-warning signal — investigate immediately rather than dismissing as user error.
- Keep the audit checklist (from #4b's mandatory subtask) committed to the repo as `docs/refactor/phase4-cache-audit.md` so a post-mortem can compare actual vs. intended invalidation sites.

### R-2: Mid-flight schema migration rollback during high-traffic hours
Phase 6 (#14, #15, #16) rewrites `tomori_configs` and adds junction tables. If a migration partially completes and must be rolled back, the database can be in an inconsistent state where new code expects the new shape and old code expects the old shape.

**Mitigation:**
- The #16.5 rollback discipline (paired `.down.sql` or runbook, soak period for destructive migrations) directly addresses this — but only if executed.
- Schedule destructive migrations during low-traffic windows. Document the maintenance window in the migration's accompanying PR description.
- For the `tomori_configs` split (#14) specifically, use the **expand-then-contract** pattern: ship the new tables and dual-write from `ConfigRepository` first; verify a release in production; *then* ship the cutover that drops the old columns. Each step is independently revertable.

### R-3: Phase 12b regression harness has coverage gaps
The #12a harness is a snapshot test against recorded conversations and fixtures. If a behavior is not in the fixture set, the harness will not catch its regression. `tomoriChat.ts` is 9,500 lines — there *will* be edge cases the fixtures miss.

**Mitigation:**
- Treat #12a as a living artifact, not a one-shot deliverable. When a post-#12b bug surfaces, the fix lands with **a new fixture covering the regression** so it cannot recur.
- Bias the initial fixture set toward edge cases (empty mentions, malformed replies, error paths, multi-persona triggering, tool failure mid-stream) rather than only golden paths. Golden paths are easy to catch; edge cases are where regressions hide.

### R-4: Plan stalls halfway and leaves codebase worse than starting state
The phases are sequenced bottom-up so each foundation is ready before the next layer. But if the plan stalls mid-Phase-4 (say, repositories built but only half the callers migrated), the codebase ends up with **two parallel data-access patterns** — repositories *and* the surviving god-file imports — which is strictly worse than either pure state.

**Mitigation:**
- No phase is considered "done" until all callers in that phase's scope are migrated. A repository sitting alongside `dbRead.ts` with mixed-mode callers is "in progress," not "shipped."
- If a phase needs to pause, leave the **old** path intact and the new repositories not yet introduced — better to delay the start than to leave a half-migrated state.
- Re-evaluate plan momentum at each phase boundary. If three months pass without phase progress, treat the plan as stalled and decide explicitly: resume, descope, or abandon. A stalled refactor consumes contributor attention without paying it back.

### R-5: Refactor competes with feature work for the same files
The largest refactor targets (`tomoriChat.ts`, `contextBuilder.ts`, `dbRead.ts`) are also the files where new features land. A long-lived refactor branch will accumulate merge conflicts; per-PR refactor commits risk feature commits stomping the refactor mid-flight.

**Mitigation:**
- Prefer per-PR shipping (one phase ≈ one PR) over long-lived branches. Merge conflicts are smaller and more tractable.
- Communicate scheduled refactor windows to other contributors before starting a phase that touches a god file. "Phase 4b lands this week — please hold non-urgent dbRead.ts changes."
- For phases touching `tomoriChat.ts`, the #12a harness doubles as a coordination tool: any feature PR that breaks the harness signals incompatibility with the in-flight refactor.

---

## Ongoing: Things to Do While Refactoring
*These are continuous practices to apply to every file during the refactoring process to improve Developer Experience (DX) and codebase maintainability.*

### 1. Remove Redundant & "Play-by-Play" Comments
- **What:** Delete comments that simply state *what* the code is doing. Rely on clear variable and function naming to make the code self-documenting.
- **Why:** Redundant comments (esp. the numbered comments) add visual noise, inflate file sizes, and often become outdated when code changes, creating misleading "lies" in the codebase.
- **How:** Only keep inline comments that explain the **"Why"** (e.g., a specific business rule, an edge-case workaround, or a hack needed due to an external API bug).
  - **Bad (Delete this):**
    ```typescript
    // Increment user quota
    userQuota++;
    
    // Check if the file exists
    if (await Bun.file(path).exists()) { ... }
    ```
  - **Good (Keep this):**
    ```typescript
    // We add a 10% buffer here because the Discord API frequently under-reports the actual byte size of attachments.
    const safeMaxBytes = DISCORD_LIMIT * 0.9;
    ```

### 2. Prioritize Code Readability Over Comments
- **What:** Instead of writing a comment to explain a complex or unreadable block of code, refactor the code itself to be readable.
- **Why:** Comments should not be a crutch for bad code.
- **How:** Extract complex boolean logic into well-named variables. Break down massive functions into smaller, single-purpose helper functions with descriptive names.
  - **Bad (Complex condition with a comment):**
    ```typescript
    // Check if user is admin, hasn't exceeded quota, and the channel isn't blacklisted
    if (user.role === 'admin' && user.quota < 100 && !blacklistedChannels.includes(channel.id)) { ... }
    ```
  - **Good (Self-documenting code):**
    ```typescript
    const isAdmin = user.role === 'admin';
    const hasRemainingQuota = user.quota < 100;
    const isAllowedChannel = !blacklistedChannels.includes(channel.id);
    const isEligibleForCommand = isAdmin && hasRemainingQuota && isAllowedChannel;
    
    if (isEligibleForCommand) { ... }
    ```

### 3. Enforce JSDoc/TSDoc for Public Interfaces
- **What:** Ensure all exported functions, classes, and types/interfaces have proper JSDoc comments.
- **Why:** JSDoc provides crucial intellisense for developers importing these utilities in other files, preventing them from needing to read the implementation details to understand how to use the API.
- **How:** Document parameters, return types, and potential errors thrown, but avoid narrating the internal implementation within the JSDoc.
  - **Bad (No JSDoc or internal narration):**
    ```typescript
    export function processText(text: string) {
      // First we trim the text
      const trimmed = text.trim();
      // Then we return it
      return trimmed;
    }
    ```
  - **Good (JSDoc with no internal narration):**
    ```typescript
    /**
     * Normalizes input text by removing trailing whitespace and standardizing line endings.
     * 
     * @param text - The raw string input from the user.
     * @returns The normalized string ready for database insertion.
     * @throws {Error} If the input string exceeds the maximum character limit.
     */
    export function normalizeText(text: string): string { ... }
    ```

### 4. Eradicate `any` and Type Bypassing
- **What:** Remove usage of `as any` and `any` types that bypass the TypeScript compiler.
- **Why:** Bypassing the compiler ("vibe-coding" until it compiles) defeats the purpose of using TypeScript. If the underlying library changes, you will silently crash at runtime instead of catching the error during build time.
- **How:** If a type is unknown, use `unknown` and narrow it with a type guard. If a library's type definition is incomplete, extend the interface or use declaration merging instead of casting to `any`.
  - **Bad (The `as any` hammer):**
    ```typescript
    (pinoLogger as any).success("Started bot"); // No type safety!
    
    // Using any because the type is complex
    type TransactionSql = any;
    ```
  - **Good (Type-safe extension):**
    ```typescript
    // Extend the module definition to include the custom method
    declare module 'pino' {
      interface Logger {
        success(msg: string): void;
      }
    }
    pinoLogger.success("Started bot");
    ```

### 5. Stop Silent Error Swallowing (The "Ostrich" Pattern)
- **What:** Never use an empty catch block (`.catch(() => {})`).
- **Why:** Swallowing errors blindly hides API rate limits, network instability, and missing permission errors. This makes debugging impossible and creates a terrible experience when users report the bot is "broken" but the logs are completely empty.
- **How:** Always log errors, or explicitly handle expected errors. If an error is truly expected (like a Discord interaction timeout), log it as a debug event rather than ignoring it completely.
  - **Bad (Silent Failure):**
    ```typescript
    await interaction.editReply({ embeds: [] }).catch(() => {});
    ```
  - **Good (Logged and Handled):**
    ```typescript
    await interaction.editReply({ embeds: [] }).catch(error => {
      // Ignore "Unknown interaction" errors if the token expired, but log everything else
      if (error.code !== 10062) {
        log.warn("Failed to edit reply on timeout:", error);
      }
    });
    ```

### 6. Avoid Global Mutations and Side Effects
- **What:** Do not mutate global Node.js objects (like `process.stdout.write`) or parameters passed into your functions unless explicitly designed to do so.
- **Why:** Monkey-patching globals for a localized feature (like an MCP tool execution) can permanently break the entire application if the local feature crashes or hangs.
- **How:** Use proper scoped abstractions (e.g., spawn dedicated child processes with `stdio` pipes, use `EventEmitter`, or pass contextual configuration objects) instead of overriding global state.

### 7. Keep Documentation Updated (`/docs/` and READMEs)
- **What:** When refactoring a core system, changing a configuration schema, or updating an API, immediately update the corresponding `/docs/` or README files.
- **Why:** Stale documentation is worse than no documentation. It misleads contributors and leads to wasted time debugging "why the instructions aren't working."
- **How:** Follow the **Documentation Alignment Protocol** at the top of this document. Each phase row in the tracker lists exactly which docs to update; the closing subtask of each phase bumps the `<!-- ARCH-ALIGNMENT: ... -->` marker on those docs. A PR that ships code changes without bumping the marker is incomplete.

### 8. Eradicate Magic Numbers and Hardcoded Strings
- **What:** Extract random numbers (`86400`, `10062`) and scattered hardcoded strings into well-named constants.
- **Why:** Magic numbers carry no context. If a value needs to change in the future, hunting down every inline usage is error-prone.
- **How:** Declare them at the top of the file or in a shared `constants.ts` file.
  - **Bad:** `setTimeout(doWork, 300000);`
  - **Good:** `const FIVE_MINUTES_MS = 300_000; setTimeout(doWork, FIVE_MINUTES_MS);`

### 9. Delete Zombie Code (Commented-out Code)
- **What:** Remove blocks of code that have been commented out.
- **Why:** "I might need this later" is what Git history is for. Leaving commented-out code creates clutter, confuses other developers ("Is this broken? Should it be enabled?"), and rots as the surrounding codebase evolves.
- **How:** Delete it completely. If you need it back, look at the commit history.

### 10. Write "Anti-Slop" Documentation (The Diátaxis Approach)
- **What:** Ensure `/docs/` are written for rapid consumption, without fluff, academic preambles, or excessive stylistic Markdown (like unnecessary em-dashes or nested blockquotes). Use tables where appropriate for data mapping.
- **Why:** Documentation "slop" happens when writers try to be conversational instead of informational. If a junior developer cannot skim it to find the setup command, and a senior developer cannot `Ctrl+F` it to find the architecture constraint, the document has failed.
- **How:** Structure documents functionally.
  - **Bad (Conversational Slop):** "As you might know, TomoriBot uses a really cool event system—which we built last year—that essentially takes the Discord events and..."
  - **Good (Direct & Factual):** "TomoriBot routes Discord events through `src/handlers/eventHandler.ts`. It maps Discord event names to folders in `src/events/`."
  - Follow the **"Progressive Disclosure"** rule: Start with the TL;DR or the exact command (for junior devs), followed by the "Why" and edge-cases further down (for advanced devs).