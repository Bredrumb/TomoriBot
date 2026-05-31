---
title: "Introduction to TomoriBot"
sidebar:
  groupLabel: "Introduction"
  order: 1
---

TomoriBot is a TypeScript + Bun Discord AI chatbot focused on configurable personalities, memory, and tool use.

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

## Core Runtime Shape

- Entry point: `src/index.ts`
- Event dispatch: `src/handlers/eventHandler.ts`
- Slash commands: `src/commands/*`
- Providers: `src/providers/*`
- Tools: `src/tools/*`
- Data model: `src/db/schema.sql` (+ `src/db/schema_rag.sql`)

## Current Command Surface

Commands are loaded from folders under `src/commands/` (currently 25 top-level categories):

- `bot`, `capabilities`, `conditioning`, `config`, `contribute`, `donate`, `generate`, `help`, `legal`, `mcp`, `memory`, `model`, `novelai`, `nsfw`, `openrouter`, `optional-key`, `persona`, `personal`, `provider`, `scheduled-task`, `server`, `speech`, `st-preset`, `support`, `tool`

## Read Next

- Start with [getting-started.md](./getting-started)
- Then [architecture.md](./architecture)
- Then [entry-point.md](./entry-point)
