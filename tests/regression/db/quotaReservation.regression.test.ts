import { afterAll, beforeAll, beforeEach, expect, it } from "bun:test";
import {
  imageQuotaConfigSchema,
  textQuotaConfigSchema,
  videoQuotaConfigSchema,
  type ImageQuotaConfigRow,
  type TextQuotaConfigRow,
  type VideoQuotaConfigRow,
} from "@/types/db/schema";
import {
  releaseImageQuotaUnits,
  releaseTextQuotaUnits,
  releaseVideoQuotaUnits,
  reserveImageQuotaUnits,
  reserveTextQuotaUnits,
  reserveVideoQuotaUnits,
} from "@/utils/db/repositories/QuotaRepository";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

let refs: FixtureRefs;

beforeAll(async () => {
  if (!DB_TESTS_AVAILABLE) return;
  await setupTestDb();
  refs = await insertFixtures(testSql);
});

beforeEach(async () => {
  if (!DB_TESTS_AVAILABLE) return;
  for (const table of [
    "text_quotas",
    "text_serverwide_quotas",
    "image_quotas",
    "image_serverwide_quotas",
    "video_quotas",
    "video_serverwide_quotas",
  ]) {
    await testSql.unsafe(`DELETE FROM ${table} WHERE server_id = $1`, [refs.serverId]);
  }
});

afterAll(async () => {
  if (DB_TESTS_AVAILABLE) await cleanupFixtures(testSql);
});

function videoConfig(overrides: Partial<VideoQuotaConfigRow>): VideoQuotaConfigRow {
  return videoQuotaConfigSchema.parse({
    server_id: refs.serverId,
    daily_user_quota: 0,
    serverwide_quota: 0,
    serverwide_quota_resets_in: 30,
    enabled: true,
    ...overrides,
  });
}

function imageConfig(overrides: Partial<ImageQuotaConfigRow>): ImageQuotaConfigRow {
  return imageQuotaConfigSchema.parse({
    server_id: refs.serverId,
    daily_user_quota: 0,
    serverwide_quota: 0,
    serverwide_quota_resets_in: 30,
    enabled: true,
    ...overrides,
  });
}

function textConfig(overrides: Partial<TextQuotaConfigRow>): TextQuotaConfigRow {
  return textQuotaConfigSchema.parse({
    server_id: refs.serverId,
    daily_user_quota: 0,
    serverwide_quota: 0,
    serverwide_quota_resets_in: 30,
    enabled: true,
    ...overrides,
  });
}

it.skipIf(!DB_TESTS_AVAILABLE)(
  "admits exactly one of twenty concurrent video claims against a cap of one",
  async () => {
    const config = videoConfig({ daily_user_quota: 1 });
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => reserveVideoQuotaUnits(refs.serverId, "user_concurrent", config)),
    );

    expect(outcomes.filter((outcome) => outcome.status === "reserved")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "user_quota_exceeded")).toHaveLength(19);

    const rows = await testSql`
    SELECT usage_count FROM video_quotas WHERE server_id = ${refs.serverId} AND user_disc_id = 'user_concurrent'
  `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.usage_count).toBe(1);
  },
);

it.skipIf(!DB_TESTS_AVAILABLE)(
  "rolls the user claim back when the serverwide pool refuses the same transaction",
  async () => {
    const config = videoConfig({ daily_user_quota: 5, serverwide_quota: 1 });
    const users = ["user_alpha", "user_beta"];
    const results = await Promise.all(
      users.map(async (userDiscId) => ({
        userDiscId,
        outcome: await reserveVideoQuotaUnits(refs.serverId, userDiscId, config),
      })),
    );

    const winners = results.filter((result) => result.outcome.status === "reserved");
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => result.outcome.status === "serverwide_quota_exceeded")).toHaveLength(1);

    const rows = await testSql`
      SELECT user_disc_id, usage_count FROM video_quotas WHERE server_id = ${refs.serverId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_disc_id).toBe(winners[0]?.userDiscId);
    expect(rows[0]?.usage_count).toBe(1);
  },
);

it.skipIf(!DB_TESTS_AVAILABLE)("release restores the video units it reserved", async () => {
  const config = videoConfig({ daily_user_quota: 5, serverwide_quota: 5 });
  const outcome = await reserveVideoQuotaUnits(refs.serverId, "user_release", config);
  if (outcome.status !== "reserved") throw new Error(`Expected a reservation, got ${outcome.status}`);

  const [before] = await testSql`
    SELECT usage_count FROM video_quotas WHERE server_id = ${refs.serverId} AND user_disc_id = 'user_release'
  `;
  expect(before?.usage_count).toBe(1);

  await releaseVideoQuotaUnits(refs.serverId, "user_release", outcome.reservation);

  const [userRow] = await testSql`
    SELECT usage_count FROM video_quotas WHERE server_id = ${refs.serverId} AND user_disc_id = 'user_release'
  `;
  const [poolRow] = await testSql`
    SELECT usage_count FROM video_serverwide_quotas WHERE server_id = ${refs.serverId}
  `;
  expect(userRow?.usage_count).toBe(0);
  expect(poolRow?.usage_count).toBe(0);
});

it.skipIf(!DB_TESTS_AVAILABLE)(
  "a stale release leaves the next day's user row and the next pool period alone",
  async () => {
    const config = videoConfig({ daily_user_quota: 5, serverwide_quota: 5 });
    const outcome = await reserveVideoQuotaUnits(refs.serverId, "user_stale", config);
    if (outcome.status !== "reserved") throw new Error(`Expected a reservation, got ${outcome.status}`);

    const [yesterday] = await testSql`SELECT (CURRENT_DATE - 1)::text AS day`;
    const staleDate = yesterday?.day;
    if (!staleDate) throw new Error("Missing yesterday date");
    await testSql`
    UPDATE video_quotas SET quota_date = ${staleDate}::date
    WHERE server_id = ${refs.serverId} AND user_disc_id = 'user_stale'
  `;
    outcome.reservation.quotaDate = staleDate;
    await testSql`
    INSERT INTO video_quotas (server_id, user_disc_id, usage_count, quota_date)
    VALUES (${refs.serverId}, 'user_stale', 2, CURRENT_DATE)
  `;
    await testSql`
    UPDATE video_serverwide_quotas
    SET usage_count = 1, quota_period_start = CURRENT_TIMESTAMP,
      quota_period_end = CURRENT_TIMESTAMP + INTERVAL '30 days'
    WHERE server_id = ${refs.serverId}
  `;

    await releaseVideoQuotaUnits(refs.serverId, "user_stale", outcome.reservation);

    const userRows = await testSql<{ usage_count: number }[]>`
    SELECT usage_count FROM video_quotas
    WHERE server_id = ${refs.serverId} AND user_disc_id = 'user_stale'
    ORDER BY quota_date DESC
  `;
    const [poolRow] = await testSql`
    SELECT usage_count FROM video_serverwide_quotas WHERE server_id = ${refs.serverId}
  `;
    expect(userRows.map((row) => row.usage_count)).toEqual([2, 0]);
    expect(poolRow?.usage_count).toBe(1);
  },
);

it.skipIf(!DB_TESTS_AVAILABLE)("an expired serverwide period starts a new period at one", async () => {
  await testSql`
    INSERT INTO video_serverwide_quotas (server_id, usage_count, quota_period_start, quota_period_end)
    VALUES (${refs.serverId}, 9, CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '1 day')
  `;
  const config = videoConfig({ serverwide_quota: 2 });

  const outcome = await reserveVideoQuotaUnits(refs.serverId, "user_period", config);
  expect(outcome).toMatchObject({ status: "reserved", serverwideRemaining: 1 });

  const [poolRow] = await testSql`
    SELECT usage_count, quota_period_start, quota_period_end FROM video_serverwide_quotas
    WHERE server_id = ${refs.serverId}
  `;
  expect(poolRow?.usage_count).toBe(1);
  expect(new Date(poolRow?.quota_period_end).getTime()).toBeGreaterThan(Date.now());
});

it.skipIf(!DB_TESTS_AVAILABLE)("image claims use the same conditional counter and release", async () => {
  const config = imageConfig({ daily_user_quota: 1 });
  const first = await reserveImageQuotaUnits(refs.serverId, "user_image", config);
  const second = await reserveImageQuotaUnits(refs.serverId, "user_image", config);
  expect(first.status).toBe("reserved");
  expect(second.status).toBe("user_quota_exceeded");
  if (first.status !== "reserved") throw new Error("Expected a reservation");

  await releaseImageQuotaUnits(refs.serverId, "user_image", first.reservation);

  const [row] = await testSql`
    SELECT usage_count FROM image_quotas WHERE server_id = ${refs.serverId} AND user_disc_id = 'user_image'
  `;
  expect(row?.usage_count).toBe(0);
});

it.skipIf(!DB_TESTS_AVAILABLE)("text claims skip unlimited counters and refuse at the serverwide cap", async () => {
  const unlimited = textConfig({});
  const skipped = await reserveTextQuotaUnits(refs.serverId, "user_text", unlimited);
  expect(skipped).toMatchObject({
    status: "reserved",
    reservation: { userCounted: false, serverwidePeriodStart: null },
  });

  const config = textConfig({ serverwide_quota: 1 });
  const first = await reserveTextQuotaUnits(refs.serverId, "user_text", config);
  const second = await reserveTextQuotaUnits(refs.serverId, "user_text_2", config);
  expect(first.status).toBe("reserved");
  expect(second.status).toBe("serverwide_quota_exceeded");
  if (first.status !== "reserved") throw new Error("Expected a reservation");

  await releaseTextQuotaUnits(refs.serverId, "user_text", first.reservation);
  const retry = await reserveTextQuotaUnits(refs.serverId, "user_text_2", config);
  expect(retry.status).toBe("reserved");
});
