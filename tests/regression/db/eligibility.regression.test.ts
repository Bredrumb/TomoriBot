import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { personalMemoryRepository, serverMemoryRepository, userRepository } from "@/utils/db/repositories";
import { FIXTURE_IDS, cleanupFixtures, insertFixtures } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

interface PersonaRef {
  persona_id: number;
  persona_lineage_id: number;
}

async function insertPersona(serverId: number, nickname: string): Promise<PersonaRef> {
  // Use is_alter = true because the base fixture already owns the server's single main persona.
  const [row] = await testSql<PersonaRef[]>`
    INSERT INTO personas (server_id, persona_nickname, is_alter)
    VALUES (${serverId}, ${nickname}, true)
    RETURNING persona_id, persona_lineage_id
  `;
  return { persona_id: row.persona_id, persona_lineage_id: Number(row.persona_lineage_id) };
}

// The RAG `documents` table exists only when pgvector is installed, so document tests check this to skip without
// pgvector while base memory tests still run.
async function tableExists(name: string): Promise<boolean> {
  const [row] = await testSql<Array<{ exists: boolean }>>`
    SELECT to_regclass(${`public.${name}`}) IS NOT NULL AS exists
  `;
  return row?.exists === true;
}

describe.skipIf(!DB_TESTS_AVAILABLE)("batched per-persona queries agree with their loaders", () => {
  let serverId: number;
  let altUserId: number;
  let hasDocuments = false;

  let pOwn: PersonaRef;
  let pEmpty: PersonaRef;
  let pShareA: PersonaRef;

  beforeAll(async () => {
    await setupTestDb();
    const refs = await insertFixtures(testSql);
    serverId = refs.serverId;

    const altUser = await userRepository.register(FIXTURE_IDS.altUserDiscId, "_rt_alt_user", "en");
    if (!altUser || altUser.user_id === undefined) throw new Error("Failed to register alt test user");
    altUserId = altUser.user_id;

    hasDocuments = await tableExists("documents");

    pOwn = await insertPersona(serverId, "_rt_p_own");
    pEmpty = await insertPersona(serverId, "_rt_p_empty");
    pShareA = await insertPersona(serverId, "_rt_p_share_a");

    if (hasDocuments) {
      await testSql`
        INSERT INTO documents (server_id, persona_id, document_name, text_content)
        VALUES (${serverId}, ${pOwn.persona_id}, '_rt_own_upload', 'x')
      `;
      await testSql`
        INSERT INTO documents (server_id, persona_id, document_name, text_content, source_type)
        VALUES (${serverId}, ${pOwn.persona_id}, '_rt_own_history', 'x', 'history')
      `;
      await testSql`
        INSERT INTO documents (server_id, persona_id, document_name, text_content)
        VALUES (${serverId}, ${pShareA.persona_id}, '_rt_share_upload', 'x')
      `;
    }

    await testSql`
      INSERT INTO personal_memories (user_id, persona_lineage_id, content, tags)
      VALUES (${altUserId}, ${pOwn.persona_lineage_id}, '_rt_pm_own', ARRAY[]::TEXT[])
    `;
    await testSql`
      INSERT INTO personal_memories (user_id, persona_lineage_id, content, tags)
      VALUES (${altUserId}, 0, '_rt_pm_global', ARRAY[]::TEXT[])
    `;
  });

  afterAll(async () => {
    await testSql`DELETE FROM personal_memories WHERE user_id = ${altUserId}`;
    await cleanupFixtures(testSql);
  });

  it("personaIdsWithHistoryDocuments agrees with loadHistoryDocuments and excludes upload-only personas", async () => {
    if (!hasDocuments) return;
    const batch = await serverMemoryRepository.personaIdsWithHistoryDocuments(serverId);
    for (const persona of [pOwn, pEmpty, pShareA]) {
      const loaderNonEmpty =
        (await serverMemoryRepository.loadHistoryDocuments(serverId, persona.persona_id)).length > 0;
      expect(batch.has(persona.persona_id)).toBe(loaderNonEmpty);
    }
    expect([...batch]).toEqual([pOwn.persona_id]);
    expect(batch.has(pShareA.persona_id)).toBe(false);
  });

  it("memoryCountsByLineage agrees with loadForUserLineage and omits empty lineages", async () => {
    const counts = await personalMemoryRepository.memoryCountsByLineage(altUserId);
    for (const lineage of [pOwn.persona_lineage_id, pShareA.persona_lineage_id, pEmpty.persona_lineage_id]) {
      const loaded = await personalMemoryRepository.loadForUserLineage(altUserId, lineage, false);
      // Absent rather than zero: the selector has to read a missing entry as none.
      expect(counts.get(lineage) ?? 0).toBe(loaded.length);
    }
    expect(counts.has(0)).toBe(false);
    expect(counts.get(pOwn.persona_lineage_id)).toBeGreaterThan(0);
    expect(counts.has(pEmpty.persona_lineage_id)).toBe(false);
  });
});
