import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { llmProviderRepo } from "@/utils/db/repositories";
import { encryptApiKey } from "@/utils/security/crypto";
import { addRotationKey } from "@/utils/security/keyRotation";
import {
  buildSavedProviderConfigFromExistingOrDefaults,
  buildUserSavedProviderConfigFromExistingOrDefaults,
} from "@/utils/provider/savedProviderConfig";
import {
  clearNovelaiSubscriptionCache,
  getCachedNovelAISubscription,
  refreshNovelAISubscription,
} from "@/utils/cache/novelaiSubscriptionCache";
import { createPersona } from "../../helpers/fixtures";
import { stubGlobalFetch } from "../../helpers/fetchStub";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("NovelAI subscription invalidation after credential writes", () => {
  let refs: FixtureRefs;
  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
  });
  afterEach(() => clearNovelaiSubscriptionCache());
  afterAll(async () => cleanupFixtures(testSql));

  async function warm(...keys: string[]) {
    const fetch = stubGlobalFetch(() => Response.json({ tier: 1, active: true }));
    try {
      for (const key of keys) await refreshNovelAISubscription(key);
    } finally {
      fetch.mockRestore();
    }
  }

  it("invalidates old and new keys after server/personal replacement and preserves entries on failed writes", async () => {
    for (const scope of ["server", "personal"] as const) {
      const oldKey = `old-${scope}-synthetic-key`;
      const newKey = `new-${scope}-synthetic-key`;
      const oldEncryption = await encryptApiKey(oldKey);
      const newEncryption = await encryptApiKey(newKey);
      const baseConfig = createPersona().config;
      const options = {
        provider: "novelai",
        apiKey: oldEncryption.encrypted,
        keyVersion: oldEncryption.version,
        baseConfig,
      };
      let write: (apiKey: Buffer, llmId?: number | null) => Promise<boolean>;
      if (scope === "server") {
        const original = await buildSavedProviderConfigFromExistingOrDefaults({ serverId: refs.serverId, ...options });
        write = (api_key, llm_id = original.llm_id) =>
          llmProviderRepo.upsertSavedProviderConfig(refs.serverId, { ...original, api_key, llm_id });
      } else {
        const original = await buildUserSavedProviderConfigFromExistingOrDefaults({ userId: refs.userId, ...options });
        write = (api_key, llm_id = original.llm_id) =>
          llmProviderRepo.upsertUserSavedProviderConfig(refs.userId, { ...original, api_key, llm_id });
      }
      await warm(oldKey, "unrelated-key");
      expect(await write(oldEncryption.encrypted)).toBe(true);
      expect(getCachedNovelAISubscription(oldKey)).toBeUndefined();
      expect(getCachedNovelAISubscription("unrelated-key")).toEqual({ tier: 1, active: true });
      await warm(oldKey, newKey);
      expect(await write(newEncryption.encrypted, -1)).toBe(false);
      expect(getCachedNovelAISubscription(oldKey)).toEqual({ tier: 1, active: true });
      expect(getCachedNovelAISubscription(newKey)).toEqual({ tier: 1, active: true });
      expect(await write(newEncryption.encrypted)).toBe(true);
      expect(getCachedNovelAISubscription(oldKey)).toBeUndefined();
      expect(getCachedNovelAISubscription(newKey)).toBeUndefined();
      expect(getCachedNovelAISubscription("unrelated-key")).toEqual({ tier: 1, active: true });
      await warm(newKey);
      expect(await write(newEncryption.encrypted)).toBe(true);
      expect(getCachedNovelAISubscription(newKey)).toEqual({ tier: 1, active: true });
    }
  });

  it("invalidates a newly added rotation key after its write succeeds", async () => {
    const key = "rotation-synthetic-key";
    await warm(key);
    expect(await addRotationKey(-1, "novelai", key)).toBe(false);
    expect(getCachedNovelAISubscription(key)).toEqual({ tier: 1, active: true });
    expect(await addRotationKey(refs.serverId, "novelai", key)).toBe(true);
    expect(getCachedNovelAISubscription(key)).toBeUndefined();
  });
});
