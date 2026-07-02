---
title: "TomoriBot Docs Index"
---

The docs site is organized as an audience gradient: curious visitor → user → self-hoster
→ contributor → deep-diver. Sidebar order follows that gradient.

> **Restructure in progress.** Many `introduction/`, `features/`, and `self-hosting/`
> pages are Phase 1 stubs (frontmatter + placeholder). Prose lands in Phase 2 — see
> `plans/docs-site-restructure.md`.

## Introduction (order 1)

The marketing front door — what TomoriBot is and how to start using it.

- [`introduction/README.mdx`](./introduction/) — hero + feature-card deck (Phase 2)
- [`introduction/quickstart.md`](./introduction/quickstart) — invite the public instance or self-host

## Features (order 2)

Capability-oriented pages for people *using* TomoriBot. Category pages with sections;
a section graduates to its own file when it outgrows ~2-3 screens or gains its own setup flow.

- [`features/README.mdx`](./features/) — capability tour card grid
- [`features/chatting-and-triggers.md`](./features/chatting-and-triggers)
- [`features/multiple-personas.md`](./features/multiple-personas)
- [`features/memory.md`](./features/memory)
- [`features/tools-and-extensions.md`](./features/tools-and-extensions)
- [`features/scheduled-tasks.md`](./features/scheduled-tasks)
- [`features/media-generation/`](./features/media-generation/) — image, video, and voice generation
- [`features/providers-and-models.md`](./features/providers-and-models)
- [`features/personalization.md`](./features/personalization)
- [`features/server-moderation.md`](./features/server-moderation)
- [`features/behavior-tweaking.md`](./features/behavior-tweaking)
- [`features/data-handling.md`](./features/data-handling)
- [`features/stats-and-insights.md`](./features/stats-and-insights)
- [`features/matrix-bridge.md`](./features/matrix-bridge)
- [`features/command-reference.md`](./features/command-reference) — generated from command locales (Phase 3)
- [`features/sillytavern-support.md`](./features/sillytavern-support)

## Self-Hosting (order 3)

Running your own instance — core install plus every optional module. You don't need the
source open to follow these.

- [`self-hosting/README.md`](./self-hosting/) — requirements + module directory
- [`self-hosting/setup-wizard.md`](./self-hosting/setup-wizard) — guided `bun run setup`
- [`self-hosting/manual-setup.md`](./self-hosting/manual-setup) — manual procedure for technical users
- [`self-hosting/local-endpoints.md`](./self-hosting/local-endpoints) — self-hosted endpoints hub
- [`self-hosting/setup-local-llm.md`](./self-hosting/setup-local-llm)
- [`self-hosting/setup-comfyui.md`](./self-hosting/setup-comfyui)
- [`self-hosting/setup-searxng.md`](./self-hosting/setup-searxng)
- [`self-hosting/setup-crawl4ai.md`](./self-hosting/setup-crawl4ai)
- [`self-hosting/setup-chatmock.md`](./self-hosting/setup-chatmock)
- [`self-hosting/setup-local-mcp.md`](./self-hosting/setup-local-mcp)
- [`self-hosting/text-to-speech/`](./self-hosting/text-to-speech/) — local TTS engines
- [`self-hosting/speech-to-text/`](./self-hosting/speech-to-text/) — local STT engines
- [`self-hosting/safe-migration.md`](./self-hosting/safe-migration)
- [`self-hosting/local-monitoring.md`](./self-hosting/local-monitoring)
- [`self-hosting/local-grafana-setup.md`](./self-hosting/local-grafana-setup)

## Contributing (order 4)

Code-contribution guides — for extending or modifying the bot with the source open.
Start at [`contributing/development-tasks.md`](./contributing/development-tasks) for the
task index and coding conventions, and
[`contributing/getting-started.md`](./contributing/getting-started) for local dev setup.

Per-task guides:

- [`contributing/adding-slash-command.md`](./contributing/adding-slash-command)
- [`contributing/adding-event-handler.md`](./contributing/adding-event-handler)
- [`contributing/adding-builtin-tool.md`](./contributing/adding-builtin-tool)
- [`contributing/adding-feature-flag-tool.md`](./contributing/adding-feature-flag-tool)
- [`contributing/adding-setup-module.md`](./contributing/adding-setup-module)
- [`contributing/adding-db-column.md`](./contributing/adding-db-column)
- [`contributing/adding-new-provider.md`](./contributing/adding-new-provider)
- [`contributing/adding-locale.md`](./contributing/adding-locale)
- [`contributing/adding-persona-preset.md`](./contributing/adding-persona-preset)
- [`contributing/raw-sql-boundary.md`](./contributing/raw-sql-boundary) — keeping raw SQL in the repository layer
- [`contributing/docs-authoring.md`](./contributing/docs-authoring) — docs routes, frontmatter, sidebar, cards, and asset conventions

Testing your changes:

- [`contributing/testing-db-changes.md`](./contributing/testing-db-changes)
- [`contributing/testing-chat-changes.md`](./contributing/testing-chat-changes)

## Architecture (order 5)

Code-level reference for deep-divers and plugin authors.

- [`architecture/README.md`](./architecture/) — code-level overview
- [`architecture/entry-point.md`](./architecture/entry-point) — startup and initialization flow

### Pipelines

Per-stage reference. Each folder has a `README.md` (overview + ASCII flow) and numbered stage files.

- [`architecture/pipelines/chat/`](./architecture/pipelines/chat/) — message ingress → per-turn execution
- [`architecture/pipelines/context-build/`](./architecture/pipelines/context-build/) — preset routing + native context assembly
- [`architecture/pipelines/tool-loop/`](./architecture/pipelines/tool-loop/) — tool-call dispatch loop
- [`architecture/pipelines/provider/`](./architecture/pipelines/provider/) — stream adapter → chunk normalization → Discord delivery
- [`architecture/pipelines/memory/`](./architecture/pipelines/memory/) — STM passive capture + LTM create/update/delete

### Subsystems

Supporting services that pipelines depend on.

- [`architecture/subsystems/`](./architecture/subsystems/) — database schema, events, commands, tools,
  caching, cooldowns, security, localization, multi-persona, persona-presets, and more

### Integrations

- [`architecture/integrations/`](./architecture/integrations/) — Discord platform, Matrix bridge,
  NovelAI, SillyTavern, and voice pipeline internals

## Wiki (hidden)

Reachable only via in-page links — not shown in the sidebar.

- [`wiki/refactor-record.md`](./wiki/refactor-record) — historical plugin-architecture-prerequisite refactor record
- [`wiki/threat-models.md`](./wiki/threat-models) — security threat models
