---
title: "Architecture"
sidebar:
  groupLabel: "Architecture"
  order: 5
---

:::tip[New to TomoriBot?]
This section is the code-level overview for contributors and integrators. If you're here to
*use* the bot, start at the **[Introduction](/introduction/)** and
**[Features](/features/)** instead.
:::

TomoriBot is a TypeScript + Bun Discord AI chatbot focused on configurable personalities, memory, and tool use. It is a modular bot with provider-agnostic AI execution, centralized tool routing, and PostgreSQL-backed state.

## What TomoriBot Includes

- Multi-provider chat with streaming responses
  - Providers: `google`, `openrouter`, `novelai`, and `custom` (self-hosted OpenAI-compatible endpoints)
- Multi-persona runtime
  - Main + alter personas per server, persona trigger routing, and persona-specific reminders/webhooks
- Memory systems
  - Server memories, personal memories, short-term memory summaries, and persona-scoped conditioning memory per server
- Tool execution
  - Built-in tools, MCP servers, unified `web_search`, and unified `fetch_url` behind one tool registry
- RAG document memory
  - Optional in local/dev (auto-detected via pgvector), always enabled in production
- Localization
  - `en-US` and `ja` loaded from `src/locales/{locale}/` directory trees
- Security
  - Encrypted key storage, key-version rotation support, and optional AWS Secrets Manager loading
- Optional Matrix bridge
  - Discord ↔ Matrix channel linking via appservice bridge credentials

## Design Principles

- Modular boundaries by domain (`commands`, `events`, `providers`, `tools`, `utils`)
- Event-driven runtime through one event dispatcher
- Provider abstraction (`LLMProvider`) with dynamic provider discovery
- Centralized tool registry for built-in + MCP + REST tools
- Database as source of truth, caches for read performance
- Strict TypeScript + runtime validation

## Core Runtime Shape

- Entry point: `src/index.ts`
- Event dispatch: `src/handlers/eventHandler.ts`
- Slash commands: `src/commands/*`
- Providers: `src/providers/*`
- Tools: `src/tools/*`
- Data model: `src/db/schema.sql` (+ `src/db/schema_rag.sql`)

## High-Level Flow

```text
Discord Gateway
  -> discord.js Client (src/index.ts → src/init/discord.ts)
  -> eventHandler (src/handlers/eventHandler.ts)
     -> interactionCreate handlers (slash commands)
     -> messageCreate handlers (chat pipeline)

chat pipeline
  -> readable messageCreate coordinator (src/events/messageCreate/tomoriChat.ts)
  -> typed invocation normalization (src/utils/chat/admission.ts)
  -> reply/no-reply admission decision (src/utils/chat/admission.ts)
  -> channel queue and lock management (src/utils/chat/channelQueue.ts)
  -> turn planning and persona routing (src/utils/chat/turnPlanner.ts)
  -> chat-visible context pipeline (src/utils/chat/contextPipeline.ts)
  -> response sink creation (src/utils/chat/responseEmitter.ts)
  -> generation stage (src/utils/chat/generationTurn.ts)
  -> post-turn effects (src/utils/chat/postTurnEffects.ts)
  -> trigger/reply decision helpers (src/utils/chat/triggerProcessor.ts)
  -> message history preprocessing (references/media/reaction metadata) + context builder + caches
  -> provider factory -> selected provider
  -> stream adapter + orchestrator
  -> optional tool calls via ToolRegistry
  -> response emitter helpers (src/utils/chat/responseEmitter.ts) + Discord response streaming
```

## Key Subsystems

### Commands

- Files under `src/commands/*`
- Loaded dynamically by `src/utils/discord/commandLoader.ts`
- Hierarchy from folder shape:
  - `category/subcommand.ts` -> `/category subcommand`
  - `category/group/subcommand.ts` -> `/category group subcommand`

### Events

- Dispatcher: `src/handlers/eventHandler.ts`
- Event folders under `src/events/*`
- Multiple Discord events can map to one folder (emoji/sticker update fan-in)
- `src/events/messageCreate/tomoriChat.ts` is the readable coordinator for the chat pipeline
- Message-create chat helpers live under `src/utils/chat/*`; direct `.ts` siblings of `tomoriChat.ts` are event handlers, not helper modules

### Providers

- Interface: `src/types/provider/interfaces.ts`
- Factory: `src/utils/provider/providerFactory.ts`
- Providers are discovered from `src/providers/*` directories (lazy loaded)
- Current providers: `google`, `openrouter`, `novelai`, `custom`

### Tools

- Registry: `src/tools/toolRegistry.ts`
- Auto-discovery: `src/tools/toolInitializer.ts`
- Built-ins: `src/tools/functionCalls/*` (`BaseTool` classes)
- MCP servers: `src/tools/mcpServers/*` via `mcpManager`
- REST tools: `src/tools/restAPIs/brave/*` (engine-internal, consumed by `webSearch/braveEngine.ts`)
- Web-search dispatcher: `src/tools/webSearch/*` — single LLM-visible `web_search(query, category)` tool routes through a Brave → DDG → Felo engine chain
- URL-fetch dispatcher: `src/tools/fetchUrl/*` — single LLM-visible `fetch_url(url, ...)` tool routes through optional Crawl4AI sidecar, then internal `mcp_fetch` fallback

### Data + Caching

- Schema: `src/db/schema.sql`
- Optional RAG schema: `src/db/schema_rag.sql`
- Repository boundary: `src/utils/db/repositories/*`
  - 23 Repository classes implement `IRepository<TExport>` with `toExportShape()` / `fromExportShape()`. Each owns one clear domain; SQL is inlined as private methods with no sibling SQL files.
  - `src/utils/db/repositories/index.ts` re-exports repository instances and shared types only — no free-function shims. Callers import repository instances directly (e.g. `import { personaRepository } from "@/utils/db/repositories"`).
  - The former public DB god-file entry points and all `*ReadSql.ts`/`*WriteSql.ts` sibling files have been removed.
- Core caches in `src/utils/cache/*` (Tomori state, user, expression data, whitelist, short-term memory, model/capability caches)

### Security + Secrets

- Secrets loading: `src/utils/security/secretsManager.ts`
- Encryption/key versioning: `src/utils/security/keyManager.ts`, `src/utils/security/crypto.ts`
- API keys are stored encrypted in DB (`BYTEA` + `key_version`)

## Runtime Extensions

- Optional bridge runtimes: `src/utils/bridges/*` (`src/utils/bridges/matrix/*` for Matrix)
- Optional production health endpoint: `127.0.0.1:3000/health`
- Optional pg_cron scheduling for cooldown cleanup
- Shared in-app scheduled work coordinator for reminder delivery and random triggers
  - Uses next-due `setTimeout` scheduling plus DB-write nudges and a periodic reconcile backstop
  - Reminder rows are acknowledged only after generated delivery succeeds; aborted or queue-cleared deliveries are rescheduled after `REMINDER_DELIVERY_RETRY_DELAY_MS`

## Why This Shape Works

- Easy to extend commands/providers/tools without central rewrites
- Clear fallback paths (cache -> DB, provider capability cache -> DB flags)
- Works in local dev and production with different secret/infra setups

## Current Command Surface

Commands are loaded from folders under `src/commands/` (currently 25 top-level categories):

- `bot`, `capabilities`, `conditioning`, `config`, `contribute`, `donate`, `generate`, `help`, `legal`, `mcp`, `memory`, `model`, `novelai`, `nsfw`, `openrouter`, `optional-key`, `persona`, `personal`, `provider`, `scheduled-task`, `server`, `speech`, `st-preset`, `support`, `tool`

## Read Next

- [entry-point.md](./entry-point) — startup and initialization flow
- Setting up locally for development: [`contributing/getting-started.md`](../contributing/getting-started)
