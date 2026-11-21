import { afterAll, beforeAll, expect, it } from "bun:test";
import { resetDatabaseConnection } from "@/utils/db/client";
import { conditioningMemoryRepository } from "@/utils/db/repositories/ConditioningMemoryRepository";
import { configRepository, personaRepository, exportRepository, importRepository } from "@/utils/db/repositories";
import { buildConditioningContextItem } from "@/utils/text/context/templates";
import type { Client } from "discord.js";
import { cleanupFixtures, insertFixtures, FIXTURE_IDS, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

let refs: FixtureRefs;
let actorId: number;
beforeAll(async () => {
  if (!DB_TESTS_AVAILABLE) return;
  await setupTestDb();
  refs = await insertFixtures(testSql);
  const [actor] = await testSql`
    INSERT INTO personas (server_id, persona_nickname, is_alter)
    VALUES (${refs.serverId}, 'Juno', true) RETURNING persona_id
  `;
  actorId = actor.persona_id;
});
afterAll(async () => {
  if (DB_TESTS_AVAILABLE) await cleanupFixtures(testSql);
});

it.skipIf(!DB_TESTS_AVAILABLE)(
  "preserves human entries while upserting persona actors and rendering them in target context",
  async () => {
    const params = {
      serverId: refs.serverId,
      personaLineageId: refs.personaLineageId,
      conditioningType: "punish" as const,
      actionKey: "bonk" as const,
      reason: "stealing snacks",
    };
    expect(await conditioningMemoryRepository.recordEvent({ ...params, userId: refs.userId })).not.toBeNull();
    for (let i = 0; i < 2; i++)
      expect(await conditioningMemoryRepository.recordEvent({ ...params, actorPersonaId: actorId })).not.toBeNull();
    const groups = await conditioningMemoryRepository.loadGroupsForPersona(refs.serverId, refs.personaLineageId);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalCount).toBe(3);
    expect(groups[0].userDiscIds).toContain(FIXTURE_IDS.userDiscId);
    expect(groups[0].personaActors).toEqual([{ personaId: actorId, name: "Juno" }]);
    const context = await buildConditioningContextItem({
      client: {} as Client,
      guildId: FIXTURE_IDS.serverDiscId,
      serverId: refs.serverId,
      personaLineageId: refs.personaLineageId,
      botName: "Mirri",
      personalMemoriesEnabled: true,
      rewardEnabled: true,
      punishEnabled: true,
      convertMentions: async (text) => text,
    });
    expect(JSON.stringify(context)).toContain("Juno");
    expect(JSON.stringify(context)).toContain(params.reason);
    await expect(executeTestSqlFile("src/db/migrations/120_conditioning_interactions.down.sql")).rejects.toThrow();
    expect(
      await conditioningMemoryRepository.deleteGroupsForPersona(refs.serverId, refs.personaLineageId, groups),
    ).toBe(2);
  },
);

it.skipIf(!DB_TESTS_AVAILABLE)(
  "defaults on, persists the opt-out through both persona loaders, and upgrades an existing user-only row",
  async () => {
    const main = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    expect(main?.config.conditioning_interactions_enabled).toBe(true);
    expect(
      await configRepository.updateCapabilitiesConfig(refs.serverId, { conditioning_interactions_enabled: false }),
    ).toBe(true);
    expect(
      (await personaRepository.loadState(FIXTURE_IDS.serverDiscId))?.config.conditioning_interactions_enabled,
    ).toBe(false);
    expect(
      (await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId)).every(
        (persona) => !persona.config.conditioning_interactions_enabled,
      ),
    ).toBe(true);
    const exported = await exportRepository.exportWorkspaceConfig(FIXTURE_IDS.serverDiscId);
    expect(exported.success).toBe(true);
    if (!exported.data || exported.data.type !== "workspace_config") throw new Error("Missing workspace config export");
    expect(exported.data.data.capabilities?.conditioning_interactions_enabled).toBe(false);
    await configRepository.updateCapabilitiesConfig(refs.serverId, { conditioning_interactions_enabled: true });
    expect(
      (await importRepository.importWorkspaceConfig(FIXTURE_IDS.serverDiscId, exported.data, ["capabilities"])).success,
    ).toBe(true);
    expect(
      (await personaRepository.loadState(FIXTURE_IDS.serverDiscId))?.config.conditioning_interactions_enabled,
    ).toBe(false);
    await executeTestSqlFile("src/db/migrations/120_conditioning_interactions.down.sql");
    await testSql`
    INSERT INTO conditioning_history (server_id, persona_lineage_id, conditioning_type, action_key, reason_text, reason_normalized, user_id)
    VALUES (${refs.serverId}, ${refs.personaLineageId}, 'reward', 'hug', 'sharing', 'sharing', ${refs.userId})
  `;
    await executeTestSqlFile("src/db/migrations/120_conditioning_interactions.sql");
    // Clear prepared queries because replaying the migration changes the table shape.
    resetDatabaseConnection();
    const [upgraded] = await testSql`
      SELECT conditioning_interactions_enabled FROM server_capabilities_configs WHERE server_id = ${refs.serverId}
    `;
    expect(upgraded.conditioning_interactions_enabled).toBe(true);
    await configRepository.updateCapabilitiesConfig(refs.serverId, { conditioning_interactions_enabled: false });
    await executeTestSqlFile("src/db/migrations/120_conditioning_interactions.sql");
    expect(
      (await personaRepository.loadState(FIXTURE_IDS.serverDiscId))?.config.conditioning_interactions_enabled,
    ).toBe(false);
    const groups = await conditioningMemoryRepository.loadGroupsForPersona(refs.serverId, refs.personaLineageId);
    expect(groups.some((group) => group.userDiscIds.includes(FIXTURE_IDS.userDiscId))).toBe(true);
    expect(
      await conditioningMemoryRepository.recordEvent({
        serverId: refs.serverId,
        personaLineageId: refs.personaLineageId,
        conditioningType: "reward",
        actionKey: "hug",
        actorPersonaId: actorId,
        reason: "sharing",
      }),
    ).not.toBeNull();
  },
);
