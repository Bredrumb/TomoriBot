/**
 * Regression harness: Memory repositories domain.
 *
 * Covers: ServerMemoryRepository (addServerMemoryByTomori),
 * PersonalMemoryRepository (addPersonalMemoryByTomori, loadPersonalMemoriesForUserLineage),
 * ConditioningMemoryRepository.
 *
 * Requires: a local Postgres connection (see docs/guides/testing-db-changes.md)
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  personalMemoryRepository,
  personaRepository,
  serverMemoryRepository,
  userRepository,
} from "@/utils/db/repositories";
import { FIXTURE_IDS, cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("Memory — regression", () => {
  let refs: FixtureRefs;
  let altUserId: number;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    const altUser = await userRepository.register(FIXTURE_IDS.altUserDiscId, "_rt_alt_user", "en");
    if (!altUser) throw new Error("Failed to register alt test user");
    altUserId = altUser.user_id;
  });

  afterAll(async () => {
    await cleanupFixtures(testSql);
  });

  it("addServerMemoryByTomori inserts a server memory", async () => {
    const memory = await serverMemoryRepository.add(
      refs.serverId,
      refs.personaId,
      refs.personaLineageId,
      refs.userId,
      "regression test server memory content",
    );
    expect(memory).not.toBeNull();
    expect(memory?.content).toBe("regression test server memory content");
    expect(memory?.server_id).toBe(refs.serverId);
  });

  it("loadTomoriState reflects the new server memory", async () => {
    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    const hasMemory = state?.server_memories.some((m) => m.includes("regression test server memory content"));
    expect(hasMemory).toBe(true);
  });

  it("addServerMemoryByTomori rejects empty content", async () => {
    const memory = await serverMemoryRepository.add(
      refs.serverId,
      refs.personaId,
      refs.personaLineageId,
      refs.userId,
      "",
    );
    expect(memory).toBeNull();
  });

  it("addPersonalMemoryByTomori inserts a personal memory", async () => {
    const memory = await personalMemoryRepository.add(
      altUserId,
      refs.personaLineageId,
      "regression test personal memory content",
    );
    expect(memory).not.toBeNull();
    expect(memory?.content).toBe("regression test personal memory content");
    expect(memory?.user_id).toBe(altUserId);
  });

  it("loadPersonalMemoriesForUserLineage returns the inserted personal memory", async () => {
    const memories = await personalMemoryRepository.loadForUserLineage(altUserId, refs.personaLineageId);
    const found = memories.some((m) => m.content === "regression test personal memory content");
    expect(found).toBe(true);
  });

  it("loadPersonalMemoriesForUserLineage returns empty array for unknown user", async () => {
    const memories = await personalMemoryRepository.loadForUserLineage(999_999_999, refs.personaLineageId);
    expect(memories).toHaveLength(0);
  });
});
