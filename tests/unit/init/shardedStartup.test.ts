import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import { z } from "zod";
import type { Client } from "discord.js";
import { startBot } from "@/index";
import * as discord from "@/init/discord";
import * as secrets from "@/init/secrets";
import * as database from "@/init/database";
import * as backup from "@/init/backup";
import * as heap from "@/init/heapSnapshot";
import * as media from "@/init/media";
import * as loaders from "@/init/loaders";
import * as timers from "@/init/timers";
import * as ownership from "@/utils/discord/shardOwnership";
import * as leases from "@/utils/cluster/shardLeases";
import * as busApi from "@/utils/cache/invalidationBus";
import * as shutdownState from "@/utils/misc/shutdownState";
import { statRepository } from "@/utils/db/repositories/StatRepository";
import { discordPresenceRetention } from "@/utils/cache/discordPresenceRetention";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { healthTracker } from "@/utils/misc/healthTracker";
import type { CoordinationClock, LeaseStore } from "@/utils/cluster/leaseKeeper";
import { stubLogMembers } from "../../helpers/mockSurface";
import { useEnvSandbox } from "../../helpers/env";

useEnvSandbox([
  "RUN_ENV",
  "DATABASE_SCHEMA_MANAGEMENT_ENABLED",
  "DISCORD_TOKEN",
  "TOMORI_PUBLIC_BASE_URL",
  "MATRIX_HOMESERVER_URL",
  "MATRIX_ACCESS_TOKEN",
  "MATRIX_HS_TOKEN",
  "MATRIX_BOT_USER_ID",
  "MATRIX_SERVER_NAME",
]);
stubLogMembers({ section: () => {}, info: () => {}, success: () => {}, error: async () => {}, warn: () => {} });
const restores: Array<() => void> = [];
const cleanups: Array<() => Promise<void>> = [];
const signalEvents = ["uncaughtException", "unhandledRejection", "SIGINT", "SIGTERM"] as const;
let sequence = 0;

afterEach(async () => {
  healthTracker.stopWatchdog();
  for (const cleanup of cleanups.splice(0)) await cleanup();
  for (const restore of restores.splice(0).reverse()) restore();
});
afterAll(async () => {
  await getGuildMcpManager().cleanup();
});

function fixture(
  options: {
    all?: boolean;
    blocked?: boolean;
    databaseFailure?: boolean;
    loginFailure?: boolean;
    subscriptionFailure?: boolean;
    waitForBus?: Promise<void>;
    waitForDatabase?: Promise<void>;
    waitForBudget?: boolean;
  } = {},
) {
  process.env.RUN_ENV = "development";
  process.env.DATABASE_SCHEMA_MANAGEMENT_ENABLED = "false";
  process.env.DISCORD_TOKEN = "fixture-token";
  process.env.TOMORI_PUBLIC_BASE_URL = "";
  process.env.MATRIX_HOMESERVER_URL = "";
  process.env.MATRIX_ACCESS_TOKEN = "";
  process.env.MATRIX_HS_TOKEN = "";
  process.env.MATRIX_BOT_USER_ID = "";
  process.env.MATRIX_SERVER_NAME = "";
  const topology = ownership.parseShardTopology(
    options.all ? { SHARD_COUNT: "4" } : { SHARD_COUNT: "4", SHARD_IDS: "0,1" },
  );
  let now = 0;
  let draining = false;
  let cached: string | null = "stale";
  let client: Client | undefined;
  const order: string[] = [];
  const databaseEntered = Promise.withResolvers<void>();
  const subscriptionEntered = Promise.withResolvers<void>();
  const budgetEntered = Promise.withResolvers<void>();
  let watchdog: Parameters<typeof healthTracker.startWatchdog>[0] | undefined;
  const exitCodes: number[] = [];
  const store: LeaseStore = {
    takeIfExpired: async (name) => {
      order.push(`take:${name}`);
      return options.blocked && name === "shard:1" ? null : { token: "1" };
    },
    renew: async () => ({ token: "1" }),
    release: async (name) => {
      order.push(`release:${name}`);
      return true;
    },
  };
  const clock: CoordinationClock = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    schedule: () => () => {},
  };
  let coordinator: leases.ShardLeaseCoordinator | undefined;
  const bus = new busApi.InvalidationBus();
  bus.register(
    "startup",
    z.tuple([]),
    () => {},
    () => {
      order.push("flush");
      cached = null;
    },
  );
  const transport: busApi.InvalidationTransport = {
    listen: async (_name, _receive, subscribed) => {
      order.push("subscribe");
      subscriptionEntered.resolve();
      await options.waitForBus;
      if (options.subscriptionFailure) throw new Error("Controlled subscription failure");
      subscribed();
      return {
        unlisten: async () => {
          order.push("unlisten");
        },
      };
    },
    notify: async () => {},
  };
  const originalCreate = discord.createDiscordClient;
  const originalWatchdog = healthTracker.startWatchdog.bind(healthTracker);
  const listeners = new Map(signalEvents.map((name) => [name, new Set(process.listeners(name))]));
  const userId = String(1300000000000000000n + BigInt(sequence++));
  const spies = [
    spyOn(secrets, "loadSecrets").mockResolvedValue(undefined),
    spyOn(ownership, "initializeShardTopology").mockReturnValue(topology),
    spyOn(ownership, "getShardTopology").mockReturnValue(topology),
    spyOn(discord, "resolvePresenceIntentEnabled").mockResolvedValue(true),
    spyOn(backup, "initStartupBackup").mockResolvedValue(undefined),
    spyOn(heap, "registerHeapSnapshotHandler").mockImplementation(() => {}),
    spyOn(media, "initMediaProcessing").mockImplementation(() => {}),
    spyOn(discord, "createDiscordClient").mockImplementation((presences, retention, selected, signal) => {
      client = originalCreate(presences, retention, selected, signal);
      const login = spyOn(client, "login").mockImplementation(async () => {
        order.push("login");
        expect(discordPresenceRetention.has("1200000000004194304", userId)).toBe(true);
        if (options.loginFailure) throw new Error("Controlled login failure");
        return "fixture-token";
      });
      const rest = spyOn(client.rest, "get").mockImplementation(async (_route, request) => {
        budgetEntered.resolve();
        if (options.waitForBudget)
          await new Promise<void>((_resolve, reject) => {
            const signal = request?.signal;
            if (!signal) throw new Error("Missing startup cancellation signal");
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        return { session_start_limit: { remaining: 100, reset_after: 1000, max_concurrency: 1 } };
      });
      const originalDestroy = client.destroy.bind(client);
      const destroy = spyOn(client, "destroy").mockImplementation(async () => {
        order.push("destroy");
        await originalDestroy();
      });
      for (const spy of [login, rest, destroy]) restores.push(() => spy.mockRestore());
      return client;
    }),
    spyOn(database, "initDatabase").mockImplementation(async () => {
      order.push("database");
      databaseEntered.resolve();
      await options.waitForDatabase;
      if (options.databaseFailure) throw new Error("Controlled database failure");
    }),
    spyOn(healthTracker, "startWatchdog").mockImplementation((callback) => {
      watchdog = callback;
      originalWatchdog(callback);
    }),
    spyOn(leases, "acquireShardLeases").mockImplementation(async (callbacks, signal) => {
      coordinator = new leases.ShardLeaseCoordinator(topology, callbacks, store, clock);
      return coordinator.acquire(signal);
    }),
    spyOn(leases, "hasShardLeaseOwnership").mockImplementation(() => coordinator?.hasOwnership() ?? false),
    spyOn(leases, "releaseShardLeases").mockImplementation(async () => {
      await coordinator?.stop();
    }),
    spyOn(busApi, "startInvalidationBus").mockImplementation(async () => {
      await bus.start(transport, topology);
    }),
    spyOn(busApi, "stopInvalidationBus").mockImplementation(async () => {
      await bus.stop();
    }),
    spyOn(statRepository, "getPresenceRetentionPairs").mockImplementation(async (selected) => {
      expect(selected).toBe(topology);
      order.push("presence");
      return [{ server_disc_id: "1200000000004194304", user_disc_id: userId }];
    }),
    spyOn(loaders, "initLoaders").mockImplementation(async () => {
      expect(cached).toBe(options.all ? "stale" : null);
      cached = "warm";
      order.push("warm");
    }),
    spyOn(timers, "initTimers").mockImplementation(async () => {
      order.push("timers");
    }),
    spyOn(statRepository, "shutdown").mockImplementation(async () => {
      order.push("stats");
    }),
    spyOn(getGuildMcpManager(), "cleanup").mockImplementation(async () => {
      order.push("mcp");
    }),
    spyOn(shutdownState, "beginDrain").mockImplementation(() => {
      draining = true;
    }),
    spyOn(shutdownState, "isDraining").mockImplementation(() => draining),
    spyOn(process, "exit").mockImplementation((code) => {
      exitCodes.push(Number(code));
      return undefined as never;
    }),
  ];
  for (const spy of spies) restores.push(() => spy.mockRestore());
  cleanups.push(async () => {
    await bus.stop();
    await coordinator?.stop();
    await client?.destroy();
    for (const event of signalEvents)
      for (const listener of process.listeners(event))
        if (!listeners.get(event)?.has(listener)) process.removeListener(event, listener);
  });
  return {
    order,
    exitCodes,
    databaseEntered: databaseEntered.promise,
    subscriptionEntered: subscriptionEntered.promise,
    budgetEntered: budgetEntered.promise,
    timeout: async () => {
      if (!watchdog) throw new Error("Missing watchdog");
      await watchdog({ shardIds: [0, 1], notReadySince: 0 });
    },
    cached: () => cached,
    client: () => client,
    draining: () => draining,
  };
}

describe("sharded startup", () => {
  it("all-owner mode warms and logs in without a lease query or listener", async () => {
    const f = fixture({ all: true });
    await startBot();
    expect(f.order).toContain("login");
    expect(f.order.some((event) => event.startsWith("take:") || event === "subscribe")).toBe(false);
    expect(f.exitCodes).toEqual([]);
  });

  it("keeps caches cold until subscription and the initial flush are ready", async () => {
    const ready = Promise.withResolvers<void>();
    const f = fixture({ waitForBus: ready.promise });
    const startup = startBot();
    await f.subscriptionEntered;
    expect(f.order).toContain("subscribe");
    expect(f.cached()).toBe("stale");
    expect(f.order).not.toContain("login");
    ready.resolve();
    await startup;
    expect(f.cached()).toBe("warm");
    expect(f.order.indexOf("database")).toBeLessThan(f.order.indexOf("take:shard:0"));
    expect(f.order.indexOf("flush")).toBeLessThan(f.order.indexOf("presence"));
    expect(f.order.indexOf("presence")).toBeLessThan(f.order.indexOf("warm"));
  });

  it("releases partial grants and refuses warming or login when acquisition is blocked", async () => {
    const f = fixture({ blocked: true });
    await startBot();
    expect(f.order).toContain("release:shard:0");
    expect(f.order).not.toContain("subscribe");
    expect(f.order).not.toContain("warm");
    expect(f.order).not.toContain("login");
    expect(f.exitCodes).toEqual([1]);
  });

  it.each([
    "databaseFailure",
    "subscriptionFailure",
    "loginFailure",
  ] as const)("cleans partial startup on %s", async (failure) => {
    const f = fixture({ [failure]: true });
    await startBot();
    expect(f.draining()).toBe(true);
    expect(f.order.indexOf("stats")).toBeLessThan(f.order.indexOf("mcp"));
    expect(f.order.indexOf("mcp")).toBeLessThan(f.order.indexOf("destroy"));
    expect(f.exitCodes).toEqual([1]);
    if (failure !== "databaseFailure") expect(f.order.indexOf("mcp")).toBeLessThan(f.order.indexOf("release:shard:0"));
    if (failure === "loginFailure") expect(f.order).toContain("unlisten");
    else expect(f.order).not.toContain("warm");
  });

  it("rejects subset schema management and configured Matrix before warming", async () => {
    const f = fixture();
    process.env.DATABASE_SCHEMA_MANAGEMENT_ENABLED = "true";
    await expect(startBot()).rejects.toThrow();
    expect(f.client()).toBeUndefined();
    process.env.DATABASE_SCHEMA_MANAGEMENT_ENABLED = "false";
    process.env.MATRIX_HOMESERVER_URL = "https://matrix.example.invalid";
    process.env.MATRIX_ACCESS_TOKEN = "fixture-as";
    process.env.MATRIX_HS_TOKEN = "fixture-hs";
    process.env.MATRIX_BOT_USER_ID = "@fixture:example.invalid";
    process.env.MATRIX_SERVER_NAME = "example.invalid";
    await expect(startBot()).rejects.toThrow();
    expect(f.order).not.toContain("warm");
    expect(f.client()).toBeUndefined();
  });

  it("uses the watchdog before readiness and cleans a never-ready partial startup", async () => {
    const databaseReady = Promise.withResolvers<void>();
    const f = fixture({ waitForDatabase: databaseReady.promise });
    const startup = startBot();
    await f.databaseEntered;
    await f.timeout();
    databaseReady.resolve();
    await startup;
    expect(f.order).not.toContain("warm");
    expect(f.order).not.toContain("login");
    expect(f.order).toContain("destroy");
    expect(f.exitCodes).toEqual([1]);
  });

  it("cancels the pre-login session wait during graceful startup shutdown", async () => {
    const f = fixture({ waitForBudget: true });
    const startup = startBot();
    await f.budgetEntered;
    const signal = process.listeners("SIGTERM").at(-1);
    if (!signal) throw new Error("Missing shutdown handler");
    signal("SIGTERM");
    await startup;
    expect(f.order).not.toContain("login");
    expect(f.order).toContain("unlisten");
    expect(f.order).toContain("release:shard:0");
    expect(f.exitCodes).toEqual([0]);
  });
});
