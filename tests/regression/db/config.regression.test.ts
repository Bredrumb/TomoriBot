/**
 * Regression harness — ConfigRepository domain.
 *
 * Covers: loadTomoriState (config portion), updateTomoriConfig.
 * The config row is read as part of TomoriState; updateTomoriConfig is the
 * primary write path.
 *
 * Requires: a local Postgres connection (see docs/guides/testing-db-changes.md)
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { configRepository, personaRepository } from "@/utils/db/repositories";
import { FIXTURE_IDS, cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

function normalizeJsonb(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

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
    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    expect(state?.config).not.toBeNull();
    // Schema defaults
    expect(state?.config.message_fetch_limit).toBe(80);
    expect(state?.config.humanizer_degree).toBe(1);
    expect(state?.config.tool_use_enabled ?? true).toBe(true);
  });

  it("updateTomoriConfig mutates a config field by server ID", async () => {
    const result = await configRepository.updateChatConfig(refs.serverId, { humanizer_degree: 3 });
    expect(result).toBe(true);
  });

  it("loadTomoriState reflects the config mutation", async () => {
    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    expect(state?.config.humanizer_degree).toBe(3);
  });

  it("updateChannelScopeConfig persists TEXT[] channel ids without array-literal corruption", async () => {
    const result = await configRepository.updateChannelScopeConfig(refs.serverId, {
      rp_channel_ids: ["_rt_rp_1", "_rt_rp_2"],
      private_channel_ids: ["_rt_private_1"],
      crosschannel_blocklist_ids: ["_rt_blocked_1"],
    });
    expect(result).toBe(true);

    const [row] = await testSql<
      Array<{ rp_channel_ids: string[]; private_channel_ids: string[]; crosschannel_blocklist_ids: string[] }>
    >`
      SELECT rp_channel_ids, private_channel_ids, crosschannel_blocklist_ids
      FROM server_channel_scope_configs
      WHERE server_id = ${refs.serverId}
    `;

    expect(row.rp_channel_ids).toEqual(["_rt_rp_1", "_rt_rp_2"]);
    expect(row.private_channel_ids).toEqual(["_rt_private_1"]);
    expect(row.crosschannel_blocklist_ids).toEqual(["_rt_blocked_1"]);
  });

  it("split config updates persist TEXT[] and JSONB array fields with explicit casts", async () => {
    const [chatUpdated, modelUpdated, naiUpdated] = await Promise.all([
      configRepository.updateChatConfig(refs.serverId, {
        llm_stop_strings: ["_rt_stop"],
        fallback_model_refs: [{ type: "llm", id: 1 }],
      }),
      configRepository.updateModelConfig(refs.serverId, {
        llm_disabled_params: ["temperature"],
        fallback_llm_ids: [1, 2],
      }),
      configRepository.updateNovelaiImagegenConfig(refs.serverId, {
        nai_style_tags: ["_rt_style"],
        nai_negative_tags: ["_rt_negative"],
      }),
    ]);

    expect(chatUpdated).toBe(true);
    expect(modelUpdated).toBe(true);
    expect(naiUpdated).toBe(true);

    const [row] = await testSql<
      Array<{
        llm_stop_strings: string[];
        fallback_model_refs: unknown;
        llm_disabled_params: string[];
        fallback_llm_ids: unknown;
        nai_style_tags: string[];
        nai_negative_tags: string[];
      }>
    >`
      SELECT
        scc.llm_stop_strings,
        scc.fallback_model_refs,
        smc.llm_disabled_params,
        smc.fallback_llm_ids,
        snaic.nai_style_tags,
        snaic.nai_negative_tags
      FROM server_chat_configs scc
      JOIN server_model_configs smc USING (server_id)
      JOIN server_novelai_imagegen_configs snaic USING (server_id)
      WHERE scc.server_id = ${refs.serverId}
    `;

    expect(row.llm_stop_strings).toEqual(["_rt_stop"]);
    expect(normalizeJsonb(row.fallback_model_refs)).toEqual([{ type: "llm", id: 1 }]);
    expect(row.llm_disabled_params).toEqual(["temperature"]);
    expect(normalizeJsonb(row.fallback_llm_ids)).toEqual([1, 2]);
    expect(row.nai_style_tags).toEqual(["_rt_style"]);
    expect(row.nai_negative_tags).toEqual(["_rt_negative"]);
  });

  it("updateTomoriConfig returns null for unknown server", async () => {
    const result = await configRepository.updateChatConfig(999_999_999, { humanizer_degree: 1 });
    expect(result).toBe(false);
  });
});
