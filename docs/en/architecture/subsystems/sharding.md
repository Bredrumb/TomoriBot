---
title: "Sharding and process ownership"
aiGenerated: true
---

One Discord client can own several gateway shards in one process. Optional static shard groups
split guild ownership across processes on one host while PostgreSQL coordinates shared state.

## Topology and ownership

`src/utils/discord/shardOwnership.ts` parses topology after secrets load, independently of
`NODE_ENV` and `RUN_ENV`.

| Configuration | Ownership |
|---|---|
| `SHARD_COUNT` unset, empty, or `auto`; `SHARD_IDS` unset | Discord selects the total at startup; this process owns every shard. |
| `SHARD_COUNT=4`; `SHARD_IDS` unset | One process owns shards 0, 1, 2, and 3. |
| `SHARD_COUNT=4`; `SHARD_IDS=0,1` | This process owns two of the four shards. Other processes must cover the remaining shards. |

An explicit total must be a positive safe integer. An explicit list requires an explicit total
and must contain unique, nonnegative integers below that total. An empty list is invalid. IDs are
sorted before use. A list containing every shard also uses all-owner mode.

Guild placement uses `(BigInt(guildId) >> 22n) % BigInt(totalShardCount)`. DMs belong to shard 0.
Channel queues, webhook slots, avatar locks, and active conversation state stay inside the guild's
owner process. The chat and delivery paths check configured placement and current lease safety;
they do not query PostgreSQL for every message. See the
[channel lock](/architecture/pipelines/chat/04-channel-lock/).

Auto selects a startup topology; it does not resize a running client. Every subset process must
agree on the total and use disjoint lists. Leases do not validate complete coverage or make a
change of total safe: changing the total changes guild placement. Stop old owners before starting
a replacement topology. There is no automatic takeover or distributed channel queue.

## Startup and coordination

`src/index.ts` owns the [startup sequence](/architecture/entry-point/). Subset processes refuse
startup with schema management enabled or a fully configured Matrix bridge. Run the existing
`src/db/initializeCli.ts` migration one-shot separately, then start gateway processes with
`DATABASE_SCHEMA_MANAGEMENT_ENABLED=false`. Matrix forwarding across owners is unsupported.

Before warming caches or logging in, a subset acquires every selected shard lease and starts the
[cache invalidation bus](/architecture/subsystems/caching/). Owned presence history is restored
before login. All-owner mode opens neither shard leases nor the invalidation listener, including
when the client owns several shards.

All modes check Discord's session-start budget before login and wait for its reset when low.
Subsets also install the PostgreSQL identify throttler for initial connections and reconnects.
It serializes identifies across processes, conservatively using one shared slot rather than
Discord's full concurrency allowance. `src/utils/cluster/identifyThrottler.ts` owns those waits.

## Lease safety and failure

`src/utils/cluster/leaseKeeper.ts` and
`src/utils/db/repositories/ClusterLeaseRepository.ts` own acquisition, renewal, and release.
PostgreSQL time controls expiry; holder IDs and increasing tokens prevent a stale holder from
renewing or releasing a successor's lease. Acquisition must succeed for the whole configured group
before Discord login; partial grants are released on failure.

Leases expire after 30 seconds and renew every 10 seconds. A local safety deadline measured from
query send time ends ownership earlier, after 25 seconds. A renewal error or missed safety deadline
makes ownership uncertain: active turns are aborted and scheduled dispatch stops, while the gateway
and renewal loop remain connected. Successful renewal can restore admission and start a fresh
scheduler once the client is ready. Work captured before uncertainty keeps its aborted signal,
so recovery cannot revive an old delivery continuation.

A renewal that confirms lost ownership requests immediate shutdown with a failure exit. Startup
errors after coordination begins use the same cleanup path. Failed release leaves expiry to
permit a successor. Database tokens cannot fence a Discord request already dispatched, and an
accepted provider operation can still complete or incur cost after cancellation.

## Background work

The live owner of shard 0 is the primary process. Discord command registration, command catalog
sync, OpenRouter pricing writes, global STM/OAuth cleanup, message-proxy pruning, metric retention, Natural Nudges pruning,
and preset-art seeding check that predicate before shared side effects. These checks do not provide
durable exactly-once execution across a crash or primary handover.

Every process still loads local tools, locales, models, command routes, and monitors. Reminders,
random triggers, Natural Nudges, presence history, development MCP eager-connect, and preset avatar
fan-out select owned guilds. Scheduled continuations carry cancellation through awaited work and
check again before dispatch or consuming a schedule. Delivered reminders, random triggers, and Natural Nudges can settle during graceful drain while their captured owner epoch remains valid. A process-local wake signal accelerates local
changes; periodic reconciliation discovers changes written by a peer.

Subset status totals come from fresh `cache_sizes` samples covering every shard exactly once.
Missing, stale, overlapping, or invalid peer evidence produces no total; status uses count-free
activity and the primary defers Top.gg posting until a complete total exists. All-owner mode uses
the client's guild count. Source owners are `src/init/timers.ts`,
`src/timers/scheduledWorkCoordinator.ts`, `src/events/clientReady/status.ts`, and
`src/utils/db/repositories/MetricSampleRepository.ts`.

## Shutdown and health

SIGTERM and SIGINT close admission and stop scheduled and timer work. Interactions receive the
localized restarting notice. Existing channel turns have up to 25 seconds to drain; remaining
turns are then aborted. Stats, MCP/Matrix, and coordination cleanup each have a three-second bound;
listener shutdown and lease release are attempted concurrently. Client destruction has one second.
The controller has a 38-second deadline and needs a deployment stop grace of at least 40 seconds.
Confirmed lease loss skips the turn-drain wait. See `src/init/shutdown.ts` for the cleanup contract.

`/health` and `/healthz`, when the HTTP server is enabled, describe this process's gateway shards.
A 200 requires a ready client and every expected owned shard ready with a finite ping between 0
and 5,000 ms. A missing shard or invalid ping returns 503. `discord.shards` contains each ID,
gateway status, readiness, ping, failure streak, last failure, and not-ready timestamp;
`discord.shardCount` is the resolved total. The scalar `websocketPing` is the maximum available
shard ping. Activity age and event-loop diagnostics do not affect the verdict.

The watchdog starts before database initialization and requests failure shutdown after five minutes
of continuous not-ready state for an expected shard, including startup. Health is a gateway verdict;
it does not assert lease safety, database availability, completed draining, or cluster-wide coverage.
The external supervisor must restart an exited process with backoff. Configuration and sizing
guidance lives in [production tuning](/wiki/production-tuning/) and
[Docker Compose](/self-hosting/docker-compose/).
