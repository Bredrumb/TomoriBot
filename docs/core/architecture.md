<!-- ARCH-ALIGNMENT: prereq-phase-1 -->

# 3. Architecture Overview

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
  -> message history preprocessing (references/media/reaction metadata) + context builder + caches
  -> provider factory -> selected provider
  -> stream adapter + orchestrator
  -> optional tool calls via ToolRegistry
  -> Discord response streaming
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
- REST tools: `src/tools/restAPIs/brave/*`

### Data + Caching

- Schema: `src/db/schema.sql`
- Optional RAG schema: `src/db/schema_rag.sql`
- Core caches in `src/utils/cache/*` (Tomori state, user, expression data, whitelist, short-term memory, model/capability caches)

### Security + Secrets

- Secrets loading: `src/utils/security/secretsManager.ts`
- Encryption/key versioning: `src/utils/security/keyManager.ts`, `src/utils/security/crypto.ts`
- API keys are stored encrypted in DB (`BYTEA` + `key_version`)

## Runtime Extensions

- Optional Matrix bridge: `src/utils/matrix/*`
- Optional production health endpoint: `127.0.0.1:3000/health`
- Optional pg_cron scheduling for cooldown cleanup
- Shared in-app scheduled work coordinator for reminder delivery and random triggers
  - Uses next-due `setTimeout` scheduling plus DB-write nudges and a periodic reconcile backstop

## Why This Shape Works

- Easy to extend commands/providers/tools without central rewrites
- Clear fallback paths (cache -> DB, provider capability cache -> DB flags)
- Works in local dev and production with different secret/infra setups
