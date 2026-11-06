import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { MetricSampleRepository, type MetricFields } from "@/utils/db/repositories/MetricSampleRepository";
import { parseShardTopology } from "@/utils/discord/shardOwnership";
import { useEnvSandbox } from "../../helpers/env";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

useEnvSandbox(["CACHE_METRICS_INTERVAL_MS"]);
const repository = new MetricSampleRepository(testSql);
const topology = parseShardTopology({ SHARD_COUNT: "4", SHARD_IDS: "0,1" });

async function sample(ids: string, guilds: number, ageMs = 0, count = 4): Promise<void> {
  const fields: MetricFields = {
    process_label: ids.split(",").length === count ? "all" : `shards:${count}:${ids}`,
    shard_ids: ids,
    shard_count: count,
    discord_guilds: guilds,
  };
  await testSql`
    INSERT INTO metric_samples (metric_name, fields, created_at)
    VALUES ('cache_sizes', ${fields}, clock_timestamp() - ${ageMs} * INTERVAL '1 millisecond')
  `;
}

describe.skipIf(!DB_TESTS_AVAILABLE)("cluster guild totals", () => {
  beforeAll(async () => {
    await setupTestDb();
  });
  afterEach(async () => {
    await testSql`DELETE FROM metric_samples WHERE metric_name = 'cache_sizes'`;
  });

  test("sums only the latest fresh sample for each disjoint logical process", async () => {
    await sample("0,1", 800, 1000);
    await sample("0,1", 900);
    await sample("2,3", 600, 1000);
    await sample("2,3", 700);
    expect(await repository.getClusterGuildCount(topology)).toBe(1600);
  });

  test("requires local and peer coverage, including a legitimate zero-guild peer", async () => {
    expect(await repository.getClusterGuildCount(topology)).toBeNull();
    await sample("2,3", 0);
    expect(await repository.getClusterGuildCount(topology)).toBeNull();
    await sample("0,1", 12);
    expect(await repository.getClusterGuildCount(topology)).toBe(12);
  });

  test("excludes stale, future and incompatible topology samples", async () => {
    process.env.CACHE_METRICS_INTERVAL_MS = "300000";
    await sample("0,1", 20);
    await sample("2,3", 99, 601000);
    await sample("2,3", 88, -60000);
    await sample("2,3,4", 77, 0, 5);
    expect(await repository.getClusterGuildCount(topology)).toBeNull();
    await sample("2,3", 10);
    expect(await repository.getClusterGuildCount(topology)).toBe(30);
  });

  test("rejects overlapping peer groups and ignores old groups incompatible with the local owner", async () => {
    await sample("0,1", 20);
    await sample("0,2", 100);
    await sample("0,1,2,3", 1000);
    await sample("2", 5);
    await sample("3", 8);
    expect(await repository.getClusterGuildCount(topology)).toBe(33);
    await sample("2,3", 13);
    expect(await repository.getClusterGuildCount(topology)).toBeNull();
  });

  test("does not promote malformed stored JSON into a complete total", async () => {
    await sample("0,1", 20);
    for (const fields of [
      { process_label: "shards:4:2,3", shard_ids: "2,3", shard_count: 4, discord_guilds: -1 },
      { process_label: "shards:4:3,2", shard_ids: "3,2", shard_count: 4, discord_guilds: 10 },
      { process_label: "shards:4:2,2,3", shard_ids: "2,2,3", shard_count: 4, discord_guilds: 10 },
      { process_label: "other", shard_ids: "2,3", shard_count: 4, discord_guilds: 10 },
      { process_label: "shards:4:4", shard_ids: "4", shard_count: 4, discord_guilds: 10 },
    ]) {
      await testSql`INSERT INTO metric_samples (metric_name, fields) VALUES ('cache_sizes', ${fields})`;
    }
    expect(await repository.getClusterGuildCount(topology)).toBeNull();
  });
});
