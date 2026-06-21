---
title: "TomoriBot Docs Index"
---

This folder is organized by topic. Start with `architecture/` for a high-level orientation, then
go to `pipelines/` for the authoritative per-stage reference.

## Architecture

High-level orientation: what TomoriBot is, how it starts up, and how data is modelled.

- [`architecture/README.md`](./architecture/) — introduction + architecture overview
- [`architecture/entry-point.md`](./architecture/entry-point) — startup and initialization flow

> Local dev setup moved to [`contributor-guides/getting-started.md`](./contributor-guides/getting-started).

## Pipelines

Each pipeline folder has a `README.md` (overview + ASCII flow) and numbered stage files.
These are the primary reference for contributors and future plugin authors.

- [`pipelines/chat/`](./pipelines/chat/) — message ingress → per-turn execution
- [`pipelines/context-build/`](./pipelines/context-build/) — preset routing + native context assembly (14 blocks)
- [`pipelines/tool-loop/`](./pipelines/tool-loop/) — tool-call dispatch loop driven by the generation turn
- [`pipelines/provider/`](./pipelines/provider/) — stream adapter → chunk normalization → Discord delivery
- [`pipelines/memory/`](./pipelines/memory/) — STM passive capture + LTM create/update/delete
- `pipelines/command/` — _(planned; absorbs `subsystems/command-system.md`)_
- `pipelines/webhook-persona/` — _(planned; absorbs `subsystems/multi-persona.md` identity-swap parts)_

## Subsystems

Supporting services that pipelines depend on. Not pipelines themselves — these expose surfaces
rather than sequenced stages.

- [`subsystems/database-schema.md`](./subsystems/database-schema)
- [`subsystems/event-system.md`](./subsystems/event-system)
- [`subsystems/command-system.md`](./subsystems/command-system)
- [`subsystems/tool-system.md`](./subsystems/tool-system)
- [`subsystems/status-command.md`](./subsystems/status-command)
- [`subsystems/prompt-snapshot.md`](./subsystems/prompt-snapshot)
- [`subsystems/utils.md`](./subsystems/utils)
- [`subsystems/localization.md`](./subsystems/localization)
- [`subsystems/security.md`](./subsystems/security)
- [`subsystems/caching.md`](./subsystems/caching)
- [`subsystems/cooldowns.md`](./subsystems/cooldowns)
- [`subsystems/video-generation.md`](./subsystems/video-generation)
- [`subsystems/thinking-level.md`](./subsystems/thinking-level)
- [`subsystems/logit-bias.md`](./subsystems/logit-bias)
- [`subsystems/strict-chat-completion.md`](./subsystems/strict-chat-completion) — role-alternation / prefix-completion toggles + always-on media relocation
- [`subsystems/multi-persona.md`](./subsystems/multi-persona) — _(will migrate to `pipelines/webhook-persona/` when that pipeline is walked)_
- [`subsystems/persona-presets.md`](./subsystems/persona-presets) — _(will migrate to `pipelines/webhook-persona/` when that pipeline is walked)_

## Integrations

- Matrix:
  - [`integrations/matrix/bridge.md`](./integrations/matrix/bridge)
- Discord platform capabilities:
  - [`integrations/discord/message-components-v2.md`](./integrations/discord/message-components-v2)
  - [`integrations/discord/modal-input-components.md`](./integrations/discord/modal-input-components)
- SillyTavern:
  - [`integrations/sillytavern/card-support.md`](./integrations/sillytavern/card-support)
  - [`integrations/sillytavern/preset-system.md`](./integrations/sillytavern/preset-system)
- NovelAI:
  - [`integrations/novelai/tool-calling.md`](./integrations/novelai/tool-calling)
  - [`integrations/novelai/limitations.md`](./integrations/novelai/limitations)
  - [`integrations/novelai/inpainting.md`](./integrations/novelai/inpainting)
- Voice (all audio I/O):
  - [`integrations/voice/README.md`](./integrations/voice/README)
  - [`integrations/voice/tts/`](./integrations/voice/tts/)
  - [`integrations/voice/stt/`](./integrations/voice/stt/)

## Contributor Guides

Code-contribution guides — for extending or modifying the bot with the source open.
Start at [`contributor-guides/development-tasks.md`](./contributor-guides/development-tasks)
for the task index and coding conventions, and
[`contributor-guides/getting-started.md`](./contributor-guides/getting-started) for local dev setup.

Per-task guides:

- [`contributor-guides/adding-slash-command.md`](./contributor-guides/adding-slash-command)
- [`contributor-guides/adding-event-handler.md`](./contributor-guides/adding-event-handler)
- [`contributor-guides/adding-builtin-tool.md`](./contributor-guides/adding-builtin-tool)
- [`contributor-guides/adding-feature-flag-tool.md`](./contributor-guides/adding-feature-flag-tool)
- [`contributor-guides/adding-db-column.md`](./contributor-guides/adding-db-column)
- [`contributor-guides/adding-new-provider.md`](./contributor-guides/adding-new-provider)
- [`contributor-guides/adding-locale.md`](./contributor-guides/adding-locale)
- [`contributor-guides/adding-persona-preset.md`](./contributor-guides/adding-persona-preset)

Testing your changes:

- [`contributor-guides/testing-db-changes.md`](./contributor-guides/testing-db-changes)
- [`contributor-guides/testing-chat-changes.md`](./contributor-guides/testing-chat-changes)

## User Guides

Self-hosting and operation guides — for running your own instance, no source required.

- [`user-guides/setup-searxng.md`](./user-guides/setup-searxng)
- [`user-guides/setup-crawl4ai.md`](./user-guides/setup-crawl4ai)
- [`user-guides/setup-chatmock.md`](./user-guides/setup-chatmock)
- [`user-guides/local-monitoring.md`](./user-guides/local-monitoring)
- [`user-guides/local-grafana-setup.md`](./user-guides/local-grafana-setup)
- [`user-guides/safe-migration.md`](./user-guides/safe-migration)

## Wiki

- [`wiki/refactor-record.md`](./wiki/refactor-record) — Historical record of the plugin-architecture-prerequisite refactor (Phases 1–5.5e): module restructuring, behavioral verification, DB layer reorganization, and cache invalidation ownership.
