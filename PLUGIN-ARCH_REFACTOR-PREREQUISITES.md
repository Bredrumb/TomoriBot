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
| **#14 Partition `tomori_configs` + audit `tomoris`** | `docs/systems/database-schema.md`, `docs/ai/multi-persona.md` |
| **#14.2 Pass C voice migration** | `docs/systems/database-schema.md` |
| **#14.5 Drop deprecated provider-config columns** | `docs/systems/database-schema.md` |
| **#14.6 One-main-persona-per-server invariant** | `docs/systems/database-schema.md` |
| **#15 JSONB → junction tables** | `docs/systems/database-schema.md` |
| **#16 Separate state from config** | `docs/systems/database-schema.md` |
| **#16.5 Migration runner** | `docs/systems/database-schema.md` |
| **#16.7 Export/import pipeline composition** | `docs/systems/database-schema.md` |
| **#16.8 `tomoris` → `personas` rename** | `docs/systems/database-schema.md`, `docs/core/architecture.md`, `docs/ai/multi-persona.md` |
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
- [x] Decide category split (e.g., `general`, `commands`, `errors`, `tools`, `providers`, `bridges`)
- [x] Create `src/locales/en-US/` and `src/locales/ja/` directories
- [x] Move keys from `en-US.ts` into category files; ensure type structure preserved
- [x] Mirror exact same keys in `ja/` files
- [x] Update `localizer()` to merge slices into one tree at boot
- [x] Update `check-locales` script to scan the new directory structure
- [x] Delete old monolithic `en-US.ts` and `ja.ts`
- [x] **Smoke test:** boot the bot and verify at least one localized reply renders correctly in each locale (en-US, ja). `check-locales` confirms key parity but does NOT verify the runtime merge — a broken `localizer()` merge ships raw keys to users without failing any structural gate.
- [x] `bun run check && bun run lint && bun run check-locales` pass

### 2. Simplify `src/utils/text/stringHelper.ts`
- **What:** Break down the 73KB file of complex regex chains into specialized processors.

**Subtasks:**
- [x] Inventory all exported functions in `stringHelper.ts`; group by purpose (emoji, markdown, mentions, normalization)
- [x] Create `src/utils/text/processors/` with one file per group (`emojiProcessor.ts`, `markdownProcessor.ts`, etc.)
- [x] Move functions to appropriate files; preserve signatures
- [x] Replace `stringHelper.ts` with a barrel re-export for backwards compatibility, or update all import sites
- [x] Add unit tests for the most complex regex chains before/during the move
- [x] `bun run check && bun run lint` pass

### 2.5. Delete `tomoriChat.ts.backup` zombie file
**Subtasks:**
- [x] Verify nothing imports `tomoriChat.ts.backup`
- [x] Delete the file
- [x] Confirm git history still contains it for archaeological needs

### 3. Decouple `src/index.ts` & Remove Hacks
- **What:** Split the 17KB `index.ts` into specialized initialization modules (`src/init/`). Replace `process.env` mutations with a typed config object.

**Subtasks:**
- [x] Create `src/init/` directory
- [x] Extract DB init into `src/init/database.ts`
- [x] Extract Discord client init into `src/init/discord.ts`
- [x] Extract event/command/tool loader bootstrapping into `src/init/loaders.ts`
- [x] Extract Matrix bridge init into `src/init/bridges.ts` (until Phase E moves it to a plugin)
- [x] Define typed `AppConfig` interface in `src/types/config.ts`
- [x] Replace `process.env.X = ...` mutations with explicit config-object usage
- [x] Reduce `index.ts` to a thin orchestrator that calls each `init/*` in order
- [x] **Smoke test:** `bun run dev` boots to ready state with each `init/*` module logging success in the expected order. A reordered or failed init module is invisible to `check && lint`.
- [x] `bun run check && bun run lint` pass

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
- **Export contract:** Repository interface MUST require `toExportShape()` / `fromExportShape()` methods from day one. No repository lands without them. (Phase 6 #16.7 depends on every repo exposing these; backfilling later means touching every repo twice.)

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
- [ ] **Smoke test:** in a test guild, run `/tool status` and `/tool compact`; verify all sections of each command render correctly (provider stats, DB stats, cache stats, MCP status for `/tool status`; compaction flow for `/tool compact`). Both commands are diagnostic dumps where silent breakage is plausible.
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
- [ ] **Smoke test:** boot the bot and verify the provider registry log lists all expected providers as discovered (Google, OpenRouter, NovelAI, Custom, etc.). A provider going dark after the hardcoded array is removed would otherwise be invisible until someone runs a command against it.
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
- [ ] **Smoke test:** in a test guild, run at least one command exercising each interaction surface — a modal-open command, a paginated reply, and a button-interaction reply. Webhook split needs at least one persona-dispatched reply verified. Type-safety doesn't catch miswired UI plumbing.
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
- **Prerequisite:** Phase 2 #4b complete (repositories must exist so each new context module can consume them instead of raw DB calls).

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
- **Prerequisite:** Phase 3 #6 (unified `BaseStreamAdapter`) and #6.5 (provider auto-discovery + name-switch purge) complete.

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
- [ ] **Smoke test:** concretely verify `messageCreate`, `guildMemberAdd`, and `interactionCreate` handlers all fire in a test guild after the change. (The existing "verify handlers still fire" subtask was too vague — if any one of these regresses, a specific feature silently dies.)
- [ ] Benchmark event-handling latency before/after to confirm improvement
- [ ] `bun run check && bun run lint` pass

---

## Pre-Phase 6 Quick Win (optional, ship standalone)

### Apply the `welcome_prompt` export fix against the current schema
- **What:** Ship the `welcome_prompt` export fix from `plans/EXPORT_IMPORT_REFACTOR_PLAN.md` as a standalone PR against the **current** (pre-split) schema. ~5 files. Pays down a real bug today.
- **Why standalone:** The Phase 6 refactor doesn't need to carry this fix. Shipping it now means the bug is closed before Phase 6 begins, and the eventual archival of `plans/EXPORT_IMPORT_REFACTOR_PLAN.md` (in #16.7) doesn't take a known-real fix down with it.
- **Sequencing:** Independent of every other Phase 6 prerequisite. Can ship at any time — the only requirement is that it lands before #16.7 archives the old plan.

**Subtasks:**
- [ ] Re-read `plans/EXPORT_IMPORT_REFACTOR_PLAN.md`'s `welcome_prompt` section against current `dataExport.ts` / `dataImportV2.ts` to confirm the bug still reproduces
- [ ] Apply the fix as described in the old plan
- [ ] Add or update a regression case in the export/import test suite so the bug cannot recur
- [ ] `bun run check && bun run lint && bun run check-locales && bun run test` pass

---

## Phase 6: Database Schema Normalization (V2)
*Because we implemented the Repository pattern in Phase 2, we can now alter the underlying database schema without touching **any** application logic outside of the Repositories.*

> **Prerequisite:** Phase 2 #4b green; Phase 1.5 Pass B deprecated-mirror drop complete. Schema-altering migrations touch 115+ call sites without repositories; Pass B's mirror cleanup must finish before partitioning runs against those columns.

> **Sequencing:** Phase 6 steps run #14 → #14.2 → #14.5 → #14.6 → #15 → #16 → #16.7 → #16.8 as a hard sequential chain (treat like the plan's `a`/`b` convention — a step cannot start until the previous step's quality gates are green). The final rename (#16.8) is deliberately last so every interim state remains coherent under the old `tomori_*` naming, and rollback is one `ALTER TABLE personas RENAME TO tomoris` away if anything breaks.

> **Note:** TomoriBot currently has no formal migrations directory (`scripts/db/migrations/` does not exist). Schema lives in `src/db/schema.sql`, `schema_rag.sql`, and `schema_stpreset.sql`. Phase 6 should also introduce a lightweight migration runner so plugins (per `PLUGIN-ARCH_TASK-LIST.md` AC-6) can ship their own schema changes alongside their code.

### 14. Partition `tomori_configs` + audit `tomoris` along command write boundaries
- **What:** Split the god `tomori_configs` table into 12 command-aligned `server_*_configs` tables, and extract persona-scoped concerns from `tomoris` into command-aligned `persona_*_configs` tables. Organizing principle: **one table per command write surface** — when a user runs `/config humanizer`, only one row in one table changes.
- **Plugin prereq:** Required by `PLUGIN-ARCH_TASK-LIST.md` AC-6.

**Scope:**

Migrate residual server-scoped columns from old `tomori_configs` into 12 command-aligned `server_*_configs` tables:
- `server_capabilities_configs` (owned by `/capabilities manage`, `/capabilities toggle`)
- `server_memberpermissions_configs` (owned by `/config member-permissions`)
- `server_chat_configs` (owned by `/config humanizer`, `/config message-fetch-limit`, `/config send-limit`, `/config match-limit`, `/config cascade-limit`, `/config timezone`, `/config self-debug`, `/config system-prompt set/remove/preset`, `/config context-note set`)
- `server_noticeembeds_configs` (owned by `/config notice-embeds visibility`)
- `server_autotrigger_configs` (owned by `/server auto-trigger channels`, `/server auto-trigger threshold`)
- `server_channelscope_configs` (owned by `/server rp-channels`, `/server private-channels`, `/server crosschannel-blocklist`, `/server stm privacy-bypass`, `/server thought-logs-channel`)
- `server_welcome_configs` (owned by `/server welcome-channel set/remove`)
- `server_trigger_behavior_configs` (owned by `/server always-reply`, `/server deliberate-trigger-mode`, `/server cooldown triggers`)
- `server_nsfw_configs` (owned by `/nsfw jailbreaks`)
- `server_speech_configs` (owned by `/speech chatterbox parameters`, `/speech transcripts`)
- `server_byok_configs` (owned by `/server user-byok toggle` — kept standalone to prevent capabilities-namespace bleed)
- `server_memory_configs` (owned today by `/memory tagging set`; seeded with one column so future `/memory config *` commands have an obvious home)

Audit `tomoris` table — extract persona-scoped concerns into command-aligned tables:
- `persona_context_note_configs` (split from `personas`: `context_note`, `context_note_depth`)
- `persona_voice_configs` (`speech_voice_*` columns and the deprecated `elevenlabs_*` pair — Pass C in #14.2 finishes that migration)
- `persona_imagegen_configs` (`nai_tags`, `nai_char_ref_url`)
- `persona_textgen_configs` (`nai_attg_author`, `nai_attg_title`, `nai_attg_tags`, `nai_attg_genre`, `nai_attg_stars`)

Consolidate `tomoris.alter_triggers` into `persona_configs.trigger_words` — backfill, then drop the column and remove the `persona.is_alter ? alter_triggers : persona_configs.trigger_words` ternary from 10+ readers (`tomoriChat.ts`, `dbRead.ts`, `tool/status.ts`, etc.).

Migrate user-scoped personalization fields out of `users` into `user_personalization_configs`: `shortterm_cache_crossserver_opt_in`, `nai_char_tags`, `nai_char_ref_url`, `impersonation_prompt`, `personal_dtm`. After extraction, `users` is left with pure identity (`user_disc_id`, `user_nickname`, `language_pref`, `privacy_level`, `registration_locale`).

**Acceptance criterion per table:** export/import round-trip green via repository `toExportShape()` / `fromExportShape()` BEFORE the step is closed. The export pipeline doubles as the drift-checker's source of truth — keeping export in lockstep with each table split keeps the safety net live throughout.

**Endpoint:** drop the old server-scoped `tomori_configs` (the god table) entirely. The name dies; do not reuse it.

**`check-schema` script update:** add a soft warning when any `*_configs` table column count exceeds **~15 columns**, enforcing the fission-threshold guideline so mid-grained tables don't passively drift back into god-table shape. Exempt `server_capabilities_configs` (uniform boolean cluster iterated by `/capabilities manage`'s `PERMISSION_DEFINITIONS` array — growth here is structurally uniform) and `saved_provider_configs` (atomic snapshot table — `/server save-provider` writes all columns together; document the threshold-exceeded justification inline so future audits don't re-litigate).

**Subtasks:**
- [ ] Stand up the 12 `server_*_configs` tables and 4 new `persona_*_configs` tables; write CREATE TABLE migrations (paired `.down.sql` per OD-R-6)
- [ ] Stand up `user_personalization_configs`; write migration
- [ ] Backfill data: per-column COPY from `tomori_configs` → corresponding `server_*_configs` table; per-column COPY from `tomoris` and `users` into their new homes
- [ ] Extend each repository (or add new ones per Phase 2 #4b) with reads/writes against the new tables; each new repo ships with `toExportShape()` / `fromExportShape()`
- [ ] Per table: dual-write through repositories during cutover (expand-then-contract, per Risk R-2 mitigation)
- [ ] Verify export/import round-trip green per table
- [ ] Migrate callers to use the new repository methods; remove all references to the old god-table columns
- [ ] Consolidate `tomoris.alter_triggers` → `persona_configs.trigger_words`: backfill, delete the ternary from 10+ readers, drop the column
- [ ] Drop `tomori_configs` (the server-scoped god table) entirely at the end of the step
- [ ] Update `docs/ai/multi-persona.md:23, 56, 442, 498` to reflect the unified trigger-word storage; bump ARCH-ALIGNMENT marker on schema docs
- [ ] Add `check-schema` soft-warning rule (>15 columns) with the documented exemption list
- [ ] `bun run check && bun run lint && bun run check-schema && bun run test` (the #4a DB regression harness) pass

### 14.2. Complete the stalled `elevenlabs_*` → `speech_*` voice migration (Pass C)
- **What:** Finish the stalled deprecation in `persona_voice_configs`. `seed.sql:2286–2288` started backfilling `elevenlabs_*` → `speech_*` for existing rows, but `/speech voice-assign:374` still writes both columns and 15+ readers in providers/tools/commands use a `speech_voice_id || elevenlabs_voice_id` fallback pattern.
- **Sequencing:** Runs after #14 — bundled with the persona-scoped split because we're touching every voice caller anyway.

**Subtasks:**
- [ ] Backfill any remaining unmigrated rows: extend the `seed.sql:2286–2288` pattern into a one-shot migration that copies `elevenlabs_voice_id` → `speech_voice_id` and `elevenlabs_voice_name` → `speech_voice_name` for any row still missing the new values
- [ ] Update `/speech voice-assign` to write only `speech_*` columns
- [ ] Remove the `speech_voice_id || elevenlabs_voice_id` fallback from all 15+ readers (providers/tools/commands); simplify to direct `speech_*` reads
- [ ] Drop `elevenlabs_voice_id` and `elevenlabs_voice_name` columns from `persona_voice_configs`
- [ ] `bun run check && bun run lint && bun run check-schema && bun run test` pass

### 14.5. Drop accumulated deprecated columns on provider config tables
- **What:** Clean up the deprecated columns that accumulated on `saved_provider_configs` and its user-scoped twin `user_saved_provider_configs` while Phase 3 and Pass B were running.
- **Sequencing:** Runs after #14.2.

**Scope:**

Drop from `saved_provider_configs`:
- `custom_endpoint_url`, `custom_model_name`, `custom_num_ctx` (Phase 3 — superseded by the `custom_endpoints` table)
- `fallback_llm_ids` (Phase 3 — superseded by `fallback_model_refs`)
- `channel_llm_overrides` JSONB at `schema.sql:2273` (Pass B switch-snapshot baggage — the standalone `channel_llm_overrides` table at `schema.sql:2072` is canonical and stays)
- `persona_llm_overrides` JSONB at `schema.sql:2274` (Pass B switch-snapshot baggage — no replacement needed)

Drop from `user_saved_provider_configs` (lines 2554–2559): same Phase 3 set (`custom_endpoint_url`, `custom_model_name`, `custom_num_ctx`, `fallback_llm_ids`).

**Pre-flight audit (resolve before shipping):** `user_saved_provider_configs.enabled_capabilities TEXT[]` (line 2558) exists on the user variant but not on the server variant. Confirm whether this is intentionally user-only or a missing-column gap on the server variant before locking the cleanup scope.

Post-cleanup, `saved_provider_configs` lands at ~22 columns — above the 15-column fission threshold from #14, but justified by atomic snapshot semantics (one command, `/server save-provider`, writes all columns together as a unit). Document the threshold-exceeded justification inline in the table comment so future audits don't re-litigate.

**Subtasks:**
- [ ] Resolve `enabled_capabilities` audit question; document the resolution
- [ ] Migration: `ALTER TABLE saved_provider_configs DROP COLUMN ...` for the 6 deprecated columns (paired `.down.sql`)
- [ ] Migration: `ALTER TABLE user_saved_provider_configs DROP COLUMN ...` for the 4 deprecated columns (paired `.down.sql`)
- [ ] Remove dead code paths in repositories that previously read the dropped columns
- [ ] Verify the standalone `channel_llm_overrides` table at `schema.sql:2072` still works end-to-end (callers in `dbWrite.ts:1760`, `dbRead.ts:3170`, `channelLlmCache.ts`, `/tool status`)
- [ ] Add the threshold-exceeded justification comment to `saved_provider_configs`
- [ ] `bun run check && bun run lint && bun run check-schema && bun run test` pass

### 14.6. Enforce "one main persona per server" at the schema level
- **What:** Add a partial unique index to enforce the "exactly one non-alter persona per server" invariant at the database level.
- **Sequencing:** Runs after #14.5.

**Scope:** Today the invariant is enforced only by command logic (the `WHERE is_alter = false` filter at 15+ call sites). A buggy migration or direct SQL touch could create two main personas per server. Cheap hardening with no behavioral change.

**Subtasks:**
- [ ] Migration: `CREATE UNIQUE INDEX personas_one_main_per_server ON personas(server_id) WHERE is_alter = false;` (paired `.down.sql`)
- [ ] Verify the migration succeeds on a production-shaped dataset (no existing duplicates)
- [ ] `bun run check && bun run lint && bun run check-schema && bun run test` pass

### 15. Junction-ify FK-shaped JSONB columns
- **What:** Replace **FK-shaped** JSONB arrays with M2M junction tables. Discord ID arrays and string-value arrays stay as arrays — they are NOT FK-shaped, and junction-ifying them would block atomic write semantics that commands like `/server rp-channels` rely on (writes the whole new list as one transaction) and add unnecessary JOIN cost on every cache read.
- **Sequencing:** Runs after #14.6. Reason: #15 should operate on columns in their *final* home, not in `tomori_configs` (which is being dropped by #14). If #15 ran first, every junction migration would have to be redone after #14 moves the column.

**Scope:**

In-scope target: `autoch_persona_overrides` JSONB (`Array<{channel_disc_id, tomori_id}>`) on `server_autotrigger_configs` → `server_autotrigger_persona_overrides` junction. The `tomori_id` field in the JSONB is genuinely FK-shaped; junction-ifying gains cascade-delete on persona deletion (today, deleting a persona leaves dangling JSONB entries pointing at a vanished persona).

Already moot: `fallback_llm_ids` JSONB — dropped by #14.5 before #15 runs. No action needed.

Deferred: `fallback_model_refs` audit — defer until Pass B settles its final shape.

Audit of every array/JSONB column post-split (most stay as arrays):

| Column | Home table | FK-shaped? | Action |
|---|---|---|---|
| `autoch_persona_overrides` | `server_autotrigger_configs` | ✅ Yes (`tomori_id` FK) | **Junction-ify** |
| `autoch_disc_ids` | `server_autotrigger_configs` | ❌ Discord snowflakes | Stay array |
| `rp_channel_ids` | `server_channelscope_configs` | ❌ Discord snowflakes | Stay array |
| `private_channel_ids` | `server_channelscope_configs` | ❌ Discord snowflakes | Stay array |
| `crosschannel_blocklist_ids` | `server_channelscope_configs` | ❌ Discord snowflakes | Stay array |
| `tool_notice_hidden_keys` | `server_noticeembeds_configs` | ❌ String keys | Stay array |
| `trigger_words` | `persona_configs` | ❌ String values | Stay array |
| `nai_char_tags` | `user_personalization_configs` | ❌ String tags | Stay array |
| `fallback_llm_ids` | (dropped by #14.5) | — | Moot |
| `fallback_model_refs` | `saved_provider_configs` | TBD | Deferred |

**Subtasks:**
- [ ] Migration: create `server_autotrigger_persona_overrides (server_id, channel_disc_id, persona_id, created_at, PRIMARY KEY (server_id, channel_disc_id))` with `ON DELETE CASCADE` on both `server_id` and `persona_id` FKs (paired `.down.sql`)
- [ ] Backfill from `autoch_persona_overrides` JSONB into the junction table
- [ ] Update `server_autotrigger_configs` repository: writes go to both the row and the junction atomically in one transaction
- [ ] Drop the `autoch_persona_overrides` JSONB column
- [ ] Verify the autotrigger command flow end-to-end (set, list, clear)
- [ ] `bun run check && bun run lint && bun run check-schema && bun run test` pass

### 16. Separate Runtime State from Configuration
- **What:** Extract runtime telemetry from config tables into dedicated `*_runtime_state` tables. Today, wiping telemetry to recover from a transient outage requires UPDATE-ing the same row that holds the encrypted key (for API keys) or persona identity (for autochat counters). That's a footgun.
- **Sequencing:** Runs after #15.

**Scope:**

`api_key_rotation` → split into `api_key_rotation` (config: `api_key`, `key_version`, `is_main_key_pointer`, `is_enabled`) and `api_key_rotation_runtime_state` (telemetry: `usage_count`, `error_count`, `last_used_at`, `last_error_at`, `last_error_type`, `last_error_message`).

`tomoris.autoch_counter` and `tomoris.autoch_next_target` → split into `persona_autoch_runtime_state (persona_id PK FK → personas ON DELETE CASCADE, autoch_counter INT, autoch_next_target INT, updated_at)`. Mutated on every message processed by the autochat tick logic; doesn't belong in persona identity.

Audit `saved_provider_configs` post-Pass-B for analogous mixing (`consecutive_failures` etc.). If found, split similarly. If not, it stays config-only.

Both runtime-state tables are **excluded from export** — drift-checker (`checkSchemaDrift.ts`) must accept the exclusions explicitly so future drift checks don't false-flag them as missing-from-export.

**Subtasks:**
- [ ] Migration: create `api_key_rotation_runtime_state (rotation_key_id INT PK FK → api_key_rotation ON DELETE CASCADE, usage_count, error_count, last_used_at, last_error_at, last_error_type, last_error_message, updated_at)` (paired `.down.sql`)
- [ ] Backfill telemetry from `api_key_rotation` rows into the new state table
- [ ] Update key-rotation repository to read/write state from the new table
- [ ] Drop telemetry columns from `api_key_rotation`
- [ ] Migration: create `persona_autoch_runtime_state` (paired `.down.sql`)
- [ ] Backfill from `tomoris.autoch_counter` / `tomoris.autoch_next_target`
- [ ] Update autochat tick logic to write to the new state table
- [ ] Drop `autoch_counter` and `autoch_next_target` from `tomoris`
- [ ] Audit `saved_provider_configs` for analogous state mixing; split if found
- [ ] Update drift-checker to explicitly exclude both runtime-state tables from the export schema comparison
- [ ] `bun run check && bun run lint && bun run check-schema && bun run test` pass

### 16.7. Replace `tomori_configs`-mirror export pipeline with per-repository composition
- **What:** Today's export/import assumes a single `serverConfigExportSchema` mirroring `tomori_configs` (`src/types/db/dataExport.ts:~145`), duplicated `UPDATE tomori_configs SET ...` blocks in `dataImportV2.ts:347` and `:421`, and a drift-checker comparing one schema to one table (`checkSchemaDrift.ts:348`). After the split, all three structures break.
- **Sequencing:** Runs after #16. (Most of the per-table export-pipeline work has already happened incrementally across #14–#16 because each split's acceptance criterion required export/import green per table; this step is the *final consolidation* that deletes the obsolete one-table-mirror plumbing.)

**Subtasks:**
- [ ] Delete `tomori_configs`-mirror schema in `src/types/db/dataExport.ts`
- [ ] Delete the duplicated `UPDATE tomori_configs SET ...` blocks in `src/utils/db/dataImportV2.ts:347` and `:421`
- [ ] Finalize `serverConfigExportSchema` as a composition of per-repository `toExportShape()` outputs
- [ ] Update `scripts/maintenance/checkSchemaDrift.ts` to iterate each `*_configs` table rather than comparing to one god table
- [ ] Archive `plans/EXPORT_IMPORT_REFACTOR_PLAN.md` (superseded by this step and the per-table acceptance criteria in #14)
- [ ] `bun run check && bun run lint && bun run check-schema && bun run test` pass

### 16.8. Rename `tomoris` → `personas`, `tomori_id` → `persona_id`, `tomori_nickname` → `persona_nickname`
- **What:** Final mechanical rename. Every internal `tomori_*` identifier becomes `persona_*` across schema, code, types, and cache namespaces. User-facing strings, locale keys, ComfyUI placeholders, and the app/repo name are **carve-outs** and stay as-is.
- **Sequencing:** Last step of Phase 6. Every earlier Phase 6 step operates on `tomori_id` names; one sweep renames everything together. Rollback is one `ALTER TABLE personas RENAME TO tomoris` away if anything breaks.

**Why last:** Every interim Phase 6 state remains coherent under the old naming. Phase 6 likely ships incrementally; keeping the rename at the end means a partially-shipped Phase 6 doesn't leave the codebase in a half-renamed limbo.

**Data model rationale:** Audit of `persona_lineage_id` (`schema.sql:151`) confirmed the schema's real model: every row in `tomoris` is semantically a persona instance, and cross-server persona archetypes are already tracked by `persona_lineage_id`. The "Tomori-the-shapeshifter who *becomes* personas" framing is metaphor, not data structure — Tomori survives as the bot's name (a value, like any persona name) in user-facing strings.

**Scope (DB transaction):**
- `ALTER TABLE tomoris RENAME TO personas`
- Rename every `tomori_id` FK column to `persona_id` across the entire schema
- Rename `tomori_nickname` column → `persona_nickname`
- Rename FK constraints and indexes accordingly (including the partial unique index from #14.6)

**Scope (code PR):**
- Grep-and-replace `tomori_id` → `persona_id`, `tomori_nickname` → `persona_nickname` across source
- Update type definitions in `src/types/`
- Bump cache namespaces so old cache entries don't leak into the renamed identifiers

**Carve-outs (do NOT rename — these are API surface, not internal naming):**

| Kind | Example | Why keep |
|---|---|---|
| User-facing string values | `bot_name: "Tomori"`, "Tomori couldn't reach..." | Brand/character name |
| Locale key names | `tomori_not_setup_title`, `tomori_busy_replying` | Developer-facing only; renaming creates locale-key churn with zero user benefit |
| ComfyUI token placeholders | `{TOMORI_PROMPT}`, `{TOMORI_WIDTH}`, `{TOMORI_REFERENCE_IMAGE_*}` | Public API surface for workflow authors; renaming would break workflows in `scripts/comfyui-workflows/` |
| App/repo name | `TomoriBot` | Brand |
| `persona_lineage_id` | (already correctly named) | — |
| `persona_configs` table | (already correctly named — stays put, no rename, no name-reclaim juggling) | — |

**Subtasks:**
- [ ] Plan the rename PR shape: one DB migration transaction + one large code PR (kept together so the codebase is never in a half-renamed state at HEAD)
- [ ] Write the rename migration: `ALTER TABLE tomoris RENAME TO personas`; all `tomori_id` → `persona_id` column renames; `tomori_nickname` → `persona_nickname`; constraint/index renames (paired `.down.sql` that reverses everything in one transaction)
- [ ] Grep-and-replace `tomori_id` → `persona_id` across `src/`, excluding the carve-out list above
- [ ] Grep-and-replace `tomori_nickname` → `persona_nickname` across `src/`, excluding carve-outs
- [ ] Update `src/types/` definitions
- [ ] Bump cache namespaces for any cache keyed on `tomori_id` (per CLAUDE.md cache rules — invalidation belongs in the same code path as the write)
- [ ] Verify carve-outs intact: `bot_name: "Tomori"` value unchanged, locale keys unchanged, ComfyUI placeholders unchanged, `TomoriBot` repo/app name unchanged
- [ ] `bun run check && bun run lint && bun run check-schema && bun run check-locales && bun run test` pass

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
- [ ] **Smoke test:** trigger an intentional DB error (e.g., bad query in a dev-only test path); confirm the error appears in logs with full context, including the underlying SQL error. If the new path silently swallows error logs, postmortem-blind code can feel fine to type checks.
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
- Schema split runs through #14, #14.2, #14.5, #14.6, #15, #16, #16.7 incrementally — each step is independently revertable, and each step's acceptance criterion includes export/import round-trip green so the drift-checker safety net never goes dark mid-refactor. The final rename (#16.8) is deliberately last so every interim state remains coherent under the old `tomori_*` naming, and rollback is one `ALTER TABLE personas RENAME TO tomoris` away if anything breaks.

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