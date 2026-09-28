/**
 * Regression harness: batched per-persona queries against the loaders they summarize.
 *
 * The memories panel marks personas with history documents and counts personal memories per
 * lineage from one batched query each. A batched query that drifts from its loader shows a
 * marker or count the opened page contradicts, so each is compared with its loader over real
 * Postgres rather than mocked SQL.
 *
 * Requires: a local Postgres connection (see docs/en/contributing/testing/db-changes.md).
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { personalMemoryRepository, serverMemoryRepository, userRepository } from "@/utils/db/repositories";
import { FIXTURE_IDS, cleanupFixtures, insertFixtures } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

interface PersonaRef {
  persona_id: number;
  persona_lineage_id: number;
}

async function insertPersona(serverId: number, nickname: string): Promise<PersonaRef> {
  // is_alter = true: the base fixture already owns the single main persona per
  // server (personas_one_main_per_server), and these keys never depend on the
  // alter/main distinction.
  const [row] = await testSql<PersonaRef[]>`
    INSERT INTO personas (server_id, persona_nickname, is_alter)
    VALUES (${serverId}, ${nickname}, true)
    RETURNING persona_id, persona_lineage_id
  `;
  return { persona_id: row.persona_id, persona_lineage_id: Number(row.persona_lineage_id) };
}

/**
 * True when a table exists. The RAG schema (`documents`) is only created when
 * pgvector is installed, so the document case skips on a Postgres without the
 * extension while the base-schema memory case always runs.
 */
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

  let pOwn: PersonaRef; // upload and history document, personal memory
  let pEmpty: PersonaRef; // nothing
  let pShareA: PersonaRef; // upload document only

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
      // pOwn has an upload AND a history doc; pShareA has an upload only (proves
      // the history filter distinguishes them).
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
    if (!hasDocuments) return; // RAG schema absent (no pgvector), so skip history parity
    const batch = await serverMemoryRepository.personaIdsWithHistoryDocuments(serverId);
    for (const persona of [pOwn, pEmpty, pShareA]) {
      const loaderNonEmpty =
        (await serverMemoryRepository.loadHistoryDocuments(serverId, persona.persona_id)).length > 0;
      expect(batch.has(persona.persona_id)).toBe(loaderNonEmpty);
    }
    // Only pOwn has a history document; pShareA's upload-only doc must not count.
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
