---
title: "Entry Point and Initialization Flow"
sidebar:
  order: 4
---

`src/index.ts` is a thin orchestrator. All initialization logic lives in `src/init/` modules.

## Files

- `src/index.ts` — orchestrator (calls init modules in order)
- `src/init/healthServer.ts` — health HTTP server
- `src/init/secrets.ts` — secrets loading + key manager init
- `src/init/discord.ts` — Discord client construction + error handlers
- `src/init/database.ts` — DB init, cooldown cleanup, pg_cron setup
- `src/init/loaders.ts` — tool registry, localizer, caches, event handler
- `src/init/bridges.ts` — Matrix bridge (optional)
- `src/init/timers.ts` — health tracker, scheduled work, memory monitor, cache metrics, quota cleanup
- `src/types/config.ts` — `AppConfig` interface + `resolveEnvironment()`

## Startup Sequence

1. Load `.env` (`dotenv`); resolve `AppEnvironment`.
2. In production: bind health HTTP server on `$PORT` (default 8080) — returns 503 until Discord ready.
3. Load secrets via `getAppSecrets()`; populate `process.env` for downstream consumers; initialize `keyManager`.
4. Construct Discord client with intents + sweepers; register process/client error handlers.
5. Initialize database:
   - run narrow pre-schema legacy rename bridges for known table renames that would otherwise conflict with fresh `schema.sql`
   - run `src/db/schema.sql`
   - run `src/db/schema_rag.sql` only when pgvector is detected
   - run `src/db/schema_stpreset.sql`
   - run `src/db/seed.sql`
   - run pending numbered migrations from `src/db/migrations/`
6. Cleanup expired cooldown rows at startup (`cleanupExpiredCooldowns`).
7. Attempt optional `pg_cron` registration for hourly cooldown cleanup job.
8. Initialize tool registry (`initializeTools`).
9. Initialize localization (`initializeLocalizer`).
10. Initialize model caches:
    - LLM cache (`initializeLLMCache`)
    - OpenRouter capability cache (`initializeOpenRouterCapabilityCache`)
11. Preload preset avatar cache from DB presets.
12. Initialize Matrix bridge (optional; non-fatal on failure).
13. Attach all event listeners (`eventHandler(client)`).
14. Register post-ready startup hooks (deferred until `clientReady`):
    - health tracker init
    - scheduled work coordinator init (reminders + random triggers)
    - memory monitor init
    - cache metrics logger init
15. Initialize upload quota cleanup scheduler.
16. Call `client.login(DISCORD_TOKEN)`.

## Error Criticality

- Fatal (process exits):
  - database init failure
  - tool registry init failure
- Non-fatal (warn and continue):
  - cache warmup failures
  - pg_cron setup failures
  - matrix init failure
  - cooldown cleanup failure
  - scheduled work/memory monitor/quota cleanup init failures

## Discord Client Configuration Notes

- `GuildPresences` intent is only added outside production.
- Sweeper configuration is enabled for message/user cache pressure control.

## clientReady Event Work

`eventHandler` executes all handlers in `src/events/clientReady/` (sorted), including:

- command registration
- MCP server registration
- command registry initialization
- status/presence setup

Additional `client.once("clientReady")` hooks in `index.ts` initialize health tracking, scheduled work, and memory monitoring.

## Production Health Endpoint

`GET /health` returns:

- `200` when healthy
- `503` when unhealthy

Health is computed from:

- Discord ready state
- websocket ping threshold
- recent Discord event activity
