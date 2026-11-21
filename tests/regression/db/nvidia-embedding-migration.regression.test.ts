import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { encryptApiKey } from "@/utils/security/crypto";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("NVIDIA embedding selection migration", () => {
  let refs: FixtureRefs;
  let retiredId: number;
  let replacementId: number;
  let googleId: number;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    const models = await testSql<Array<{ provider: string; codename: string; embedding_model_id: number }>>`
      SELECT provider, codename, embedding_model_id FROM embedding_models
      WHERE (provider = 'nvidia' AND codename IN ('nv-embed-v1', 'nvidia/nemotron-3.5-embed-1b'))
        OR (provider = 'google' AND codename = 'gemini-embedding-2')
    `;
    const retired = models.find((model) => model.provider === "nvidia" && model.codename === "nv-embed-v1");
    const replacement = models.find(
      (model) => model.provider === "nvidia" && model.codename === "nvidia/nemotron-3.5-embed-1b",
    );
    const google = models.find((model) => model.provider === "google");
    if (!retired || !replacement || !google) throw new Error("Expected seeded embedding models");
    retiredId = retired.embedding_model_id;
    replacementId = replacement.embedding_model_id;
    googleId = google.embedding_model_id;
  });

  afterAll(async () => {
    await cleanupFixtures(testSql);
  });

  it("moves active and saved retired selections without changing other providers or capability switches", async () => {
    for (const activeId of [retiredId, googleId]) {
      const enabled = activeId === retiredId ? [] : ["embedding"];
      await testSql`UPDATE server_model_configs SET embedding_model_id = ${activeId} WHERE server_id = ${refs.serverId}`;
      for (const [provider, modelId] of [
        ["nvidia", retiredId],
        ["google", googleId],
      ] as const) {
        const key = await encryptApiKey(`synthetic-${provider}-embedding-key`);
        const capabilities = provider === "nvidia" ? enabled : [];
        await testSql`
          INSERT INTO saved_provider_configs (server_id, provider, embedding_model_id, api_key, key_version)
          VALUES (${refs.serverId}, ${provider}, ${modelId}, ${key.encrypted}, ${key.version})
          ON CONFLICT (server_id, provider) DO UPDATE SET embedding_model_id = EXCLUDED.embedding_model_id
        `;
        await testSql`
          INSERT INTO user_saved_provider_configs (
            user_id, provider, embedding_model_id, enabled_capabilities, assigned_capabilities, api_key, key_version
          )
          VALUES (${refs.userId}, ${provider}, ${modelId}, ${testSql.array(capabilities, "TEXT")}, ARRAY['embedding'], ${key.encrypted}, ${key.version})
          ON CONFLICT (user_id, provider) DO UPDATE SET
            embedding_model_id = EXCLUDED.embedding_model_id,
            enabled_capabilities = EXCLUDED.enabled_capabilities
        `;
      }

      await executeTestSqlFile("src/db/migrations/140_nvidia_embedding_selections.sql");
      await executeTestSqlFile("src/db/migrations/140_nvidia_embedding_selections.sql");
      await executeTestSqlFile("src/db/migrations/140_nvidia_embedding_selections.down.sql");

      const [active] = await testSql`
        SELECT embedding_model_id FROM server_model_configs WHERE server_id = ${refs.serverId}
      `;
      expect(active.embedding_model_id).toBe(activeId === retiredId ? replacementId : googleId);
      const saved = await testSql`
        SELECT provider, embedding_model_id FROM saved_provider_configs
        WHERE server_id = ${refs.serverId} AND provider IN ('nvidia', 'google') ORDER BY provider
      `;
      expect(saved).toEqual([
        { provider: "google", embedding_model_id: googleId },
        { provider: "nvidia", embedding_model_id: replacementId },
      ]);
      const personal = await testSql`
        SELECT provider, embedding_model_id, enabled_capabilities FROM user_saved_provider_configs
        WHERE user_id = ${refs.userId} AND provider IN ('nvidia', 'google') ORDER BY provider
      `;
      expect(personal).toEqual([
        { provider: "google", embedding_model_id: googleId, enabled_capabilities: [] },
        { provider: "nvidia", embedding_model_id: replacementId, enabled_capabilities: enabled },
      ]);
      const [retired] = await testSql`
        SELECT codename, model_family FROM embedding_models WHERE embedding_model_id = ${retiredId}
      `;
      expect(retired).toEqual({ codename: "nv-embed-v1", model_family: "nv-embed-v1" });
    }
  });

  it("leaves selections unchanged when the replacement catalog row is unavailable", async () => {
    await testSql`
      UPDATE server_model_configs SET embedding_model_id = ${retiredId} WHERE server_id = ${refs.serverId}
    `;
    const migration = await Bun.file("src/db/migrations/140_nvidia_embedding_selections.sql").text();
    await expect(
      testSql.begin(async (tx) => {
        await tx`
          UPDATE embedding_models SET codename = '_rt_unavailable_nvidia_embedding'
          WHERE embedding_model_id = ${replacementId}
        `;
        await tx.unsafe(migration);
      }),
    ).rejects.toThrow();
    const [active] = await testSql`
      SELECT embedding_model_id FROM server_model_configs WHERE server_id = ${refs.serverId}
    `;
    expect(active.embedding_model_id).toBe(retiredId);
  });
});
