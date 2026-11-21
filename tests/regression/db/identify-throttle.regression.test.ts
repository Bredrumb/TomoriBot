import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { ClusterLeaseRepository } from "@/utils/db/repositories/ClusterLeaseRepository";
import { PostgresIdentifyThrottler, waitForSessionStarts } from "@/utils/cluster/identifyThrottler";
import type { CoordinationClock } from "@/utils/cluster/leaseKeeper";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const repository = new ClusterLeaseRepository(testSql);
const gateway = (remaining = 1_000, resetAfter = 60_000) => ({
  session_start_limit: { remaining, reset_after: resetAfter, max_concurrency: 1 },
});
const rest = { get: async () => gateway() };

describe.skipIf(!DB_TESTS_AVAILABLE)("PostgreSQL identify coordination", () => {
  beforeAll(setupTestDb);
  afterEach(async () => {
    await testSql`DELETE FROM cluster_leases`;
  });

  test("two clients and two shards in the same client observe shared five-second spacing", async () => {
    const shutdown = new AbortController();
    const first = new PostgresIdentifyThrottler(rest, shutdown.signal, repository, "incarnation-a");
    const second = new PostgresIdentifyThrottler(rest, shutdown.signal, repository, "incarnation-b");
    const times: number[] = [];
    // Use real time because separate clients must honor PostgreSQL expiry across independent local clocks.
    await Promise.all(
      [
        first.waitForIdentify(0, shutdown.signal),
        first.waitForIdentify(1, shutdown.signal),
        second.waitForIdentify(2, shutdown.signal),
      ].map(async (claim) => {
        await claim;
        times.push(performance.now());
      }),
    );
    times.sort((a, b) => a - b);
    expect(times).toHaveLength(3);
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(5_000);
    expect((times[2] ?? 0) - (times[1] ?? 0)).toBeGreaterThanOrEqual(5_000);
  });

  test("shutdown or shard cancellation interrupts identify waiting without opening the live slot", async () => {
    const grant = await repository.takeIfExpired("discord-identify", "incarnation-a", 5_500);
    if (!grant) throw new Error("Missing identify grant");
    for (const cancelShard of [false, true]) {
      const shutdown = new AbortController();
      const shard = new AbortController();
      const throttler = new PostgresIdentifyThrottler(rest, shutdown.signal, repository, "incarnation-b");
      const waiting = throttler.waitForIdentify(1, shard.signal);
      const rejected = waiting.then(
        () => false,
        () => true,
      );
      await delay(20);
      (cancelShard ? shard : shutdown).abort();
      expect(await rejected).toBe(true);
      expect(await repository.takeIfExpired("discord-identify", "incarnation-b", 5_500)).toBeNull();
    }
  });

  test("exhausted session budget waits for reset and rechecks before permitting startup", async () => {
    let requests = 0;
    const waits: number[] = [];
    const clock: CoordinationClock = {
      now: () => 0,
      schedule: () => () => {},
      sleep: async (ms) => {
        waits.push(ms);
      },
    };
    const gatewayRest = { get: async () => gateway(++requests < 3 ? 0 : 1_000, 80_000) };
    await waitForSessionStarts(gatewayRest, 4, new AbortController().signal, clock);
    expect(waits).toEqual([80_000, 80_000]);
    expect(requests).toBe(3);
  });

  test("shutdown cancels the daily-budget wait without another startup attempt or lease claim", async () => {
    const shutdown = new AbortController();
    let requests = 0;
    const gatewayRest = {
      get: async () => {
        requests++;
        return gateway(0);
      },
    };
    const throttler = new PostgresIdentifyThrottler(gatewayRest, shutdown.signal, repository, "incarnation-a");
    const waiting = throttler.waitForIdentify(0, new AbortController().signal);
    const rejected = waiting.then(
      () => false,
      () => true,
    );
    await delay(20);
    shutdown.abort();
    expect(await rejected).toBe(true);
    expect(requests).toBe(1);
    const [row] = await testSql`SELECT COUNT(*)::int AS count FROM cluster_leases`;
    expect(row.count).toBe(0);
  });

  test("a slow identify grant consumes its slot and requires a fresh grant", async () => {
    let now = 0;
    let claims = 0;
    const clock: CoordinationClock = {
      now: () => now,
      schedule: () => () => {},
      sleep: async (ms) => {
        now += ms;
        await testSql`UPDATE cluster_leases SET expires_at = clock_timestamp() - INTERVAL '1 millisecond' WHERE name = 'discord-identify'`;
      },
    };
    const store = {
      takeIfExpired: async (...args: Parameters<typeof repository.takeIfExpired>) => {
        const grant = await repository.takeIfExpired(...args);
        if (++claims === 1) now += 600;
        return grant;
      },
    };
    const shutdown = new AbortController();
    const throttler = new PostgresIdentifyThrottler(rest, shutdown.signal, store, "incarnation-a", clock);
    await throttler.waitForIdentify(0, shutdown.signal);
    expect(claims).toBe(2);
    const [row] = await testSql`SELECT token::text FROM cluster_leases WHERE name = 'discord-identify'`;
    expect(row.token).toBe("2");
  });

  test("invalid gateway metadata fails closed", async () => {
    await expect(
      waitForSessionStarts(
        { get: async () => ({ session_start_limit: { remaining: -1 } }) },
        4,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
});
