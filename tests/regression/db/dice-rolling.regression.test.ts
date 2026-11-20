import { afterAll, beforeAll, expect, it } from "bun:test";
import { runMigrations } from "@/db/migrationRunner";
import { initializeDatabase } from "@/utils/db/initializeDatabase";
import { configRepository, exportRepository, importRepository, personaRepository } from "@/utils/db/repositories";
import { cleanupFixtures, FIXTURE_IDS, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

let refs: FixtureRefs;
beforeAll(async () => {
  if (!DB_TESTS_AVAILABLE) return;
  await setupTestDb();
  refs = await insertFixtures(testSql);
  await testSql`INSERT INTO personas (server_id, persona_nickname, is_alter) VALUES (${refs.serverId}, 'Juno', true)`;
});
afterAll(async () => {
  if (DB_TESTS_AVAILABLE) await cleanupFixtures(testSql);
});

it.skipIf(!DB_TESTS_AVAILABLE)(
  "defaults dice tools on and preserves settings across persona loads and config export/import",
  async () => {
    expect((await personaRepository.loadState(FIXTURE_IDS.serverDiscId))?.config.dice_rolling_enabled).toBe(true);
    expect(
      await configRepository.updateCapabilitiesAndMemberPermissionsConfig(refs.serverId, {
        capabilities: { dice_rolling_enabled: false },
      }),
    ).toBe(true);
    expect((await personaRepository.loadState(FIXTURE_IDS.serverDiscId))?.config.dice_rolling_enabled).toBe(false);
    const personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
    expect(personas.length).toBeGreaterThan(1);
    expect(personas.every((persona) => !persona.config.dice_rolling_enabled)).toBe(true);
    const exported = await exportRepository.exportWorkspaceConfig(FIXTURE_IDS.serverDiscId);
    expect(exported.success).toBe(true);
    if (!exported.data || exported.data.type !== "workspace_config") throw new Error("Missing config export");
    expect(exported.data.data.capabilities?.dice_rolling_enabled).toBe(false);
    await configRepository.updateCapabilitiesConfig(refs.serverId, { dice_rolling_enabled: true });
    expect(
      (await importRepository.importWorkspaceConfig(FIXTURE_IDS.serverDiscId, exported.data, ["capabilities"])).success,
    ).toBe(true);
    expect((await personaRepository.loadState(FIXTURE_IDS.serverDiscId))?.config.dice_rolling_enabled).toBe(false);
  },
);

it.skipIf(!DB_TESTS_AVAILABLE)(
  "enables existing dice settings once and preserves later choices across startup",
  async () => {
    await configRepository.updateCapabilitiesConfig(refs.serverId, { dice_rolling_enabled: false });
    await testSql`DELETE FROM schema_migrations WHERE name = '122_enable_dice_rolling_by_default'`;

    await initializeDatabase({ client: testSql, includeRag: false });
    expect((await personaRepository.loadState(FIXTURE_IDS.serverDiscId))?.config.dice_rolling_enabled).toBe(true);

    await configRepository.updateCapabilitiesConfig(refs.serverId, { dice_rolling_enabled: false });
    await initializeDatabase({ client: testSql, includeRag: false });
    await runMigrations(testSql);
    expect((await personaRepository.loadState(FIXTURE_IDS.serverDiscId))?.config.dice_rolling_enabled).toBe(false);
  },
);
