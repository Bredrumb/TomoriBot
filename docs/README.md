---
title: "TomoriBot Docs Index"
---

This folder is organized by topic. Start with `architecture/` for a high-level orientation, then
go to `pipelines/` for the authoritative per-stage reference.

## Architecture

High-level orientation: what TomoriBot is, how it starts up, and how data is modelled.

- [`architecture/introduction.md`](./architecture/introduction)
- [`architecture/getting-started.md`](./architecture/getting-started)
- [`architecture/architecture.md`](./architecture/architecture)
- [`architecture/entry-point.md`](./architecture/entry-point)

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
- [`subsystems/multi-persona.md`](./subsystems/multi-persona) — _(will migrate to `pipelines/webhook-persona/` when that pipeline is walked)_
- [`subsystems/persona-presets.md`](./subsystems/persona-presets) — _(will migrate to `pipelines/webhook-persona/` when that pipeline is walked)_

## Integrations

- [`integrations/matrix-bridge.md`](./integrations/matrix-bridge)
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

## Guides

Start at [`guides/development-tasks.md`](./guides/development-tasks) for the task index and coding conventions.

Per-task guides:

- [`guides/adding-slash-command.md`](./guides/adding-slash-command)
- [`guides/adding-event-handler.md`](./guides/adding-event-handler)
- [`guides/adding-builtin-tool.md`](./guides/adding-builtin-tool)
- [`guides/adding-db-column.md`](./guides/adding-db-column)
- [`guides/adding-locale.md`](./guides/adding-locale)
- [`guides/adding-new-provider.md`](./guides/adding-new-provider)
- [`guides/adding-feature-flag-tool.md`](./guides/adding-feature-flag-tool)
- [`guides/adding-persona-preset.md`](./guides/adding-persona-preset)

Other guides:

- [`guides/local-grafana-setup.md`](./guides/local-grafana-setup)
- [`guides/testing-db-changes.md`](./guides/testing-db-changes)
- [`guides/testing-chat-changes.md`](./guides/testing-chat-changes)
- [`guides/safe-migration.md`](./guides/safe-migration)

## Refactor Record

- [`architecture/refactor-record.md`](./architecture/refactor-record) — Historical record of the plugin-architecture-prerequisite refactor (Phases 1–5.5e): module restructuring, behavioral verification, DB layer reorganization, and cache invalidation ownership.
