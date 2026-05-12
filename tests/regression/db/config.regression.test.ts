/**
 * Regression harness — ConfigRepository domain.
 *
 * Covers: loadTomoriState (config portion), updateTomoriConfig.
 * The config row is read as part of TomoriState; updateTomoriConfig is the
 * primary write path.
 *
 * Requires: POSTGRES_DB=tomodb_test (see docs/guides/testing-db-changes.md)
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { loadTomoriState } from "@/utils/db/repositories";
import { updateTomoriConfig } from "@/utils/db/repositories";
import { FIXTURE_IDS, cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("Config — regression", () => {
  let refs: FixtureRefs;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
  });

  afterAll(async () => {
    await cleanupFixtures(testSql);
  });

  it("loadTomoriState config has expected default values", async () => {
    const state = await loadTomoriState(FIXTURE_IDS.serverDiscId);
    expect(state?.config).not.toBeNull();
    // Schema defaults
    expect(state?.config.message_fetch_limit).toBe(80);
    expect(state?.config.humanizer_degree).toBe(1);
    expect(state?.config.tool_use_enabled ?? true).toBe(true);
  });

  it("updateTomoriConfig mutates a config field by server ID", async () => {
    const result = await updateTomoriConfig(refs.serverId, { humanizer_degree: 3 });
    expect(result).not.toBeNull();
    expect(result?.humanizer_degree).toBe(3);
  });

  it("loadTomoriState reflects the config mutation", async () => {
    const state = await loadTomoriState(FIXTURE_IDS.serverDiscId);
    expect(state?.config.humanizer_degree).toBe(3);
  });

  it("updateTomoriConfig returns null for unknown server", async () => {
    const result = await updateTomoriConfig(999_999_999, { humanizer_degree: 1 });
    expect(result).toBeNull();
  });
});
