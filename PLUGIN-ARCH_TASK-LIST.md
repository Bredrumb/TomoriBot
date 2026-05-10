# TomoriBot Plugin Architecture Plan

> **Companion document:** `PLUGIN-ARCH_REFACTOR-PREREQUISITES.md` — most prerequisites for this plan live there. Do not start migration phases here until the prerequisite phases of the refactor plan are complete.

> **Last refreshed:** 2026-05-07.

## How to read this plan

- **Cross-phase dependencies are explicit.** Each phase (A through G) lists its `**Prerequisites:**` upfront. If a phase has no prerequisites listed beyond the previous phase, it has none.
- **Within a phase, checkboxes are roughly top-to-bottom.** But multi-instance lists (e.g., the 11 provider migrations in Phase C, the per-plugin migration subtasks in Phase D) are **parallel-able** — any order, or simultaneously, unless an inline note says otherwise. The stacking is for inventory, not sequencing.
- **Quality gates always go last.** The closing `bun run check && bun run lint` (and `bun run check-locales` where applicable) is the final checkbox of every phase by convention.
- **Cross-references to the refactor plan** use the form "refactor plan #N" or "refactor plan Phase X." When this plan says it depends on a refactor-plan item, that item must be complete before the plugin-plan phase can start meaningfully — see §8 for the full prerequisite matrix.

## 1. Goal

Make adding a new provider, tool, command, event handler, TTS/STT engine, or bridge feel like **dropping one folder under `src/plugins/<category>/`** into the codebase. No edits to imports lists, registry arrays, type unions, or `case "google":` style switches anywhere in core code.

After full migration, `src/plugins/` is the **single canonical home** for every extension point. Today's `src/commands/`, `src/tools/`, `src/providers/`, and `src/utils/{audio,matrix}/` empty out (or are deleted). The four canonical categories under `src/plugins/` are:

- **`providers/`** — every external-AI provider (LLM, TTS, STT, image-gen). ElevenLabs is a provider for audio modality; NovelAI is a provider that ships LLM + image-gen capabilities. Modality is declared via the plugin contract's `provides.*` fields, not by folder.
- **`bridges/`** — non-Discord platform bridges (Matrix today; Telegram/Slack future).
- **`commands/`** — standalone slash commands not tied to any specific provider/bridge. Today's `src/commands/<category>/` structure preserves itself one level deeper.
- **`tools/`** — agnostic function-call tools (`tools/functionCalls/`) and bundled MCP server configs (`tools/mcpServers/`). User-registered MCP servers via `/mcp` continue to live in DB config (not a code change).

A plugin's category reflects its **primary identity**, not the kinds of contributions it ships. A provider plugin can ship commands, locales, tools, and migrations — those go *inside* the provider's folder. Standalone things go in the top-level category folders.

This document defines what "plugin architecture" means for TomoriBot, the acceptance criteria that say we're done, the migration phases to get there, and a concrete `Plugin` contract.

## 2. Scope

### In scope (Tier 1 + Tier 2)
- **Tier 1 — Foundational:** folder-drop discovery, zero name-based dispatch in core code.
- **Tier 2 — Structural:** self-contained plugin folders, formal `Plugin` contract, plugin-owned locale slices, plugin-owned schema migrations, time-to-add benchmark.

### Out of scope (deferred Tier 3 — third-party extensibility)
- Plugin loading from `node_modules/` or arbitrary filesystem paths.
- Manifest schema with version/dependency resolution.
- Per-guild plugin enable/disable at runtime without restart.
- Capability/permission sandboxing for untrusted plugin code.
- Plugin SDK package (`@tomoribot/plugin-sdk`) for external publishers.
- Plugin distribution / registry / signed-plugin trust model.

If demand for third-party extensibility emerges later, it gets its own plan. This document targets **internal contributor ergonomics**.

## 3. Why This Plan Exists

Simple feature additions require touching multiple unrelated files. The complaint is **empirically true** in specific subsystems. Concrete evidence from the codebase as of 2026-05-07:

- **Providers (highest pain):**
  - `src/utils/provider/providerInfoRegistry.ts:20-32` hardcodes an array of 11 provider info imports.
  - `src/utils/provider/providerInfoRegistry.ts:59-82` hardcodes a `providerFeatureImplementations` map.
  - `src/utils/provider/providerInfoRegistry.ts:48-57` hardcodes the `ProviderFeatureImplementation` type union.
  - **79 hardcoded provider-name comparisons across 17 files** (re-baselined 2026-05-07 with the broader grep `(llm_provider|providerName|provider|apiFamily) === "<name>"` plus `case "<name>":`). Top offenders: `commands/tool/prompt/snapshot.ts` (28), `events/messageCreate/tomoriChat.ts` (17), `commands/help/api-key.ts` (9), `commands/tool/estimate/cost.ts` (8). Remaining instances are scattered across tools, events, and provider utilities.
  - The 17 instances in `events/messageCreate/tomoriChat.ts` appear at lines 5585, 5634, 5700, 5728, 5745, 5776, 6079, 6641, 7415, 7444, 7462, 7499, 7686, 7715, 7733, 7769, 8067.
  - The original plan cited 40 occurrences across 7 files; that count used a narrower pattern and missed `case`-based switches plus indirect comparisons. The 79/17 figure is what AC-2's enforcement grep must drive to zero (modulo the §9 R-5 allowlist).
  - The official docs (`docs/guides/adding-new-provider.md`, `docs/ai/providers.md`) **already advise against** these patterns. The plan's job is enforcement, not invention.

- **TTS/STT (medium pain):**
  - The generic `customEndpointService.ts` is the right shape — it's the mature plugin pattern.
  - But ElevenLabs gets bespoke files (`src/utils/audio/elevenLabsTts.ts`, `elevenLabsStt.ts`, `elevenLabsAccount.ts`, `elevenLabsShared.ts`, `elevenLabsVoiceCatalog.ts`) that bypass the generic system.
  - Adding a new TTS provider with similar special-case needs would mean copy-pasting that pattern instead of extending the plugin system.

- **Bridges (low pain, latent risk):**
  - Matrix bridge is one big subsystem (`src/utils/matrix/matrixManager.ts` 59KB + `events/messageCreate/matrixRelay.ts`). No plugin contract — just bespoke code.
  - If a Telegram or Slack bridge ever gets added, it will repeat the pattern instead of plugging into a shared interface.

- **Tools / Commands / Events (no pain):**
  - Already folder-drop discoverable via `toolInitializer.ts`, `commandLoader.ts`, `handlers/eventHandler.ts`.
  - Need only minor formalization to fit a unified `Plugin` contract.

## 4. Acceptance Criteria

When all seven of these pass, we have plugin architecture. They are deliberately observable, falsifiable, and testable.

### AC-1: Folder-drop discovery for all extension points
Adding a new provider, tool, command, event handler, TTS engine, or bridge requires creating files **only inside one new folder**. No edits to imports lists, registry arrays, type unions, or switch statements anywhere else in the codebase.

**Test:** A reviewer can verify with `git diff --name-only` that the PR's changes are scoped to:
- `src/plugins/<plugin-name>/**` (or the legacy folder if applicable, e.g. `src/providers/<name>/**`)
- `docs/**`
- Generated migration files in `src/db/migrations/**` (Phase 6 of refactor plan)

Nothing else.

### AC-2: No name-based switches in core code
A grep across the core orchestration paths returns **zero matches** for name-string dispatch on plugin identity. The protected-path list lives in `scripts/maintenance/checkPluginPurity.ts` and tracks the codebase as it evolves — pre-migration this includes `src/events/`, `src/utils/text/contextBuilder.ts`, `src/utils/discord/streamOrchestrator.ts`, `src/tools/toolRegistry.ts`; post-migration it shifts to `src/events/`, `src/utils/**` (whatever survives), and `src/plugins/**` (excluding plugin internals). Phase G updates this list and verifies the grep against a deliberately-introduced violation before declaring the AC enforced.

The grep targets:

- `case "google":` / `case "openrouter":` / `case "novelai":` / etc.
- `provider === "google"` / `providerName === "..."` / `apiFamily === "..."` / `llm_provider === "..."`
- Any equivalent string-equality dispatch on plugin identity.

**Test:** A CI script (e.g., `scripts/maintenance/checkPluginPurity.ts`) runs the grep and fails the build if violations are found in protected paths. Allowed exceptions (e.g., display-only labels in user-facing commands like `help/api-key.ts`) must be explicitly listed in an allowlist file.

### AC-3: A plugin is a single folder
Every plugin folder is self-contained. Deleting the folder cleanly removes the feature without touching any other file (apart from running `bun run check-locales` and applying any rollback migration).

**Test:** Pick any one plugin. Delete its folder. Run `bun run check && bun run lint && bun run check-locales`. Build should fail only with errors that point exclusively to consumers of that plugin's optional capabilities — not to import lines in registries or type unions.

### AC-4: Plugins declare their contract, not export ad-hoc
Each plugin exports a single `Plugin` object (or default export) conforming to the `Plugin` interface defined in `src/types/plugin/`. Capabilities (commands, tools, events, locale slices, schema migrations, feature flags, hooks) are **fields on that object**, not side-effecting top-level imports.

**Test:** A type-check script confirms every plugin folder has exactly one file matching `plugin.ts` (or `index.ts`) that satisfies `Plugin`. The plugin loader operates on the type, not on file paths within the plugin.

### AC-5: Locale strings live with the plugin
A plugin's user-facing strings live in `<plugin>/locales/{en-US,ja}.ts` and are merged into the global locale tree at boot. The global `src/locales/en-US/` directory contains only cross-cutting strings (general errors, generic UI elements, shared command framework strings). It does **not** contain provider-specific, tool-specific, or bridge-specific keys.

**Test:** Removing a plugin folder removes its locale keys without breaking `bun run check-locales`. The locale checker is updated to discover plugin locale slices automatically.

### AC-6: Plugins own their state
A plugin needing persistent state declares its tables/columns in its own folder (`<plugin>/migrations/NNN_*.sql`) and accesses them through a scoped repository class colocated in the plugin folder. New plugins do **not** add columns to `tomori_configs`.

**Test:** Grep `src/db/schema.sql` and the new `src/db/migrations/` folder. Any tables introduced after this plan's adoption date must originate in a plugin folder. The `tomori_configs` table does not gain new columns from new plugins. (Existing columns get migrated post-Phase 6 of the refactor plan; pre-existing tomori_configs entries are grandfathered.)

### AC-7: Time-to-add benchmark
Adding a "hello world" plugin that demonstrates each extension type — a no-op echo provider, a trivial slash command, a one-shot tool, a noop event handler, and a noop TTS engine — takes a fresh contributor **under 30 minutes** following only `docs/guides/writing-a-plugin.md`. No reading of core code is required.

**Test (both must pass):**
1. **Human contributor pass:** A real contributor unfamiliar with TomoriBot's internals produces a working hello-world plugin in under 30 minutes against the documented guide. Humans surface real-world friction LLMs paper over (toolchain confusion, IDE setup, "where do I put my API key?", OS-specific pathing).
2. **LLM-agent canary pass:** An LLM agent with codebase access following only the guide produces a working hello-world plugin in one session without reading core code. LLMs surface ambiguous prose and missing examples humans paper over with intuition.

If either contributor gets stuck on any subsystem, that subsystem's plugin contract or doc is incomplete and gets revised before AC-7 passes. Both tests are repeatable — rerun them on every guide revision until both pass cleanly.

## 5. Subsystem Inventory & Migration Targets

This table is the working inventory. It captures every extension point the plan must address, the current state, and what changes when the plan is done.

| Subsystem | Current location | Already folder-drop? | Post-migration location |
|---|---|---|---|
| **LLM providers** | `src/providers/<name>/` | 🟡 Half — classes auto-discovered; metadata hardcoded; 79 name switches in callers | `src/plugins/providers/<name>/` (one folder per provider; ElevenLabs joins them as a TTS/STT provider). Auto-discovery + name-switch purge land in refactor plan #6.5 *before* this migration. |
| **TTS / STT engines** | `src/utils/audio/elevenLabs*.ts` (bespoke) + `customEndpointService.ts` (generic) | 🟡 Half — generic exists but ElevenLabs bypasses it | `src/plugins/providers/elevenlabs/` (declared via plugin contract's `provides.ttsEngines` / `provides.sttEngines` fields). The generic `customEndpointService.ts` survives for user-supplied endpoints. |
| **Bridges** | `src/utils/matrix/matrixManager.ts` (59KB monolith) + `events/messageCreate/matrixRelay.ts` | 🔴 No — bespoke | `src/plugins/bridges/matrix/`. Future bridges (Telegram, Slack) become `src/plugins/bridges/<name>/`. |
| **Slash commands** | `src/commands/<category>/<file>.ts` | ✅ Yes — auto-registered by `commandLoader.ts` | `src/plugins/commands/<category>/<name>/plugin.ts` for standalone commands; provider/bridge-specific commands live inside the relevant plugin folder (e.g. `src/plugins/providers/elevenlabs/commands/`). Wholesale migration in Phase C. |
| **Function-call tools** | `src/tools/functionCalls/<file>.ts` | ✅ Yes — auto-discovered by `toolInitializer.ts` | `src/plugins/tools/functionCalls/<name>/plugin.ts` for agnostic tools. Provider-tied tools (e.g. `generateImageNaiTool` for NovelAI) live inside the relevant provider plugin's `tools/` subdir. |
| **REST API tools** | `src/tools/restAPIs/brave/` | ✅ Yes | `src/plugins/tools/functionCalls/brave/` (folded into the same agnostic-tools area). |
| **MCP servers (first-party bundled)** | `src/tools/mcpServers/` | ✅ Yes | `src/plugins/tools/mcpServers/<name>/`. User-registered MCP servers via `/mcp` continue to live in DB config; this row only covers bundled ones. |
| **Event handlers** | `src/events/<eventName>/` | ✅ Yes — auto-loaded by `handlers/eventHandler.ts` | Stay in `src/events/<eventName>/` (Discord events are not a plugin category — they remain core wiring). Plugins register additional event handlers via the `Plugin.events` field, which the loader merges into the same handler map. |
| **Locales** | `src/locales/{en-US,ja}.ts` monoliths | 🔴 No | Refactor plan Phase 1 fragments globals into category files. Plugins ship `<plugin>/locales/{en-US,ja}.ts` slices that merge at boot. |
| **DB schema** | `src/db/schema.sql` + `tomori_configs` god table | 🔴 No | Refactor plan Phases 2, 6, 16.5 introduce repositories, normalize tables, and add a migration runner. Plugins then ship `<plugin>/migrations/NNN_*.sql`. |
| **Provider features** (image gen, video gen, embeddings, …) | `providerFeatureImplementations` map in `providerInfoRegistry.ts` | 🔴 No | Each provider's `plugin.ts` declares its own feature implementations. Map built at boot from discovered providers, not hardcoded. |

## 6. The Plugin Contract

Sketch of the TypeScript interface to live at `src/types/plugin/interfaces.ts`. Concrete enough to drive Phase 1; expect refinement during implementation.

```typescript
// src/types/plugin/interfaces.ts

/**
 * The single contract every plugin folder must satisfy.
 * Loaded by src/plugins/pluginLoader.ts at boot.
 */
export interface Plugin {
  /** Canonical lowercase identifier. Must be unique across all plugins. */
  name: string;

  /** Human-readable label for logs and Discord UI. */
  displayName: string;

  /** Plugin version (semver). Used for telemetry; not enforced for dependency resolution in Tier 1+2. */
  version: string;

  /** Optional aliases (e.g., "gemini" -> "google"). */
  aliases?: string[];

  /** What this plugin provides. All fields optional; a plugin can expose any subset. */
  provides?: {
    /** LLM providers (replaces hardcoded providerInfos array). */
    providers?: ProviderDefinition[];

    /** Tools (built-in function calls, REST tools, etc.). */
    tools?: ToolDefinition[];

    /** Slash commands. Categories declared here merge into the global command tree. */
    commands?: CommandDefinition[];

    /** Discord event handlers. */
    events?: EventHandlerDefinition[];

    /** Bridges to non-Discord platforms (Matrix, Telegram, etc.). */
    bridges?: BridgeDefinition[];

    /** TTS engines exposed via the custom-endpoint capability system. */
    ttsEngines?: TtsEngineDefinition[];

    /** STT engines, same model as TTS. */
    sttEngines?: SttEngineDefinition[];
  };

  /** Locale slices merged into the global locale tree at boot. */
  locales?: {
    "en-US"?: LocaleSlice;
    ja?: LocaleSlice;
  };

  /** Schema migrations applied in order on first boot. */
  migrations?: Migration[];

  /** Optional lifecycle hooks. */
  onLoad?(ctx: PluginContext): Promise<void>;
  onReady?(ctx: PluginContext): Promise<void>;
  onUnload?(ctx: PluginContext): Promise<void>;
}

/**
 * Scoped context handed to plugin lifecycle hooks.
 * In Tier 1+2 this is intentionally narrow — no DB write access beyond the plugin's own
 * scoped repository, no Discord client mutation. Capability scoping for third-party
 * plugins (Tier 3) is out of scope for this plan.
 */
export interface PluginContext {
  pluginName: string;
  log: ScopedLogger;
  db: ScopedDatabase; // wraps the plugin's own migrations
  config: PluginConfigAccessor; // reads/writes plugin-scoped config rows
}
```

The `*Definition` types (`ProviderDefinition`, `CommandDefinition`, etc.) thinly wrap the existing interfaces (`LLMProvider`, `BaseTool`, slash command builders) so the migration is mostly mechanical relocation, not redesign.

### Worked folder layout (post-migration)

```
src/plugins/
├── providers/                                ← LLM + TTS + STT + image-gen providers
│   ├── google/
│   │   ├── plugin.ts                         ← exports default Plugin object
│   │   ├── providerInfo.ts
│   │   ├── googleProvider.ts
│   │   ├── googleStreamAdapter.ts
│   │   ├── tools/
│   │   │   └── generateImageTool.ts          ← provider-tied tool (lives WITH the provider)
│   │   ├── locales/
│   │   │   ├── en-US.ts
│   │   │   └── ja.ts
│   │   └── migrations/                       ← (only if plugin needs its own tables)
│   ├── openrouter/
│   ├── novelai/                              ← LLM + image-gen via provides.providers
│   │   ├── plugin.ts
│   │   └── tools/generateImageNaiTool.ts     ← NovelAI-specific image tool
│   ├── elevenlabs/                           ← TTS + STT via provides.ttsEngines/sttEngines
│   │   ├── plugin.ts
│   │   ├── tts.ts
│   │   ├── stt.ts
│   │   └── commands/voices.ts                ← /speech elevenlabs voices
│   └── ... (anthropic, deepseek, nvidia, zai, zaicoding, vertex, vertexexpress, custom)
│
├── bridges/                                  ← non-Discord platform bridges
│   └── matrix/
│       ├── plugin.ts
│       ├── events.ts
│       ├── stateSync.ts
│       └── commands/
│
├── commands/                                 ← standalone slash commands (today's src/commands/)
│   ├── config/
│   │   ├── setup/
│   │   │   ├── plugin.ts                     ← exports SlashCommandBuilder for /config setup
│   │   │   └── locales/                      ← (only if command ships its own strings)
│   │   ├── model/
│   │   └── ...
│   ├── tool/
│   ├── help/
│   └── ...
│
└── tools/                                    ← agnostic function-call tools + bundled MCP
    ├── functionCalls/
    │   ├── youtube/
    │   │   ├── plugin.ts
    │   │   └── locales/
    │   ├── fetch/
    │   ├── generateImage/                    ← multi-provider + ComfyUI agnostic tool
    │   └── brave/                            ← Brave search (REST API)
    └── mcpServers/
        ├── duckduckgo/
        └── ... (other bundled MCP server configs)
```

**Decision rule for "where does my new contribution go?":**
1. Is it part of a larger plugin's identity (a provider, bridge)? → put it inside that plugin's folder (e.g. `providers/elevenlabs/commands/voices.ts`).
2. Otherwise → drop it in the appropriate top-level category (`commands/`, `tools/`, `providers/`, `bridges/`).

Folder *categorization* is for human navigation; the loader scans `src/plugins/**/plugin.ts` recursively and merges contributions regardless of category depth.

## 7. Migration Phases (Plugin-Specific Work)

These phases assume the listed prerequisites from `PLUGIN-ARCH_REFACTOR-PREREQUISITES.md` are complete. Order is **easiest-first** to build momentum and validate the contract on low-risk subsystems before touching the high-pain ones.

### Phase A: Define the contract & loader
**Prerequisites:** Refactor plan Phase 1 (locale fragmentation) + Phase 6.5 (`providerInfoRegistry` auto-discovery).

**Subtasks:**
- [ ] Draft `Plugin` interface and supporting `*Definition` types in `src/types/plugin/interfaces.ts`
- [ ] Add `hooks?: PluginHooks` as an optional field on `Plugin`; define `PluginHooks` as an intentionally empty interface — a reserved slot for behavioral hook points (memory filters, context hooks, etc.) to be added on-demand post-refactor as pipeline seams become visible
- [ ] Draft `PluginContext`, `ScopedLogger`, `ScopedDatabase`, `PluginConfigAccessor` types
- [ ] Implement `src/plugins/pluginLoader.ts` with `Bun.glob` scan of `src/plugins/*/plugin.ts`
- [ ] Wire loader to merge plugin contributions into existing registries (commands, tools, events, providers)
- [ ] Add boot call in `src/index.ts` after existing loaders, before client login
- [ ] Write `docs/guides/writing-a-plugin.md` covering the contract and a hello-world example
- [ ] Verify boot logs "0 plugins loaded" cleanly with no plugins present
- [ ] `bun run check && bun run lint` pass

**Definition of done:** Loader runs at boot. Logs "0 plugins loaded." `bun run check && bun run lint` clean.

### Phase B: Pilot — migrate one trivial command
**Prerequisites:** Phase A.

Pick the lowest-risk extension point: a single small standalone command (e.g. `/help` or a help subcommand). The pilot proves the contract end-to-end on the simplest possible thing before wholesale migrations begin in Phase C/D.

**Subtasks:**
- [ ] Pick the smallest possible command for the pilot. Criteria: no DB calls, no state, minimal locale strings, no pagination or multi-step flows. A `/ping`, `/about`, or single help subcommand qualifies. **Avoid `/help` itself** — it's paginated and multi-subcommand, which adds incidental complexity that distracts from validating the contract. If no existing command fits cleanly, create a throwaway `/hello-plugin` test command for the pilot and remove it once Phase C ships.
- [ ] Create `src/plugins/commands/<category>/<name>/` folder with `plugin.ts` and (if needed) `locales/{en-US,ja}.ts`
- [ ] Move the command from `src/commands/<category>/<name>.ts` to the new plugin folder
- [ ] Update `commandLoader.ts` to also scan plugin folders (or remove old file once migrated)
- [ ] Verify the command works end-to-end (manual smoke test in Discord)
- [ ] Time a contributor (or LLM agent) cloning the pilot to add a "hello world" command
- [ ] Document contract pain points discovered; revise `Plugin` interface if needed
- [ ] Update `docs/guides/writing-a-plugin.md` with learnings

**Definition of done:** Pilot command works identically to its previous in-tree version. Time-to-add for a clone of the pilot is measured (anchors AC-7).

### Phase C: Migrate `src/commands/` and `src/tools/` wholesale
**Prerequisites:** Phase B (so the contract is validated).

These two migrations are mostly mechanical relocations after the pilot lands. Treat them as a single phase since they share the loader-update mechanic and don't depend on each other.

**Commands subtasks:**
- [ ] Migrate every command folder under `src/commands/<category>/<name>.ts` to `src/plugins/commands/<category>/<name>/plugin.ts`
- [ ] For commands that ship locale keys, colocate them in `<command>/locales/{en-US,ja}.ts` (slim slice of the global tree)
- [ ] Update `commandLoader.ts` to scan `src/plugins/commands/**/plugin.ts` (or remove and let pluginLoader handle it)
- [ ] Delete `src/commands/` once empty
- [ ] Verify every slash command still registers and fires (run `/help` listing or an automated registration check)

**Tools subtasks:**
- [ ] Migrate every agnostic function-call tool from `src/tools/functionCalls/<name>.ts` to `src/plugins/tools/functionCalls/<name>/plugin.ts`
- [ ] Migrate REST API tools (`src/tools/restAPIs/brave/`) to `src/plugins/tools/functionCalls/brave/`
- [ ] Migrate bundled MCP server configs from `src/tools/mcpServers/` to `src/plugins/tools/mcpServers/<name>/`
- [ ] Update `toolInitializer.ts` to scan plugin folders (or remove)
- [ ] Delete `src/tools/` once empty
- [ ] Verify every tool still loads and executes (smoke-test at least one of each: function call, REST, MCP)

**Cross-cutting:**
- [ ] Update path aliases / imports across the codebase
- [ ] `bun run check && bun run lint && bun run check-locales` pass

**Definition of done:** `src/commands/` and `src/tools/` are deleted. All commands and tools live under `src/plugins/`. Every previously-working invocation still works.

### Phase D: Migrate providers (the big one — including ElevenLabs)
**Prerequisites:** Phase C + refactor plan Phase 3 (#6 stream adapters, #6.5 auto-discovery + name-switch purge).

After #6.5 lands, providers are already auto-discovered and name-switch-free. This phase wraps each provider folder in the formal `Plugin` contract and folds ElevenLabs (TTS/STT provider) into the same category.

**Pre-flight decision — `openai` / `openaiCompatible` / `utils` folders:**
`src/providers/` currently contains 14 directories, but only 11 register a `providerInfo.ts`. The three that don't:
- `src/providers/openai/` and `src/providers/openaiCompatible/` — abstract base providers consumed via inheritance. No user-facing identity; not selectable as providers.
- `src/providers/utils/` — shared helpers.

**Decision:** Treat these three as **shared provider infrastructure**, not as plugins. They relocate to `src/types/provider/` or `src/utils/provider/` as appropriate so plugin-shaped providers can extend them. Document the distinction in `docs/guides/writing-a-plugin.md`.

**LLM provider subtasks (parallelizable):**
- [ ] Migrate `google` to `src/plugins/providers/google/`
- [ ] Migrate `openrouter` to `src/plugins/providers/openrouter/`
- [ ] Migrate `novelai` to `src/plugins/providers/novelai/` (includes `tools/generateImageNaiTool.ts` colocated)
- [ ] Migrate `anthropic` to `src/plugins/providers/anthropic/`
- [ ] Migrate `deepseek` to `src/plugins/providers/deepseek/`
- [ ] Migrate `nvidia` to `src/plugins/providers/nvidia/`
- [ ] Migrate `zai` to `src/plugins/providers/zai/`
- [ ] Migrate `zaicoding` to `src/plugins/providers/zaicoding/`
- [ ] Migrate `vertex` to `src/plugins/providers/vertex/`
- [ ] Migrate `vertexexpress` to `src/plugins/providers/vertexexpress/`
- [ ] Migrate `custom` to `src/plugins/providers/custom/`

**ElevenLabs (TTS/STT provider) subtasks:**
- [ ] Define `TtsEngineDefinition` and `SttEngineDefinition` interfaces in `src/types/plugin/interfaces.ts`
- [ ] Create `src/plugins/providers/elevenlabs/` with `plugin.ts` (declares `provides.ttsEngines` + `provides.sttEngines`)
- [ ] Move `src/utils/audio/elevenLabsTts.ts` → `tts.ts`, `elevenLabsStt.ts` → `stt.ts`
- [ ] Move `elevenLabsAccount.ts`, `elevenLabsShared.ts`, `elevenLabsVoiceCatalog.ts` to plugin folder
- [ ] Move `/speech elevenlabs` command logic to `src/plugins/providers/elevenlabs/commands/`
- [ ] Move ElevenLabs locale keys to plugin `locales/` slices
- [ ] Verify generic `customEndpointService.ts` still serves non-ElevenLabs user-supplied endpoints
- [ ] Manual smoke test: TTS + STT round-trip through ElevenLabs plugin
- [ ] Verify deleting `src/plugins/providers/elevenlabs/` cleanly disables ElevenLabs

**Cross-cutting:**
- [ ] Move provider-specific slash commands into respective plugin folders
- [ ] Move provider-specific locale keys to plugin `locales/` slices
- [ ] Remove old `src/providers/` and `src/utils/audio/` folders once empty
- [ ] Update `providerFactory.ts` to scan `src/plugins/providers/`
- [ ] Run AC-2 grep across `tomoriChat.ts`, `streamOrchestrator.ts`, `contextBuilder.ts`, `toolRegistry.ts` — confirm zero name-switches
- [ ] Document allowlist exceptions for legitimate UI-display switches (e.g., `commands/help/api-key.ts`)

**Definition of done:** AC-1 and AC-2 pass for providers. The 79 name-switches identified in §3 are gone or behind a documented allowlist. ElevenLabs and all 11 LLM providers live under `src/plugins/providers/`.

### Phase E: Migrate bridges
**Prerequisites:** Phase D + refactor plan #9 (matrixManager modularization).

**Subtasks:**
- [ ] Define `BridgeDefinition` interface in `src/types/plugin/interfaces.ts` (lifecycle, message ingest, message dispatch, identity mapping)
- [ ] Create `src/plugins/bridges/matrix/` with `plugin.ts`
- [ ] Move modularized matrixManager pieces (post-refactor #9) into the plugin folder
- [ ] Convert `events/messageCreate/matrixRelay.ts` flow into `Plugin.events.messageCreate` inside the matrix plugin
- [ ] Move Matrix-related slash commands and config to plugin folder
- [ ] Move Matrix locale keys to plugin `locales/`
- [ ] Move generic bridge utilities from `src/utils/bridge/` to either core (if shared) or the plugin (if Matrix-specific)
- [ ] End-to-end test with linked room
- [ ] Document the bridge contract with a "how to add a Telegram bridge" example in `docs/guides/writing-a-plugin.md`

**Definition of done:** A Telegram or Slack bridge could be added by dropping `src/plugins/bridges/telegram/` without touching anything outside that folder.

### Phase F: Plugin-owned schema & state
**Prerequisites:** Refactor plan Phases 2, 6, and 16.5 (repositories, normalized tables, migration runner).

**Subtasks:**
- [ ] Extend `pluginLoader.ts` to discover and apply `<plugin>/migrations/NNN_*.sql` via the migration runner from refactor #16.5
- [ ] Define `PluginMigration` type and validation rules (sequential numbering, idempotency)
- [ ] Define `ScopedDatabase` interface — full SQL scoped to the plugin's own tables (table-name prefix enforcement) per OD-P-2. Plugins still freely import core repositories (`ConfigRepository`, etc.) for non-plugin tables.
- [ ] Wire `PluginContext.db` to scoped database for each plugin
- [ ] Add a CI lint rule (or PR review checklist item) preventing new plugins from adding columns to `tomori_configs` or any other core table
- [ ] Migrate one existing plugin's state to plugin-owned tables as a worked example
- [ ] Document the schema-ownership rule in `docs/guides/writing-a-plugin.md` (including: "plugins read/write core tables via core repositories, not via ScopedDatabase")
- [ ] Document grandfathering policy for pre-existing `tomori_configs` columns (per §9 R-6)

**Definition of done:** AC-6 passes.

### Phase G: AC-7 verification
**Prerequisites:** Phases A–F.

**Subtasks:**
- [ ] Implement `scripts/maintenance/checkPluginPurity.ts` — grep-based AC-2 enforcement with allowlist support
- [ ] Update the script's protected-path list to reflect post-migration locations (`src/events/**`, surviving `src/utils/**`, `src/plugins/**` excluding plugin internals). Drop obsolete pre-migration paths (`src/tools/toolRegistry.ts`, etc.).
- [ ] Self-test: introduce a deliberate `case "google":` violation in a protected path; confirm the script fails. Revert. This guarantees AC-2 isn't a green-passing no-op.
- [ ] Wire `checkPluginPurity.ts` into `bun run check` (or CI) so violations fail the build
- [ ] Run a real time-to-add test with a human contributor against `docs/guides/writing-a-plugin.md`
- [ ] Run a parallel time-to-add test with an LLM agent following the same guide cold
- [ ] Document any friction points; revise guide or `Plugin` contract if either contributor took >30 min
- [ ] Re-test after revisions until both contributors complete the workflow under 30 min
- [ ] Lock `Plugin` interface and `docs/guides/writing-a-plugin.md` as the stable public surface
- [ ] Verify all seven acceptance criteria (AC-1 through AC-7) explicitly with a final checklist run
- [ ] Announce the new contributor workflow (changelog, README, Discord post)

**Definition of done:** All seven acceptance criteria pass. Plan is complete.

## 8. Prerequisites Summary (Cross-Reference)

This plan **cannot start meaningfully** until these refactor-plan items are done:

| Refactor plan item | Why this plan needs it | AC unlocked |
|---|---|---|
| Phase 1 #1 — Fragment locales | Plugins need to ship locale slices that merge into a structured tree | AC-5 |
| Phase 2 #4 — DB Repository pattern | Plugins need scoped DB access, not raw SQL | AC-6 |
| Phase 3 #6 — Unify stream adapters | Polymorphic dispatch instead of provider-name switches in `streamOrchestrator` | AC-2 |
| Phase 3 #6.5 — Auto-discover providers + purge name-switches | Removes the 40+ provider-name comparisons that violate AC-2 today | AC-1, AC-2 |
| Phase 6 #14 — Normalize `tomori_configs` | Plugins need to own their config rows, not contribute columns to a god table | AC-6 |
| Phase 6 #16.5 — Migration runner | Plugins need a place to put their schema changes | AC-6 |

Items not on this list (e.g., refactor plan #5 status.ts split, #10 contextBuilder split, #12 tomoriChat deconstruction) are **independently valuable** but not strict blockers for plugin work — they could in principle run in parallel with Phase A/B.

**Sequencing decision:** This project ships **strictly sequential**: complete the entire refactor prerequisites doc (Phases 1 through 7, top to bottom) **before** starting Phase A of plugin migration. The parallelism is technically allowed but operationally noisy — sequential execution makes GitHub epic/sub-issue tracking, PR scope, and reviewer attention much cleaner.

**Documentation alignment:** Plugin migration phases follow the same alignment protocol defined in `PLUGIN-ARCH_REFACTOR-PREREQUISITES.md` ("Documentation Alignment Protocol" section). Each plugin phase below ships docs updates in the same PR and bumps `<!-- ARCH-ALIGNMENT: plugin-phase-X -->` markers. Phases A–G map to docs as follows:

| Phase | Docs to update on merge |
|---|---|
| **Phase A — Define contract & loader** | `docs/core/architecture.md`, `docs/guides/writing-a-plugin.md` (new), `docs/README.md` |
| **Phase B — Pilot (one small command)** | `docs/guides/writing-a-plugin.md`, `docs/systems/command-system.md` |
| **Phase C — Migrate `src/commands/` and `src/tools/` wholesale** | `docs/systems/command-system.md`, `docs/systems/tool-system.md`, `docs/guides/writing-a-plugin.md` |
| **Phase D — Migrate providers (LLM + ElevenLabs)** | `docs/ai/providers.md`, `docs/guides/adding-new-provider.md`, `docs/guides/openai-compatible-provider-family.md`, `docs/integrations/voice-system.md`, `docs/integrations/tts/elevenlabs.md`, `docs/integrations/transcription/elevenlabs.md` |
| **Phase E — Migrate bridges** | `docs/integrations/matrix-bridge.md`, `docs/guides/writing-a-plugin.md` (bridge example) |
| **Phase F — Plugin-owned schema & state** | `docs/systems/database-schema.md`, `docs/guides/writing-a-plugin.md` (schema section) |
| **Phase G — AC-7 verification** | `docs/guides/writing-a-plugin.md` (final lockdown), `docs/README.md` |

## 8.5. Open Design Decisions — all locked

### OD-P-1: Plugin/core name collision policy — **DECIDED: (C) hard-fail at boot**
**Decision:** When a plugin and core (or two plugins) register the same identifier (command name, tool name, locale key), the bot refuses to start until the collision is resolved.
**Why:** Silent override is a debugging nightmare. (A) "core wins" or (B) "plugin wins" leaves a contributor wondering why their command isn't registered. Hard-fail makes every collision visible immediately. If a real use case for explicit override emerges later, it can be added as `Plugin.overrides?: string[]`.

### OD-P-2: ScopedDatabase API surface — **DECIDED: (A) prefix-scoped SQL**
**Decision:** `PluginContext.db` provides full SQL access scoped to tables prefixed with the plugin's name (e.g. `myplugin_audit_log`). Cross-plugin and core-table access through `ScopedDatabase` is forbidden.
**Prefix scheme:** the prefix is the plugin's `name` field, snake_case, followed by an underscore. Plugin `name: "elevenlabs"` → tables must match `elevenlabs_*`. Plugin `name: "novelai"` → `novelai_*`. The migration runner validates each plugin's `migrations/NNN_*.sql` files at boot — any `CREATE TABLE` whose name doesn't match the plugin's prefix fails the boot. This makes the rule mechanical and unambiguous.
**Crucial clarification:** This does NOT mean plugins can't read/write core tables. They access core tables via **core repositories** (`ConfigRepository`, `UserRepository`, etc.) imported like any other code — `ScopedDatabase` is *only* the safety rail for the plugin's *own* tables. The prefix-scoping serves two purposes: (1) prevents accidental cross-contamination (a plugin can't typo-DROP `servers`), (2) makes plugin uninstall trivial (drop all tables matching the prefix → plugin's data gone, core untouched).
**Why:** First-party plugins have full trust; prefix scoping is paperwork, not security. (B) generated typed methods is overengineered for the migration timeline. (C) read-only is too restrictive for plugins with runtime state. Tier 3 (third-party plugins) would need (B) or stricter, but Tier 3 is out of scope.

### OD-P-3: Plugin load order — **DECIDED: (C) undefined contract**
**Decision:** The contract makes no guarantee about plugin load order. Plugins must not depend on each other's runtime state. If two first-party plugins genuinely need ordering, hardcode the order in the loader with an explanatory comment.
**Implementation detail (not contract):** the loader uses alphabetical folder-name order so behavior is reproducible across boots, but plugins MUST NOT rely on this — it can change without notice.
**Why:** (A) baking alphabetical order into the contract creates fragile cross-plugin dependencies. (B) topological sort via `dependsOn` is the "right" answer for Tier 3 but adds dependency-resolution code with no user today. Defer (B) until a third-party plugin ecosystem exists.

### OD-P-4: AC-2 allowlist governance — **DECIDED: (A) PR review with mandatory justification**
**Decision:** Entries in `scripts/maintenance/pluginPurityAllowlist.txt` are added via PR review. Every entry must include a justification comment explaining **why polymorphic dispatch is impossible or wrong** — not why it was convenient.
**Why:** Since the maintainer (Eli) gates all merges, "PR review only" effectively means maintainer approval. (B) adds bureaucracy with no functional gain. (C) sunset clauses become busywork at the current scale; revisit if the allowlist grows past ~10 entries.
**At stake:** AC-2's enforcement bite. An allowlist without justification governance becomes a dumping ground; AC-2 becomes performative. The justification rule is the load-bearing piece.

### OD-P-5: First-party plugin folder location — **DECIDED: unified `src/plugins/<category>/<name>/` (4 categories)**
**Decision:** All extension points live under `src/plugins/`, organized by 4 top-level categories:
- **`providers/`** — every external-AI provider (LLM, TTS, STT, image-gen). ElevenLabs is here as a TTS/STT provider; NovelAI is here as an LLM + image-gen provider. Modality declared via the plugin contract's `provides.*` fields, not by folder.
- **`bridges/`** — non-Discord platform bridges (Matrix today; Telegram/Slack future).
- **`commands/`** — standalone slash commands not tied to any specific provider/bridge. Today's `src/commands/<category>/` structure preserves itself one level deeper.
- **`tools/`** — agnostic function-call tools (`tools/functionCalls/`) and bundled MCP server configs (`tools/mcpServers/`). User-registered MCP servers via `/mcp` continue to live in DB config.

Provider/bridge-tied contributions (commands, tools, locales, migrations specific to that provider/bridge) live **inside** the plugin's folder. Standalone contributions live in the top-level category folders.

**No `core/` sub-namespace.** Maintainer-shipped vs contributor-added is tracked by Git history, not folders. "Core" is a moving target; encoding it in folders creates a permanent class divide that fights the architecture's intent (everything is a plugin, period).

**Why:** Unified mental model — contributor decision rule is one tree: "what kind of thing am I building?" → drop one folder under the matching category. The categories track *primary identity*, not *kinds of contributions* (a provider plugin shipping commands is still primarily a provider). The plugin loader scans recursively, so folder depth doesn't affect discovery.
**At stake:** Contributor mental model. AC-1's "drop one folder" promise is universal under this layout — no exception classes, no special folders.

---

## 9. Risks & Open Questions

### R-1: Plugin load order
The current contract has `onLoad` and `onReady` lifecycle hooks but no formal dependency declarations. If plugin A's `onReady` reads state plugin B writes during `onLoad`, ordering matters.

**Mitigation:** For Tier 1+2, document that plugins must not depend on each other's runtime state. If two first-party plugins genuinely need ordering, hardcode the order in the loader. Defer dependency resolution to Tier 3.

### R-2: Cross-plugin tool calls
Some tools (e.g., `generateImageTool` and `generateImageNaiTool`) bridge providers and tools — the tool's behavior depends on the active provider. Where does that logic live?

**Mitigation:** Provider plugins expose capabilities (e.g., `provider.imageGeneration`). The agnostic `generateImageTool` lives in `src/plugins/tools/functionCalls/generateImage/` and routes to whichever provider's capability handler is active (multi-provider + ComfyUI). The NovelAI-specific variant lives in `src/plugins/providers/novelai/tools/generateImageNaiTool.ts`.

### R-3: Refactor plan timeline
This plan blocks on multiple refactor plan phases. If those slip, the plugin plan slips.

**Mitigation:** Per the §8 sequencing decision, this project ships strictly sequential — refactor prerequisites complete first, then plugin migration starts. The parallelism originally noted (Phase A/B alongside refactor Phases 4–5) is allowed but explicitly declined for tracking clarity. If a phase stalls, the cost is calendar time, not architectural inconsistency.

### R-4: AC-7 (30-minute benchmark) is qualitative
Subjective. A confused contributor doesn't necessarily mean the contract is bad — they might have read no docs.

**Mitigation:** Run the test with at least two contributors (one human, one LLM agent following the guide cold). If both succeed, AC-7 passes. If one fails, investigate before declaring done.

### R-5: Allowlist for AC-2 grep check
Some name-string comparisons are legitimately user-facing display logic (e.g., `commands/help/api-key.ts` switches on provider name to show different help text and instructions per provider — that's UI copy, not orchestration).

**Mitigation:** AC-2 explicitly allows an allowlist file (`scripts/maintenance/pluginPurityAllowlist.txt`) where each entry must be justified with a comment. PR review keeps the allowlist short.

### R-6: Existing pre-plan code grandfathering
TomoriBot already has `tomori_configs` columns from many features. AC-6 says "new plugins" don't add to it — but what about existing plugins migrated *into* the system (providers, ElevenLabs)?

**Mitigation:** Document explicitly: existing columns are grandfathered. Migrating a feature into a plugin folder does not require moving its existing config columns. Only **net-new** features added after Phase F adoption must use plugin-owned tables.

## 10. Definition of Done

The plan is done when:

1. All seven acceptance criteria (§4) pass and CI enforces them.
2. `docs/guides/writing-a-plugin.md` exists and is current.
3. At least one external-facing announcement (changelog, README section, Discord post) communicates the new contributor workflow.
4. The previously hardcoded provider switches (40+ instances) are gone or on the allowlist with documented justification.
5. ElevenLabs lives in `src/plugins/elevenlabs/` and Matrix lives in `src/plugins/matrix/`.
6. A new contributor (or LLM) can complete AC-7 within 30 minutes against the documented guide.
