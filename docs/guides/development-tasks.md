# 14. Common Development Tasks

This document gives current implementation patterns for common TomoriBot changes.

For global coding conventions (formatting, imports, typing, env/config patterns, logging),
see `docs/guides/coding-standards.md`.

## 1) Add a New Slash Command

1. Create file in the correct path:
   - `src/commands/{category}/{subcommand}.ts`
   - or `src/commands/{category}/{group}/{subcommand}.ts`
2. Export:
   - `configureSubcommand(subcommand)`
   - `execute(client, interaction, userData, locale)`
3. Use `localizer("en-US", ...)` for command description and options.
4. Add locale keys to both `src/locales/en-US.ts` and `src/locales/ja.ts`.
5. Respect the 3-second interaction rule:
   - fast commands can reply immediately
   - async commands should `deferReply()` before heavy work
   - modal/pagination helpers should not be pre-deferred incorrectly
   - for exact command patterns, see `docs/systems/command-system.md` ("Interaction Timing Rules")
6. Validate:

```bash
bun run check-locales
bun run check
bun run lint
```

## 2) Add a New Event Handler

1. Create folder under `src/events/{folderName}` if needed.
2. Add handler file with default export function.
3. Map Discord event name to folder in `src/handlers/eventHandler.ts` (`eventFolderMap`).
4. Restart dev server and verify logs.

## 3) Add a New Built-In Tool

1. Create file in `src/tools/functionCalls/`.
2. Export class extending `BaseTool`.
3. Define:
   - `name`, `description`, `category`, `parameters`, `execute()`
4. Optional:
   - `requiresFeatureFlag`, `requiresPermissions`, `requiresFollowUp`
5. Tool is auto-discovered by `toolInitializer.ts` at startup.

## 4) Add a New DB Column

1. Add idempotent migration in `src/db/schema.sql` (usually `add_column_if_not_exists`).
2. Update Zod schema/types in `src/types/db/schema.ts`.
3. Wire read/write usage in `utils/db/*`.
4. Invalidate affected caches after successful writes.

## 5) Add a New Locale

1. Add `src/locales/{locale}.ts` mirroring existing key structure.
2. Ensure all required keys exist.
3. `initializeLocalizer()` auto-discovers locale files; no manual registration needed.
4. Run `bun run check-locales`.

## 6) Add a New AI Provider

Follow `docs/guides/adding-new-provider.md`.

Important:

1. Provider class auto-discovery is only one part of provider integration.
2. New providers also need static metadata in `providerInfo.ts`; `providerInfoRegistry` auto-discovers it.
3. If the provider supports app-level features beyond core chat, declare those feature implementations in `providerInfo.ts`.
4. Seed the correct model tables for the features you support.

## 7) Add a New Feature Flag-Controlled Tool

1. Map config -> flag in `src/utils/tools/featureFlagMapper.ts` (`configToFeatureFlags`).
2. Add tool-to-flag mapping in `BUILTIN_TOOL_FEATURE_FLAGS` or `MCP_TOOL_FEATURE_FLAGS`.
3. Set corresponding `requiresFeatureFlag` in tool class when appropriate.
4. Ensure config command(s) can toggle that underlying config field.

## 8) Add a New Persona Preset

1. Add preset row in `src/db/seed.sql` (`tomori_presets`).
2. Add optional avatar path (stored under `src/db/img/`).
3. Validate via `/persona import` and persona cache behavior.

## Development Checklist

Before merging:

```bash
bun run check
bun run lint
bun run check-locales
bun run vl-db
```

`bun run vl-db` requires a local disposable PostgreSQL target, CREATE/DROP database permission, and PostgreSQL client tools (`pg_dump`/`psql`). It creates and drops its own temporary database, then tests fresh initialization plus backup/restore and DB maintenance scripts.

And test command/event/tool flow in Discord.
