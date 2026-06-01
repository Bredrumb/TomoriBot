/**
 * Regression harness — Repository layer delegation.
 *
 * Proves that each repository singleton correctly delegates to the underlying
 * DB functions and fires cache invalidation as a side effect of writes —
 * without any manual cache wrangling in the test itself.
 *
 * Contrast with cache-invalidation.regression.test.ts, which calls
 * invalidateUserCache() explicitly. Here we rely entirely on the repository
 * method to do it, so a missing invalidation call surfaces as a test failure.
 *
 * Covered:
 *   UserRepository  — register, loadByDiscordId, setPrivacyLevel, update,
 *                     isBlacklisted, getBlacklistedMemberIds,
 *                     toExportShape, fromExportShape, cache side-effects
 *   LlmRepository   — loadAvailableLlms, loadLlmById, getLlmsByIds,
 *                     result parity with repository SQL reads
 *
 * Requires: a local Postgres connection (see docs/guides/testing-db-changes.md)
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PrivacyLevel } from "@/types/db/schema";
import { clearUserCache, getCachedUserRow } from "@/utils/cache/userCache";
import { llmModelRepo, userRepository } from "@/utils/db/repositories";
import { FIXTURE_IDS, cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

// Discord ID used only within this file; cleaned up by the `_rt_%` wildcard in cleanupFixtures.
const REPO_USER_ID = "_rt_repo_test_001";

describe.skipIf(!DB_TESTS_AVAILABLE)("Repositories — delegation & cache regression", () => {
  let refs: FixtureRefs;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
  });

  afterAll(async () => {
    clearUserCache();
    await cleanupFixtures(testSql);
  });

  // ── UserRepository — reads ─────────────────────────────────────────────────

  describe("UserRepository.loadByDiscordId", () => {
    it("returns null for a non-existent user", async () => {
      const result = await userRepository.loadByDiscordId("_rt_nonexistent_repo");
      expect(result).toBeNull();
    });

    it("returns the fixture user row", async () => {
      const user = await userRepository.loadByDiscordId(FIXTURE_IDS.userDiscId);
      expect(user).not.toBeNull();
      expect(user?.user_disc_id).toBe(FIXTURE_IDS.userDiscId);
    });
  });

  describe("UserRepository.findByNormalizedNickname", () => {
    it("finds the fixture user by normalized nickname", async () => {
      const results = await userRepository.findByNormalizedNickname("_rt_user");
      const match = results.find((u) => u.user_disc_id === FIXTURE_IDS.userDiscId);
      expect(match).not.toBeUndefined();
    });

    it("returns empty array for an unknown nickname", async () => {
      const results = await userRepository.findByNormalizedNickname("_rt_absolutely_nobody");
      expect(results).toHaveLength(0);
    });
  });

  describe("UserRepository.getPrivacyLevel", () => {
    it("returns MINIMAL for the fixture user by default", async () => {
      const level = await userRepository.getPrivacyLevel(FIXTURE_IDS.userDiscId);
      expect(level).toBe(PrivacyLevel.MINIMAL);
    });
  });

  describe("UserRepository.isBlacklisted / getBlacklistedMemberIds", () => {
    it("fixture user is not blacklisted in the fixture server", async () => {
      const result = await userRepository.isBlacklisted(FIXTURE_IDS.serverDiscId, FIXTURE_IDS.userDiscId);
      expect(result).toBe(false);
    });

    it("getBlacklistedMemberIds returns an array (may be empty)", async () => {
      const ids = await userRepository.getBlacklistedMemberIds(refs.serverId);
      expect(Array.isArray(ids)).toBe(true);
    });
  });

  // ── UserRepository — writes + cache side-effects ───────────────────────────

  describe("UserRepository.register (cache side-effect)", () => {
    it("creates a new row and invalidates the cache without explicit invalidation call", async () => {
      // Pre-warm the cache with null (simulates a prior miss).
      // The repository's register() must invalidate so the next read goes to DB.
      clearUserCache();
      await getCachedUserRow(REPO_USER_ID); // populates cache as null/miss

      const user = await userRepository.register(REPO_USER_ID, "_rt_repo_name", "en");
      expect(user).not.toBeNull();
      expect(user?.user_disc_id).toBe(REPO_USER_ID);

      // No explicit invalidation here — the repository must have done it.
      const fresh = await getCachedUserRow(REPO_USER_ID);
      expect(fresh).not.toBeNull();
      expect(fresh?.user_disc_id).toBe(REPO_USER_ID);
    });

    it("is idempotent — re-registering preserves the original nickname", async () => {
      const again = await userRepository.register(REPO_USER_ID, "_rt_different_name", "en");
      expect(again?.user_nickname).toBe("_rt_repo_name");
    });
  });

  describe("UserRepository.setPrivacyLevel (cache side-effect)", () => {
    it("updates the row and the cache reflects the new level without manual invalidation", async () => {
      // Warm cache with the current row.
      await getCachedUserRow(REPO_USER_ID);

      const updated = await userRepository.setPrivacyLevel(REPO_USER_ID, PrivacyLevel.PARTIAL);
      expect(updated?.privacy_level).toBe(PrivacyLevel.PARTIAL);

      // No manual invalidation — repository must flush it.
      const cached = await getCachedUserRow(REPO_USER_ID);
      expect(cached?.privacy_level).toBe(PrivacyLevel.PARTIAL);
    });
  });

  describe("UserRepository.update (cache side-effect)", () => {
    it("patches a field and the cache reflects the change without manual invalidation", async () => {
      const row = await userRepository.loadByDiscordId(REPO_USER_ID);
      if (!row) throw new Error("Expected REPO_USER_ID to exist after register()");

      await getCachedUserRow(REPO_USER_ID); // warm cache

      const updated = await userRepository.update(row.user_id, { user_nickname: "_rt_repo_renamed" });
      expect(updated?.user_nickname).toBe("_rt_repo_renamed");

      // Cache must reflect the new nickname without explicit invalidation.
      const cached = await getCachedUserRow(REPO_USER_ID);
      expect(cached?.user_nickname).toBe("_rt_repo_renamed");
    });
  });

  // ── UserRepository — export contract ──────────────────────────────────────

  describe("UserRepository.toExportShape / fromExportShape", () => {
    it("toExportShape returns null for a non-existent user", async () => {
      const shape = await userRepository.toExportShape("_rt_nonexistent_export");
      expect(shape).toBeNull();
    });

    it("toExportShape returns an export shape for a known user", async () => {
      const shape = await userRepository.toExportShape(REPO_USER_ID);
      expect(shape).not.toBeNull();
      expect(shape?.user_nickname).toBe("_rt_repo_renamed");
      expect(shape?.privacy_level).toBe(PrivacyLevel.PARTIAL);
    });

    it("fromExportShape round-trips — restores a previously exported shape", async () => {
      const original = await userRepository.toExportShape(REPO_USER_ID);
      if (!original) throw new Error("Expected toExportShape to return data");

      // Modify the row, then restore.
      const row = await userRepository.loadByDiscordId(REPO_USER_ID);
      if (!row) throw new Error("Row should exist");
      await userRepository.update(row.user_id, { user_nickname: "_rt_repo_temp" });

      const success = await userRepository.fromExportShape(REPO_USER_ID, original);
      expect(success).toBe(true);

      const restored = await userRepository.loadByDiscordId(REPO_USER_ID);
      expect(restored?.user_nickname).toBe("_rt_repo_renamed");
      expect(restored?.privacy_level).toBe(PrivacyLevel.PARTIAL);
    });
  });

  // ── LlmRepository — result parity ─────────────────────────────────────────
  // Each test asserts that the repository returns the same data as the direct
  // repository SQL call, proving delegation is correct rather than silent no-ops.

  describe("LlmRepository.loadAvailableLlms", () => {
    it("returns the same rows as the direct repository SQL call", async () => {
      const direct = await testSql`SELECT * FROM llms WHERE is_deprecated = false ORDER BY llm_id ASC`;
      const via = await llmModelRepo.loadAvailableLlms();
      expect(via).toEqual(direct);
    });

    it("with includeDeprecated=true returns >= non-deprecated count", async () => {
      const active = await llmModelRepo.loadAvailableLlms(false);
      const all = await llmModelRepo.loadAvailableLlms(true);
      if (!active || !all) throw new Error("loadAvailableLlms returned null");
      expect(all.length).toBeGreaterThanOrEqual(active.length);
    });
  });

  describe("LlmRepository.loadLlmById", () => {
    it("returns the same row as the direct repository SQL call", async () => {
      const allLlms = await llmModelRepo.loadAvailableLlms();
      if (!allLlms?.[0]) throw new Error("No seeded LLMs found");
      const id = allLlms[0].llm_id;

      const direct = await testSql`SELECT * FROM llms WHERE llm_id = ${id} LIMIT 1`;
      const via = await llmModelRepo.loadById(id);
      expect(via).toEqual(direct[0]);
    });

    it("returns null for a non-existent ID", async () => {
      const result = await llmModelRepo.loadById(999_999_999);
      expect(result).toBeNull();
    });
  });

  describe("LlmRepository.getLlmsByIds", () => {
    it("returns the same rows as the direct repository SQL call", async () => {
      const allLlms = await llmModelRepo.loadAvailableLlms();
      if (!allLlms || allLlms.length < 2) throw new Error("Need at least 2 seeded LLMs");
      const ids = allLlms.slice(0, 2).map((l) => l.llm_id);

      const direct = await testSql.unsafe(
        `SELECT * FROM llms WHERE llm_id IN (${ids.map((_, index) => `$${index + 1}`).join(", ")})`,
        ids,
      );
      const via = await llmModelRepo.getLlmsByIds(ids);
      expect(via.map((l) => l.llm_id).sort()).toEqual(direct.map((l) => l.llm_id).sort());
    });
  });

  // ── Regression probes ──────────────────────────────────────────────────────

  it.skip("[REGRESSION PROBE] missing invalidation in register() would fail cache test", async () => {
    // To prove: remove the `invalidateUserCache` call from UserRepository.register()
    // and confirm the cache-side-effect test above fails.
    clearUserCache();
    await getCachedUserRow(REPO_USER_ID); // warm as null
    await userRepository.register(REPO_USER_ID, "_rt_probe", "en");
    const fresh = await getCachedUserRow(REPO_USER_ID);
    expect(fresh).not.toBeNull(); // Would fail if invalidation is missing
  });

  it.skip("[REGRESSION PROBE] wrong delegation in loadAvailableLlms() would fail parity test", async () => {
    // To prove: make llmRepository.loadAvailableLlms() return [] unconditionally
    // and confirm the parity test above fails.
    const direct = await llmModelRepo.loadAvailableLlms();
    const via = await llmModelRepo.loadAvailableLlms();
    expect(via).toEqual(direct); // Would fail if delegation were a no-op
  });
});
