# TomoriBot Docs Index

This folder is organized by topic. Start with `architecture/` for a high-level orientation, then
go to `pipelines/` for the authoritative per-stage reference.

## Architecture

High-level orientation: what TomoriBot is, how it starts up, and how data is modelled.

- [`architecture/introduction.md`](./architecture/introduction.md)
- [`architecture/getting-started.md`](./architecture/getting-started.md)
- [`architecture/architecture.md`](./architecture/architecture.md)
- [`architecture/entry-point.md`](./architecture/entry-point.md)

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

- [`subsystems/database-schema.md`](./subsystems/database-schema.md)
- [`subsystems/event-system.md`](./subsystems/event-system.md)
- [`subsystems/command-system.md`](./subsystems/command-system.md)
- [`subsystems/status-command.md`](./subsystems/status-command.md)
- [`subsystems/prompt-snapshot.md`](./subsystems/prompt-snapshot.md)
- [`subsystems/utils.md`](./subsystems/utils.md)
- [`subsystems/localization.md`](./subsystems/localization.md)
- [`subsystems/security.md`](./subsystems/security.md)
- [`subsystems/caching.md`](./subsystems/caching.md)
- [`subsystems/cooldowns.md`](./subsystems/cooldowns.md)
- [`subsystems/video-generation.md`](./subsystems/video-generation.md)
- [`subsystems/thinking-level.md`](./subsystems/thinking-level.md)
- [`subsystems/logit-bias.md`](./subsystems/logit-bias.md)
- [`subsystems/multi-persona.md`](./subsystems/multi-persona.md) — _(will migrate to `pipelines/webhook-persona/` when that pipeline is walked)_
- [`subsystems/persona-presets.md`](./subsystems/persona-presets.md) — _(will migrate to `pipelines/webhook-persona/` when that pipeline is walked)_

## Integrations

- [`integrations/matrix-bridge.md`](./integrations/matrix-bridge.md)
- Discord platform capabilities:
  - [`integrations/discord/message-components-v2.md`](./integrations/discord/message-components-v2.md)
  - [`integrations/discord/modal-input-components.md`](./integrations/discord/modal-input-components.md)
- SillyTavern:
  - [`integrations/sillytavern/card-support.md`](./integrations/sillytavern/card-support.md)
  - [`integrations/sillytavern/preset-system.md`](./integrations/sillytavern/preset-system.md)
- NovelAI:
  - [`integrations/novelai/tool-calling.md`](./integrations/novelai/tool-calling.md)
  - [`integrations/novelai/limitations.md`](./integrations/novelai/limitations.md)
  - [`integrations/novelai/inpainting.md`](./integrations/novelai/inpainting.md)
- Voice (all audio I/O):
  - [`integrations/voice/README.md`](./integrations/voice/README.md)
  - [`integrations/voice/tts/`](./integrations/voice/tts/)
  - [`integrations/voice/stt/`](./integrations/voice/stt/)

## Guides

Start at [`guides/development-tasks.md`](./guides/development-tasks.md) for the task index and coding conventions.

Per-task guides:

- [`guides/adding-slash-command.md`](./guides/adding-slash-command.md)
- [`guides/adding-event-handler.md`](./guides/adding-event-handler.md)
- [`guides/adding-builtin-tool.md`](./guides/adding-builtin-tool.md)
- [`guides/adding-db-column.md`](./guides/adding-db-column.md)
- [`guides/adding-locale.md`](./guides/adding-locale.md)
- [`guides/adding-new-provider.md`](./guides/adding-new-provider.md)
- [`guides/adding-feature-flag-tool.md`](./guides/adding-feature-flag-tool.md)
- [`guides/adding-persona-preset.md`](./guides/adding-persona-preset.md)

Other guides:

- [`guides/local-grafana-setup.md`](./guides/local-grafana-setup.md)
- [`guides/testing-db-changes.md`](./guides/testing-db-changes.md)
- [`guides/testing-chat-changes.md`](./guides/testing-chat-changes.md)
- [`guides/safe-migration.md`](./guides/safe-migration.md)

## Refactor Notes

- [`refactor/phase4-cache-audit.md`](./refactor/phase4-cache-audit.md)
