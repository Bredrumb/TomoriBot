---
title: "Architecture Overview"
sidebar:
  order: 3
---

TomoriBot is a modular Discord bot with provider-agnostic AI execution, centralized tool routing, and PostgreSQL-backed state.

## Design Principles

- Modular boundaries by domain (`commands`, `events`, `providers`, `tools`, `utils`)
- Event-driven runtime through one event dispatcher
- Provider abstraction (`LLMProvider`) with dynamic provider discovery
- Centralized tool registry for built-in + MCP + REST tools
- Database as source of truth, caches for read performance
- Strict TypeScript + runtime validation

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
- URL-fetch dispatcher: `src/tools/fetchUrl/*` — single LLM-visible `fetch_url(url, ...)` tool routes through optional Crawl4AI, then internal `mcp_fetch` fallback

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

## Why This Shape Works

- Easy to extend commands/providers/tools without central rewrites
- Clear fallback paths (cache -> DB, provider capability cache -> DB flags)
- Works in local dev and production with different secret/infra setups
