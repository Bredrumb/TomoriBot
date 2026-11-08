---
title: "Entry Point and Initialization Flow"
sidebar:
  order: 4
aiGenerated: true
---

`src/index.ts` coordinates application startup by executing focused initialization modules in
`src/init/` before connecting to Discord.

## Initialization files

- `src/index.ts`: Startup coordinator. Resolves environment, executes initialization steps in order, and connects to Discord.
- `src/init/backup.ts`: Non-production automatic data backup gate before database schema initialization.
- `src/init/healthServer.ts`: Lightweight HTTP health server for production liveness and readiness probes, which also serves OAuth callbacks.
- `src/init/secrets.ts`: Secret resolution and initialization of `keyManager` encryption helpers.
- `src/init/heapSnapshot.ts`: Process-level diagnostic signal handler for on-demand V8 heap snapshots.
- `src/init/media.ts`: Process-global concurrency and memory limits for Sharp and libvips image processing.
- `src/init/discord.ts`: Discord client construction, intent probing, cache sweepers, and gateway error classification.
- `src/init/database.ts`: Schema application, migration execution, catalog seeding, and cooldown cleanup.
- `src/init/loaders.ts`: Modal interception, localization, tool registry, model caches, and event listener registration.
- `src/init/bridges.ts`: Optional Matrix appservice bridge initialization.
- `src/init/timers.ts`: Background periodic tasks, memory monitoring, catalog refreshers, and post-ready hooks.
- `src/types/config.ts`: Configuration interfaces and environment resolution (`resolveEnvironment()`).

The HTTP health server binds in production mode, and in any mode when `TOMORI_PUBLIC_BASE_URL` is
set, because that variable means the instance receives OAuth callbacks. Container healthcheck
configuration belongs to the deployment guides; gateway login errors are reported in process logs.
Optional modules can call `registerHealthServerRoute()` during startup to register a method and path
on the same server. Without `TOMORI_PUBLIC_BASE_URL` the base installation has no extra routes; with
it, `GET /oauth/callback`, `GET /oauth/mcp/start`, and `POST /oauth/mcp/confirm` are registered,
plus `GET /oauth/client.json` unless the base URL is a loopback origin. If the port cannot be bound
while routes are registered, a warning lists them. Built-in health probes take precedence,
and registered handlers receive the parsed request URL. Every registered route answers with
`Content-Security-Policy: frame-ancestors 'none'`, so a sign-in page cannot be framed. Invalid URLs
return 400, and failed handlers return 500 or close the response if headers have already been sent.

## Startup sequence

`startBot()` in `src/index.ts` is also the executable entry point.

1. Load dotenv, resolve the environment, and validate the private-network policy. In production,
   bind the HTTP health server before other initialization; it returns 503 until gateway readiness.
2. Load secrets and initialize shard topology before importing cache consumers. Reject subset
   processes with schema management enabled or a fully configured Matrix bridge. Topology comes
   from configuration independently of the runtime environment.
3. When schema management is enabled, run the non-production startup backup gate. Register optional
   heap diagnostics and configure native media limits. Probe the presence intent and construct the
   Discord client with the selected shards and early per-shard health tracking.
4. Register interaction admission, bounded shutdown, and the readiness watchdog before database
   initialization. Initialize the database: schema management applies schemas, catalogs, migrations,
   and maintenance; gateway processes with it disabled verify connectivity and still purge expired
   cooldowns, but skip schema application and pg_cron setup.
   See `src/init/database.ts` for schema ordering and fresh-database behavior.
5. Acquire all selected shard leases, then subscribe to cache invalidation and complete its initial
   flush. All-owner mode bypasses both. Only then register OAuth routes, bind the callback server
   outside production when configured, and restore owned presence history.
6. Warm local loaders: localization, tools, model and capability caches, preset avatars, and event
   listeners. Shared pricing writes require the live primary predicate. Initialize optional bridges
   and await timer registration before login so ready handlers cannot be missed.
7. Resolve the auto shard total through Discord when needed. Check the session-start budget before
   login. Subsets use the shared PostgreSQL identify throttler; all-owner clients keep discord.js
   throttling. Authenticate with `client.login()`.

[Sharding and process ownership](/architecture/subsystems/sharding/) owns topology validation,
lease safety, background ownership, health semantics, and shutdown limits. The
[cache subsystem](/architecture/subsystems/caching/) owns peer invalidation.

## Failure recovery and lifecycle

Configuration, backup, database initialization, critical tool setup, and gateway login failures
prevent successful startup. After shutdown registration, loader/login errors enter the shared
cleanup path, including failures after lease acquisition. Earlier configuration failures exit
without acquiring coordination resources. The database initializer retains its own fatal error
handling before leases are acquired.

Cache warming, optional bridge connection, and optional maintenance failures retain their local
warning/error handling. A configured subset with Matrix is rejected before that bridge catch path.
Transient gateway startup errors exit for supervisor restart with backoff. During runtime,
discord.js reconnects individual shards; the early watchdog requests bounded shutdown if an
expected shard stays not ready for five minutes.

SIGTERM and SIGINT stop new work, drain active turns, flush stats, close MCP and bridges, stop the
cache listener and release leases, then destroy the Discord client. Client destruction follows the
turn drain so active replies can still finish. Deployments need at least 40 seconds of stop grace.

## Gateway presence intent detection

Guild Presences is a privileged gateway intent. `resolvePresenceIntentEnabled()` probes the bot's
application configuration via `GET /applications/@me` before client construction:

- When Discord reports the presence intent is approved, the client enables `GatewayIntentBits.GuildPresences`.
- When Discord reports the intent is not approved, the client omits the flag. Context builders detect
  missing presence permissions via `client.options.intents.has()` and omit user presence details without
  crashing.
- If the probe request fails due to a network error, startup falls back to safe defaults: enabled in
  development, disabled in production.

## clientReady event execution

Once the gateway connection is confirmed, `eventHandler` runs sorted handlers under `src/events/clientReady/`:

1. `01_registercommands.ts`: Registers application slash commands with the Discord REST API only on the live primary process.
2. `02_guildMcpLifecycle.ts`: Outside production, pre-connects enabled MCP servers for owned guilds while ownership remains safe. Shared shutdown owns cleanup. No local MCP process starts.
3. `03_initCommandRegistry.ts`: Builds fast-lookup routing maps for slash commands.
4. `04_syncCommandCatalog.ts`: Synchronizes command metadata and descriptions with database tables only on the live primary process.
5. `05_postReadyMaintenance.ts`: Resolves legacy channel scopes, starts the document lexical backfill in background batches, and merges queued webhook users into the bot account. Each task handles its own failures. Unmatched channel scopes stay pending and active in every channel until a name matches or an admin saves the item; `src/events/guildAvailable/` retries for a returning guild.
6. `status.ts`: Configures the bot's user status and activity message.

Deferred timers registered in `src/init/timers.ts` trigger on the same `clientReady` event.

## Production health endpoint

`src/init/healthServer.ts` serves `/health` and `/healthz` in production and when a configured
public base URL requires a callback server. Both return per-owned-shard readiness and ping, the
resolved total, connection failures, activity age, and event-loop diagnostics. A 200 requires every
expected owned shard to be ready and within the ping limit; startup and missing shards return 503.
The scalar ping is the maximum available shard ping. See
[sharding](/architecture/subsystems/sharding/) for the verdict's limits and watchdog behavior.
