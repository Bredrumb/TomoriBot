# 1. Introduction to TomoriBot

TomoriBot is a TypeScript + Bun Discord AI chatbot focused on configurable personalities, memory, and tool use.

## What TomoriBot Includes

- Multi-provider chat with streaming responses
  - Providers: `google`, `openrouter`, `novelai`, and `custom` (self-hosted OpenAI-compatible endpoints)
- Multi-persona runtime
  - Main + alter personas per server, persona trigger routing, and persona-specific reminders/webhooks
- Memory systems
  - Server memories, personal memories, short-term memory summaries, and persona-scoped conditioning memory per server
- Tool execution
  - Built-in tools, MCP servers, and Brave REST tools behind one tool registry
- RAG document memory
  - Optional in local/dev (auto-detected via pgvector), always enabled in production
- Localization
  - `en-US` and `ja` loaded from `src/locales/*.ts`
- Security
  - Encrypted key storage, key-version rotation support, and optional AWS Secrets Manager loading
- Optional Matrix bridge
  - Discord ↔ Matrix channel linking via appservice bridge credentials

## Core Runtime Shape

- Entry point: `src/index.ts`
- Event dispatch: `src/handlers/eventHandler.ts`
- Slash commands: `src/commands/*`
- Providers: `src/providers/*`
- Tools: `src/tools/*`
- Data model: `src/db/schema.sql` (+ `src/db/schema_rag.sql`)

## Current Command Surface

Commands are loaded from folders under `src/commands/` (currently 17 top-level categories):

- `bot`, `conditioning`, `config`, `contribute`, `donate`, `generate`, `help`, `legal`, `memory`, `novelai`, `optional-key`, `persona`, `personal`, `server`, `st-preset`, `support`, `tool`

## Documentation Layout

- Index: [`docs/README.md`](../README.md)
- Core: [`core/`](./)
- Systems: [`systems/`](../systems/)
- AI: [`ai/`](../ai/)
- Integrations: [`integrations/`](../integrations/)
- Guides: [`guides/`](../guides/)

## Read Next

- Start with [getting-started.md](./getting-started.md)
- Then [architecture.md](./architecture.md)
- Then [entry-point.md](./entry-point.md)
