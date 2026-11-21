import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { EmbeddingModelRow } from "@/types/db/schema";
import {
  exportRepository,
  importRepository,
  personalMemoryRepository,
  ragRepository,
  serverMemoryRepository,
  userRepository,
} from "@/utils/db/repositories";
import { FIXTURE_IDS, cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("document authorization predicates", () => {
  let refs: FixtureRefs;
  let otherServerId: number;
  let otherPersonaId: number;
  let model: EmbeddingModelRow & { embedding_model_id: number };
  let scopedDocumentId: number;
  let sharedDocumentId: number;
  const channelId = "881111111111111111";

  async function insert(serverId: number, personaId: number | null, channelDiscIds: string[]) {
    return ragRepository.insertWithChunks({
      serverId,
      personaId,
      uploaderUserId: refs.userId,
      documentName: `scope-${serverId}-${personaId}-${channelDiscIds.length}`,
      fileName: null,
      mimeType: null,
      fileSizeBytes: null,
      textContent: "zylophane",
      chunks: ["zylophane"],
      embeddings: [[1, 0, 0]],
      embeddingModelId: model.embedding_model_id,
      embeddingFamily: model.model_family,
      channelDiscIds,
    });
  }

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    await executeTestSqlFile("src/db/schema_rag.sql");
    const [seededModel] = await testSql<EmbeddingModelRow[]>`SELECT * FROM embedding_models LIMIT 1`;
    if (!seededModel?.embedding_model_id) throw new Error("Missing embedding fixture");
    model = { ...seededModel, embedding_model_id: seededModel.embedding_model_id };
    const [server] = await testSql`INSERT INTO servers (server_disc_id) VALUES ('_rt_scope_other') RETURNING server_id`;
    otherServerId = Number(server.server_id);
    const [persona] = await testSql`INSERT INTO personas (server_id, persona_nickname, is_alter)
      VALUES (${refs.serverId}, 'Juno', true) RETURNING persona_id`;
    otherPersonaId = Number(persona.persona_id);
    scopedDocumentId = await insert(refs.serverId, refs.personaId, [channelId]);
    sharedDocumentId = await insert(refs.serverId, null, []);
    await insert(refs.serverId, otherPersonaId, []);
    await insert(otherServerId, null, []);
  });

  afterAll(async () => {
    await testSql`DELETE FROM servers WHERE server_id = ${otherServerId}`;
    await cleanupFixtures(testSql);
  });

  it("keeps lexical and vector matches inside server, persona, and channel scope", async () => {
    for (const query of ["zylophane", "unmatched"]) {
      for (const channelIds of [[channelId], ["882222222222222222"]]) {
        const rows = await ragRepository.retrieveRelevantChunks({
          serverId: refs.serverId,
          personaId: refs.personaId,
          query,
          queryEmbedding: [1, 0, 0],
          embeddingModel: model,
          apiKey: "unused",
          maxResults: 10,
          minSimilarity: 0.5,
          channelIds,
        });
        const expected = channelIds.includes(channelId) ? [scopedDocumentId, sharedDocumentId] : [sharedDocumentId];
        expect(rows.map((row) => row.document_id).sort()).toEqual(expected.sort());
      }
    }
  });

  it("refuses foreign server and persona chunk reads and deletes", async () => {
    const [chunk] = await serverMemoryRepository.loadDocumentChunks(scopedDocumentId, refs.serverId, refs.personaId);
    expect(chunk).toBeDefined();
    if (!chunk) throw new Error("Missing document chunk fixture");
    for (const [serverId, personaId] of [
      [otherServerId, refs.personaId],
      [refs.serverId, otherPersonaId],
    ]) {
      expect(await serverMemoryRepository.loadDocumentChunks(scopedDocumentId, serverId, personaId)).toEqual([]);
      expect(await serverMemoryRepository.deleteChunk(chunk.document_chunk_id, serverId, personaId)).toBe(false);
      expect(await serverMemoryRepository.removeDocument(scopedDocumentId, serverId, personaId)).toBeNull();
    }
    expect(
      await serverMemoryRepository.loadDocumentChunks(scopedDocumentId, refs.serverId, refs.personaId),
    ).toHaveLength(1);
  });

  it("binds memory import and export to the supplied owner and refuses a foreign workspace persona", async () => {
    const otherUser = await userRepository.register(FIXTURE_IDS.altUserDiscId, "Juno", "en-US");
    if (!otherUser?.user_id) throw new Error("Missing alternate user fixture");
    const privateContent = "Synthetic other-owner fact";
    const ownContent = "Synthetic replacement fact";
    const otherMemory = await personalMemoryRepository.add(otherUser.user_id, 0, privateContent);
    if (!otherMemory) throw new Error("Missing alternate memory fixture");
    const imported = await importRepository.importPersonalMemoryBundle(
      FIXTURE_IDS.userDiscId,
      [{ bucketName: "global", personaLineageId: 0, memories: [{ content: ownContent, tags: [] }] }],
      "replace",
    );
    expect(imported.success).toBe(true);
    const remaining = await personalMemoryRepository.loadForUserLineage(otherUser.user_id, 0);
    expect(remaining.some((row) => row.personal_memory_id === otherMemory.personal_memory_id)).toBe(true);
    const exported = await exportRepository.exportPersonalMemories(FIXTURE_IDS.userDiscId, { mode: "all" });
    expect(exported.success).toBe(true);
    expect(JSON.stringify(exported)).toContain(ownContent);
    expect(JSON.stringify(exported)).not.toContain(privateContent);
    const foreignImport = await importRepository.importWorkspaceMemoryBundle(
      "_rt_scope_other",
      FIXTURE_IDS.userDiscId,
      [{ bucketName: "foreign", personaId: refs.personaId, memories: [{ content: ownContent, tags: [] }] }],
      "replace",
    );
    expect(foreignImport.success).toBe(false);
    expect(await serverMemoryRepository.loadServerMemoriesScoped(otherServerId, refs.personaLineageId)).toEqual([]);
  });
});
