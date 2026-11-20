import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PrivacyLevel } from "@/types/db/schema";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { clearUserCache, getCachedUserRow, invalidateUserCache } from "@/utils/cache/userCache";
import { configRepository, personaRepository, userRepository } from "@/utils/db/repositories";
import { FIXTURE_IDS, cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("Cache invalidation — regression", () => {
  let refs: FixtureRefs;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
  });

  afterAll(async () => {
    clearUserCache();
    invalidateTomoriStateCache(FIXTURE_IDS.serverDiscId);
    await cleanupFixtures(testSql);
  });

  it("getCachedUserRow populates the cache on first access", async () => {
    clearUserCache();
    const user = await getCachedUserRow(FIXTURE_IDS.userDiscId);
    expect(user).not.toBeNull();
    expect(user?.user_disc_id).toBe(FIXTURE_IDS.userDiscId);
  });

  it("write → invalidate → re-read returns updated data (not stale cache)", async () => {
    const original = await getCachedUserRow(FIXTURE_IDS.userDiscId);
    const originalPrivacy = original?.privacy_level ?? PrivacyLevel.MINIMAL;

    const newLevel = originalPrivacy === PrivacyLevel.MINIMAL ? PrivacyLevel.PARTIAL : PrivacyLevel.MINIMAL;
    await userRepository.setPrivacyLevel(FIXTURE_IDS.userDiscId, newLevel);

    const fresh = await getCachedUserRow(FIXTURE_IDS.userDiscId);
    expect(fresh?.privacy_level).toBe(newLevel);
  });

  it("stale cache is detected: getCachedUserRow reads DB value, not pre-invalidation value", async () => {
    await testSql`
      UPDATE user_personalization_configs upc
      SET user_nickname = '_rt_cache_test_name'
      FROM users u
      WHERE upc.user_id = u.user_id
        AND u.user_disc_id = ${FIXTURE_IDS.userDiscId}
    `;

    invalidateUserCache(FIXTURE_IDS.userDiscId);
    const fresh = await getCachedUserRow(FIXTURE_IDS.userDiscId);
    expect(fresh?.user_nickname).toBe("_rt_cache_test_name");
  });

  it("invalidateTomoriStateCache causes the next getCachedAllPersonas to hit the DB", async () => {
    const { getCachedAllPersonas } = await import("@/utils/cache/tomoriStateCache");
    await getCachedAllPersonas(FIXTURE_IDS.serverDiscId);

    await personaRepository.update(refs.personaId, { persona_nickname: "_rt_cache_renamed" }, FIXTURE_IDS.serverDiscId);

    const personas = await getCachedAllPersonas(FIXTURE_IDS.serverDiscId);
    const main = personas.find((p) => p.persona_id === refs.personaId);
    expect(main?.persona_nickname).toBe("_rt_cache_renamed");
  });

  it("config write → cache invalidation → fresh read reflects new config value", async () => {
    const { getCachedMainPersona } = await import("@/utils/cache/tomoriStateCache");

    await getCachedMainPersona(FIXTURE_IDS.serverDiscId);

    await configRepository.updateChatConfig(refs.serverId, { message_fetch_limit: 42 });
    // updateChatConfig leaves cache invalidation to command paths, so flush tomoriStateCache explicitly.
    invalidateTomoriStateCache(FIXTURE_IDS.serverDiscId);

    const fresh = await getCachedMainPersona(FIXTURE_IDS.serverDiscId);
    expect(fresh?.config.message_fetch_limit).toBe(42);
  });
});
