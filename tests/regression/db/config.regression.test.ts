/**
 * Regression harness: ConfigRepository domain.
 *
 * Covers: loadTomoriState (config portion), updateTomoriConfig.
 * The config row is read as part of TomoriState; updateTomoriConfig is the
 * primary write path.
 *
 * Requires: a local Postgres connection (see docs/en/contributing/testing/db-changes.md)
 */
import { humanizerSettingsFromDegree, pickHumanizerSettings } from "@/constants/humanizer";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  configRepository,
  personaRepository,
  exportRepository,
  serverRepository,
  importRepository,
} from "@/utils/db/repositories";
import { updateMemberPermissions } from "@/utils/moderation/moderationOperations";
import { SERVER_MEMBER_PERMISSION_DEFINITIONS } from "@/utils/discord/memberPermissionsConfigMapping";
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
    expect(state?.config.message_fetch_limit).toBe(80);
    expect(state && pickHumanizerSettings(state.config)).toEqual(humanizerSettingsFromDegree(1));
    expect(state?.config.server_memteaching_enabled).toBe(false);
    expect(state?.config.persona_export_enabled).toBe(false);
    expect(state?.config.tool_use_enabled ?? true).toBe(true);
  });

  it("retires legacy persona teaching columns without changing the remaining member permissions", async () => {
    const base = "../../../src/db/migrations/141_retire_persona_teaching_permissions";
    const up = await Bun.file(new URL(`${base}.sql`, import.meta.url)).text();
    const down = await Bun.file(new URL(`${base}.down.sql`, import.meta.url)).text();
    await testSql.begin(async (tx) => {
      await tx.unsafe(down);
      await tx.unsafe(down);
      await tx`
        UPDATE server_member_permissions_configs
        SET attribute_memteaching_enabled = true, sampledialogue_memteaching_enabled = true
        WHERE server_id = ${refs.serverId}
      `;
      const [before] = await tx`SELECT server_memteaching_enabled, prompt_snapshot_enabled, persona_export_enabled
        FROM server_member_permissions_configs WHERE server_id = ${refs.serverId}`;
      await tx.unsafe(up);
      await tx.unsafe(up);
      const retired = await tx`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'server_member_permissions_configs'
          AND column_name IN ('attribute_memteaching_enabled', 'sampledialogue_memteaching_enabled')
      `;
      expect(retired).toHaveLength(0);
      const [after] = await tx`SELECT server_memteaching_enabled, prompt_snapshot_enabled, persona_export_enabled
        FROM server_member_permissions_configs WHERE server_id = ${refs.serverId}`;
      expect(after).toEqual(before);
    });
  });

  it("persists the persona export permission through moderation, both persona readers, and configuration backups", async () => {
    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    if (!state) throw new Error("Expected fixture persona");
    const selectedValues = SERVER_MEMBER_PERMISSION_DEFINITIONS.filter((def) => def.getState(state.config)).map(
      (def) => def.value,
    );
    try {
      expect(
        (
          await updateMemberPermissions({
            guildId: FIXTURE_IDS.serverDiscId,
            serverId: refs.serverId,
            currentState: state.config,
            selectedValues: [...selectedValues, "personaexport"],
          })
        ).status,
      ).toBe("success");
      expect((await personaRepository.loadState(FIXTURE_IDS.serverDiscId))?.config.persona_export_enabled).toBe(true);
      expect(
        (await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId))[0]?.config.persona_export_enabled,
      ).toBe(true);
      const backup = await serverRepository.toExportShape(FIXTURE_IDS.serverDiscId);
      expect(backup?.member_permissions?.persona_export_enabled).toBe(true);
      const portable = await exportRepository.exportWorkspaceConfig(FIXTURE_IDS.serverDiscId);
      expect(portable.success).toBe(true);
      if (!portable.success || portable.data?.type !== "workspace_config")
        throw new Error("Expected configuration export");
      expect(portable.data.data.memory?.persona_export_enabled).toBe(true);
      expect(
        await configRepository.updateMemberPermissionsConfig(refs.serverId, { persona_export_enabled: false }),
      ).toBe(true);
      expect((await importRepository.importWorkspaceConfig(FIXTURE_IDS.serverDiscId, portable.data)).success).toBe(
        true,
      );
      expect((await personaRepository.loadState(FIXTURE_IDS.serverDiscId))?.config.persona_export_enabled).toBe(true);
      await configRepository.updateMemberPermissionsConfig(refs.serverId, { persona_export_enabled: false });
      if (!backup) throw new Error("Expected server backup");
      expect(await serverRepository.fromExportShape(FIXTURE_IDS.serverDiscId, backup)).toBe(true);
      expect((await personaRepository.loadState(FIXTURE_IDS.serverDiscId))?.config.persona_export_enabled).toBe(true);
    } finally {
      await configRepository.updateMemberPermissionsConfig(refs.serverId, { persona_export_enabled: false });
    }
  });

  it("preserves independent reply reaction settings through the workspace export and import", async () => {
    const off = { fast_regeneration_retry_enabled: false, fast_regeneration_continue_enabled: false };
    const retryOnly = { ...off, fast_regeneration_retry_enabled: true };
    const continueOnly = { ...off, fast_regeneration_continue_enabled: true };
    const { serverDiscId } = FIXTURE_IDS;
    expect((await personaRepository.loadState(serverDiscId))?.config).toMatchObject(off);
    try {
      expect(await configRepository.updateTriggerBehaviorConfig(refs.serverId, retryOnly)).toBe(true);
      expect((await personaRepository.loadState(serverDiscId))?.config).toMatchObject(retryOnly);
      expect((await personaRepository.loadAllForServer(serverDiscId))[0]?.config).toMatchObject(retryOnly);
      const portable = await exportRepository.exportWorkspaceConfig(serverDiscId);
      if (!portable.success || portable.data?.type !== "workspace_config") throw new Error("Expected workspace export");
      expect(portable.data.data.triggers).toMatchObject(retryOnly);
      expect(await configRepository.updateTriggerBehaviorConfig(refs.serverId, continueOnly)).toBe(true);
      expect((await importRepository.importWorkspaceConfig(serverDiscId, portable.data)).success).toBe(true);
      expect((await personaRepository.loadState(serverDiscId))?.config).toMatchObject(retryOnly);
    } finally {
      await configRepository.updateTriggerBehaviorConfig(refs.serverId, off);
    }
  });

  it("defaults new server member memory management rows to opt-in", async () => {
    const [column] = await testSql<Array<{ column_default: string | null }>>`
      SELECT column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'server_member_permissions_configs'
        AND column_name = 'server_memteaching_enabled'
    `;

    expect(column?.column_default?.toLowerCase()).toContain("false");
  });

  it("updateTomoriConfig mutates a config field by server ID", async () => {
    const result = await configRepository.updateChatConfig(refs.serverId, humanizerSettingsFromDegree(3));
    expect(result).toBe(true);
  });

  it("loadTomoriState reflects the config mutation", async () => {
    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    expect(state && pickHumanizerSettings(state.config)).toEqual(humanizerSettingsFromDegree(3));
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
        image_default_positive_tags: ["_rt_style"],
        image_default_negative_tags: ["_rt_negative"],
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
        image_default_positive_tags: string[];
        image_default_negative_tags: string[];
      }>
    >`
      SELECT
        scc.llm_stop_strings,
        scc.fallback_model_refs,
        smc.llm_disabled_params,
        smc.fallback_llm_ids,
        snaic.image_default_positive_tags,
        snaic.image_default_negative_tags
      FROM server_chat_configs scc
      JOIN server_model_configs smc USING (server_id)
      JOIN server_novelai_imagegen_configs snaic USING (server_id)
      WHERE scc.server_id = ${refs.serverId}
    `;

    expect(row.llm_stop_strings).toEqual(["_rt_stop"]);
    expect(normalizeJsonb(row.fallback_model_refs)).toEqual([{ type: "llm", id: 1 }]);
    expect(row.llm_disabled_params).toEqual(["temperature"]);
    expect(normalizeJsonb(row.fallback_llm_ids)).toEqual([1, 2]);
    expect(row.image_default_positive_tags).toEqual(["_rt_style"]);
    expect(row.image_default_negative_tags).toEqual(["_rt_negative"]);
  });

  it("updateCapabilitiesAndMemberPermissionsConfig writes each column to its owning split table", async () => {
    const result = await configRepository.updateCapabilitiesAndMemberPermissionsConfig(refs.serverId, {
      memberPermissions: {
        personal_memories_enabled: false,
        self_teaching_enabled: false,
      },
      capabilities: {
        imagegen_enabled: false,
      },
    });
    expect(result).toBe(true);

    const [row] = await testSql<
      Array<{
        personal_memories_enabled: boolean;
        self_teaching_enabled: boolean;
        imagegen_enabled: boolean;
      }>
    >`
      SELECT
        smpc.personal_memories_enabled,
        smpc.self_teaching_enabled,
        scc.imagegen_enabled
      FROM server_member_permissions_configs smpc
      JOIN server_capabilities_configs scc USING (server_id)
      WHERE smpc.server_id = ${refs.serverId}
    `;

    expect(row.personal_memories_enabled).toBe(false);
    expect(row.self_teaching_enabled).toBe(false);
    expect(row.imagegen_enabled).toBe(false);
  });

  it("updateTomoriConfig returns null for unknown server", async () => {
    const result = await configRepository.updateChatConfig(999_999_999, humanizerSettingsFromDegree(1));
    expect(result).toBe(false);
  });
});
