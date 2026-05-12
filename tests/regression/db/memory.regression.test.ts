/**
 * Regression harness — Memory repositories domain.
 *
 * Covers: ServerMemoryRepository (addServerMemoryByTomori),
 * PersonalMemoryRepository (addPersonalMemoryByTomori, loadPersonalMemoriesForUserLineage),
 * ConditioningMemoryRepository.
 *
 * Requires: POSTGRES_DB=tomodb_test (see docs/guides/testing-db-changes.md)
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { loadPersonalMemoriesForUserLineage } from "@/utils/db/repositories";
import { addPersonalMemoryByTomori, addServerMemoryByTomori, registerUser } from "@/utils/db/repositories";
import { FIXTURE_IDS, cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("Memory — regression", () => {
  let refs: FixtureRefs;
  let altUserId: number;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    // Register an extra user for personal memory tests
    const altUser = await registerUser(FIXTURE_IDS.altUserDiscId, "_rt_alt_user", "en");
    if (!altUser) throw new Error("Failed to register alt test user");
    altUserId = altUser.user_id;
  });

  afterAll(async () => {
    await cleanupFixtures(testSql);
  });

  // ── server memories ───────────────────────────────────────────────────────

  it("addServerMemoryByTomori inserts a server memory", async () => {
    const memory = await addServerMemoryByTomori(
      refs.serverId,
      refs.tomoriId,
      refs.personaLineageId,
      refs.userId,
      "regression test server memory content",
    );
    expect(memory).not.toBeNull();
    expect(memory?.content).toBe("regression test server memory content");
    expect(memory?.server_id).toBe(refs.serverId);
  });

  it("loadTomoriState reflects the new server memory", async () => {
    // loadTomoriState embeds server_memories[] in the returned TomoriState
    const { loadTomoriState } = await import("@/utils/db/repositories");
    const state = await loadTomoriState(FIXTURE_IDS.serverDiscId);
    const hasMemory = state?.server_memories.some((m) => m.includes("regression test server memory content"));
    expect(hasMemory).toBe(true);
  });

  it("addServerMemoryByTomori rejects empty content", async () => {
    const memory = await addServerMemoryByTomori(refs.serverId, refs.tomoriId, refs.personaLineageId, refs.userId, "");
    expect(memory).toBeNull();
  });

  // ── personal memories ────────────────────────────────────────────────────

  it("addPersonalMemoryByTomori inserts a personal memory", async () => {
    const memory = await addPersonalMemoryByTomori(
      altUserId,
      refs.personaLineageId,
      "regression test personal memory content",
    );
    expect(memory).not.toBeNull();
    expect(memory?.content).toBe("regression test personal memory content");
    expect(memory?.user_id).toBe(altUserId);
  });

  it("loadPersonalMemoriesForUserLineage returns the inserted personal memory", async () => {
    const memories = await loadPersonalMemoriesForUserLineage(altUserId, refs.personaLineageId);
    const found = memories.some((m) => m.content === "regression test personal memory content");
    expect(found).toBe(true);
  });

  it("loadPersonalMemoriesForUserLineage returns empty array for unknown user", async () => {
    const memories = await loadPersonalMemoriesForUserLineage(999_999_999, refs.personaLineageId);
    expect(memories).toHaveLength(0);
  });
});
