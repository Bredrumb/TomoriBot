/**
 * Regression harness — ServerRepository domain.
 *
 * Covers: channel whitelist reads/writes, blacklist, server setup basics.
 * loadTomoriState implicitly tests server row loading; this file focuses on
 * server-scoped operations that don't fit other domain files.
 *
 * Requires: POSTGRES_DB=tomodb_test (see docs/guides/testing-db-changes.md)
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { isBlacklisted } from "@/utils/db/repositories";
import { FIXTURE_IDS, cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("Server — regression", () => {
  let refs: FixtureRefs;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
  });

  afterAll(async () => {
    await cleanupFixtures(testSql);
  });

  // ── blacklist ─────────────────────────────────────────────────────────────

  it("isBlacklisted returns false for a user not in the blacklist", async () => {
    const result = await isBlacklisted(FIXTURE_IDS.serverDiscId, FIXTURE_IDS.userDiscId);
    expect(result).toBe(false);
  });

  it("isBlacklisted returns false for a completely unknown server+user pair", async () => {
    const result = await isBlacklisted("_rt_unknown_server", "_rt_unknown_user");
    expect(result).toBe(false);
  });

  // ── blacklist write + re-read ─────────────────────────────────────────────
  // The personalization_blacklist table stores server_id (internal) + user_disc_id.
  // We insert directly via testSql to avoid needing full command-flow wiring.

  it("isBlacklisted returns true after inserting a blacklist entry", async () => {
    await testSql`
      INSERT INTO personalization_blacklist (server_id, user_disc_id)
      VALUES (${refs.serverId}, ${FIXTURE_IDS.userDiscId})
      ON CONFLICT DO NOTHING
    `;

    const result = await isBlacklisted(FIXTURE_IDS.serverDiscId, FIXTURE_IDS.userDiscId);
    expect(result).toBe(true);
  });

  it("isBlacklisted returns false after removing the blacklist entry", async () => {
    await testSql`
      DELETE FROM personalization_blacklist
      WHERE server_id = ${refs.serverId} AND user_disc_id = ${FIXTURE_IDS.userDiscId}
    `;

    const result = await isBlacklisted(FIXTURE_IDS.serverDiscId, FIXTURE_IDS.userDiscId);
    expect(result).toBe(false);
  });
});
