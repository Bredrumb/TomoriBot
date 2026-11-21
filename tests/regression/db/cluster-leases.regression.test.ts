import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { ClusterLeaseRepository } from "@/utils/db/repositories/ClusterLeaseRepository";
import { ShardLeaseCoordinator } from "@/utils/cluster/shardLeases";
import type { CoordinationClock, LeaseState } from "@/utils/cluster/leaseKeeper";
import { LeaseKeeper } from "@/utils/cluster/leaseKeeper";
import { parseShardTopology } from "@/utils/discord/shardOwnership";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

const repository = new ClusterLeaseRepository(testSql);
const callbacks = { onLost: () => {}, onStateChange: (_state: LeaseState) => {} };

describe.skipIf(!DB_TESTS_AVAILABLE)("cluster leases", () => {
  beforeAll(setupTestDb);
  afterEach(async () => {
    await testSql`DELETE FROM cluster_leases`;
  });

  test("racing holders grant exactly one live lease for each shard", async () => {
    for (const name of ["shard:0", "shard:1"]) {
      const grants = await Promise.all([
        repository.takeIfExpired(name, "incarnation-a", 30_000),
        repository.takeIfExpired(name, "incarnation-b", 30_000),
      ]);
      expect(grants.filter(Boolean)).toHaveLength(1);
      const [stored] =
        await testSql`SELECT holder, expires_at > clock_timestamp() AS live FROM cluster_leases WHERE name = ${name}`;
      expect(stored.live).toBe(true);
      const winner = grants[0] ? "incarnation-a" : "incarnation-b";
      expect(stored.holder).toBe(winner);
      const grant = grants.find((value) => value !== null);
      if (!grant) throw new Error("Missing winning grant");
      expect(await repository.renew(name, winner, grant.token, 30_000)).not.toBeNull();
    }
  });

  test("expiry changes tokens, stale renewals fail, and stale releases cannot remove new ownership", async () => {
    const first = await repository.takeIfExpired("shard:0", "incarnation-a", 30_000);
    if (!first) throw new Error("Missing first grant");
    expect(await repository.takeIfExpired("shard:0", "incarnation-a", 30_000)).toBeNull();
    expect(await repository.renew("shard:0", "incarnation-b", first.token, 30_000)).toBeNull();
    expect(await repository.release("shard:0", "incarnation-b", first.token)).toBe(false);
    await testSql`UPDATE cluster_leases SET expires_at = clock_timestamp() - INTERVAL '1 millisecond' WHERE name = 'shard:0'`;
    expect(await repository.renew("shard:0", "incarnation-a", first.token, 30_000)).toBeNull();
    const next = await repository.takeIfExpired("shard:0", "incarnation-b", 30_000);
    if (!next) throw new Error("Missing successor grant");
    expect(BigInt(next.token)).toBeGreaterThan(BigInt(first.token));
    expect(await repository.release("shard:0", "incarnation-a", first.token)).toBe(false);
    expect(await repository.renew("shard:0", "incarnation-b", first.token, 30_000)).toBeNull();
    expect(await repository.renew("shard:0", "incarnation-b", next.token, 30_000)).not.toBeNull();
    expect(await repository.release("shard:0", "incarnation-b", next.token)).toBe(true);
    const third = await repository.takeIfExpired("shard:0", "incarnation-b", 30_000);
    expect(BigInt(third?.token ?? "0")).toBeGreaterThan(BigInt(next.token));
  });

  test("identical logical labels do not allow different live incarnations to share ownership", async () => {
    const topology = parseShardTopology({ SHARD_COUNT: "4", SHARD_IDS: "0,1" });
    const first = new ShardLeaseCoordinator(topology, callbacks, repository);
    const second = new ShardLeaseCoordinator(topology, callbacks, repository);
    const shutdown = new AbortController();
    try {
      expect(await first.acquire(shutdown.signal)).toBe(true);
      const waiting = second.acquire(shutdown.signal);
      shutdown.abort();
      await expect(waiting).rejects.toThrow();
      expect(first.isPrimaryProcess()).toBe(true);
      expect(second.hasOwnership()).toBe(false);
    } finally {
      await first.stop();
      await second.stop();
    }
  });

  test("partial acquisition rolls back all grants before retrying a live predecessor", async () => {
    const blocker = await repository.takeIfExpired("shard:1", "predecessor", 30_000);
    if (!blocker) throw new Error("Missing predecessor");
    const shutdown = new AbortController();
    let partialReleased = false;
    const clock: CoordinationClock = {
      now: () => performance.now(),
      schedule: () => () => {},
      sleep: async () => {
        const [row] =
          await testSql`SELECT expires_at <= clock_timestamp() AS released FROM cluster_leases WHERE name = 'shard:0'`;
        partialReleased = row.released;
        shutdown.abort();
        shutdown.signal.throwIfAborted();
      },
    };
    const coordinator = new ShardLeaseCoordinator(
      parseShardTopology({ SHARD_COUNT: "4", SHARD_IDS: "0,1" }),
      callbacks,
      repository,
      clock,
    );
    try {
      await expect(coordinator.acquire(shutdown.signal)).rejects.toThrow();
      expect(partialReleased).toBe(true);
      expect(await repository.renew("shard:1", "predecessor", blocker.token, 30_000)).not.toBeNull();
      expect(coordinator.hasOwnership()).toBe(false);
    } finally {
      await coordinator.stop();
    }
  });

  test("real database renewals remain serial and safety deadlines include query transport time", async () => {
    let now = 0;
    let inFlight = 0;
    let maximumInFlight = 0;
    const pending = new Set<{ run: () => void; at: number }>();
    const clock: CoordinationClock = {
      now: () => now,
      sleep: async () => {},
      schedule: (run, ms) => {
        const timer = { run, at: now + ms };
        pending.add(timer);
        return () => {
          pending.delete(timer);
        };
      },
    };
    let finish: (() => void) | undefined;
    const renewed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let renewals = 0;
    const store = {
      takeIfExpired: async (...args: Parameters<typeof repository.takeIfExpired>) => {
        const grant = await repository.takeIfExpired(...args);
        now += 500;
        return grant;
      },
      release: repository.release.bind(repository),
      renew: async (...args: Parameters<typeof repository.renew>) => {
        inFlight++;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        const grant = await repository.renew(...args);
        now += 500;
        inFlight--;
        if (++renewals === 2) finish?.();
        return grant;
      },
    };
    const keeper = new LeaseKeeper(["shard:0", "shard:1"], "incarnation-a", callbacks, store, clock);
    try {
      expect(await keeper.acquire(new AbortController().signal)).toBe(true);
      expect(keeper.safetyDeadline).toBe(25_000);
      now += 10_000;
      for (const timer of [...pending]) {
        if (timer.at <= now && pending.delete(timer)) timer.run();
      }
      await renewed;
      await Promise.resolve();
      expect(maximumInFlight).toBe(1);
      expect(keeper.safetyDeadline).toBe(36_000);
      expect(keeper.isValid()).toBe(true);
    } finally {
      await keeper.stop();
    }
  });

  test("a cancelled blocked database claim settles without granting owner work", async () => {
    await repository.takeIfExpired("shard:0", "predecessor", 30_000);
    let unlock: (() => void) | undefined;
    let locked: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const lock = testSql.begin(async (tx) => {
      await tx`SELECT name FROM cluster_leases WHERE name = 'shard:0' FOR UPDATE`;
      locked?.();
      await new Promise<void>((resolve) => {
        unlock = resolve;
      });
    });
    await ready;
    const shutdown = new AbortController();
    const claim = repository.takeIfExpired("shard:0", "incarnation-a", 30_000, shutdown.signal);
    const outcome = claim.then(
      () => false,
      () => true,
    );
    shutdown.abort();
    try {
      expect(await outcome).toBe(true);
    } finally {
      unlock?.();
      await lock;
    }
  });

  test("migration rollback and forward restore usable lease storage", async () => {
    try {
      await executeTestSqlFile("src/db/migrations/132_cluster_leases.down.sql");
      const [row] = await testSql`SELECT to_regclass('public.cluster_leases') IS NULL AS removed`;
      expect(row.removed).toBe(true);
    } finally {
      await executeTestSqlFile("src/db/migrations/132_cluster_leases.sql");
    }
    expect(await repository.takeIfExpired("shard:0", "incarnation-a", 30_000)).not.toBeNull();
  });
});
