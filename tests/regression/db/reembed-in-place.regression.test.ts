import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn, type Mock } from "bun:test";
import type { EmbeddingModelRow } from "@/types/db/schema";
import { ragRepository, serverMemoryRepository } from "@/utils/db/repositories";
import * as embeddingProvider from "@/utils/embeddings/embeddingProvider";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

const OLD_VECTOR = "[1,0,0]";
const NEW_VECTOR = [0, 1];

describe.skipIf(!DB_TESTS_AVAILABLE)("document re-embedding in place", () => {
  let refs: FixtureRefs;
  let oldModel: EmbeddingModelRow & { embedding_model_id: number };
  let targetModel: EmbeddingModelRow & { embedding_model_id: number };
  let embed: Mock<typeof embeddingProvider.generateEmbeddingsBatched>;
  let taskType: Mock<typeof embeddingProvider.providerSupportsEmbeddingTaskType>;

  async function insertChunk(documentId: number, index: number, content: string): Promise<void> {
    await testSql`
      INSERT INTO document_chunks
        (document_id, server_id, embedding_model_id, embedding_family, chunk_index, content, embedding)
      VALUES (${documentId}, ${refs.serverId}, ${oldModel.embedding_model_id}, ${oldModel.model_family},
        ${index}, ${content}, ${OLD_VECTOR}::vector)
    `;
  }

  async function insertDocument(name: string, contents: string[], sourceType = "upload"): Promise<number> {
    const [document] = await testSql`
      INSERT INTO documents (server_id, document_name, text_content, source_type)
      VALUES (${refs.serverId}, ${name}, ${contents.join("\n\n")}, ${sourceType})
      RETURNING document_id
    `;
    for (let index = 0; index < contents.length; index++) {
      await insertChunk(document.document_id, index * 2, contents[index]);
    }
    return document.document_id;
  }

  async function storedChunks() {
    return testSql<
      Array<{
        document_chunk_id: number;
        document_id: number;
        chunk_index: number;
        content: string;
        embedding_model_id: number;
        embedding_family: string;
        embedding: string;
      }>
    >`
      SELECT document_chunk_id, document_id, chunk_index, content, embedding_model_id,
        embedding_family, embedding::text AS embedding
      FROM document_chunks WHERE server_id = ${refs.serverId}
      ORDER BY document_id, chunk_index
    `;
  }

  function reembed() {
    return ragRepository.reembedServerDocuments({
      serverId: refs.serverId,
      embeddingModel: targetModel,
      apiKey: "unused",
    });
  }

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    const [extension] = await testSql<Array<{ available: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS available
    `;
    if (!extension?.available) throw new Error("The re-embedding regression requires pgvector");
    await executeTestSqlFile(path.join(process.cwd(), "src/db/schema_rag.sql"));
    const models = await testSql<
      Array<EmbeddingModelRow & { embedding_model_id: number }>
    >`SELECT * FROM embedding_models ORDER BY embedding_model_id`;
    oldModel = models[0];
    const target = models.find((model) => model.model_family !== oldModel.model_family);
    if (!target) throw new Error("Missing seeded models from different embedding families");
    targetModel = target;
    embed = spyOn(embeddingProvider, "generateEmbeddingsBatched");
    taskType = spyOn(embeddingProvider, "providerSupportsEmbeddingTaskType").mockResolvedValue(false);
  });

  beforeEach(async () => {
    await testSql`DELETE FROM documents WHERE server_id = ${refs.serverId}`;
    embed.mockReset();
    embed.mockImplementation(async (request) => request.inputs.map(() => [...NEW_VECTOR]));
  });

  afterAll(async () => {
    embed?.mockRestore();
    taskType?.mockRestore();
    await cleanupFixtures(testSql);
  });

  it("preserves history facts and edited long upload chunks, including IDs and index gaps", async () => {
    await insertDocument("_rt_history", ["Mirri prefers tea.", "Juno collects shells."], "history");
    const overlap = "shared passage ".repeat(12);
    await insertDocument("_rt_upload", [`First passage ${overlap}`, `${overlap}${"edited text ".repeat(300)}`]);
    const before = await storedChunks();
    await reembed();
    const after = await storedChunks();
    expect(after.map(({ embedding, embedding_model_id, embedding_family, ...chunk }) => chunk)).toEqual(
      before.map(({ embedding, embedding_model_id, embedding_family, ...chunk }) => chunk),
    );
    expect(
      after.every(
        (chunk) =>
          chunk.embedding_model_id === targetModel.embedding_model_id &&
          chunk.embedding_family === targetModel.model_family &&
          chunk.embedding === "[0,1]",
      ),
    ).toBe(true);
    expect(embed.mock.calls.flatMap(([request]) => request.inputs)).toEqual(before.map((chunk) => chunk.content));
    embed.mockClear();
    await reembed();
    expect(embed).not.toHaveBeenCalled();
  });

  it("retries a single edit from fresh content", async () => {
    await insertDocument("_rt_edit_once", ["original", "unchanged"]);
    const [first] = await storedChunks();
    embed.mockImplementationOnce(async (request) => {
      expect(
        await serverMemoryRepository.updateChunk({
          chunkId: first.document_chunk_id,
          serverId: refs.serverId,
          personaId: null,
          content: "updated",
          embeddingVector: OLD_VECTOR,
          embeddingModelId: oldModel.embedding_model_id,
          embeddingFamily: oldModel.model_family,
        }),
      ).toBe(true);
      return request.inputs.map(() => [...NEW_VECTOR]);
    });
    await reembed();
    expect(embed.mock.calls.map(([request]) => request.inputs)).toEqual([
      ["original", "unchanged"],
      ["updated", "unchanged"],
    ]);
    expect((await storedChunks())[0]).toMatchObject({ content: "updated", embedding: "[0,1]" });
  });

  it("rejects repeated edits without overwriting content or partially updating the document", async () => {
    await insertDocument("_rt_edit_twice", ["original", "unchanged"]);
    const before = await storedChunks();
    let edits = 0;
    embed.mockImplementation(async (request) => {
      edits++;
      expect(
        await serverMemoryRepository.updateChunk({
          chunkId: before[0].document_chunk_id,
          serverId: refs.serverId,
          personaId: null,
          content: `edit ${edits}`,
          embeddingVector: OLD_VECTOR,
          embeddingModelId: oldModel.embedding_model_id,
          embeddingFamily: oldModel.model_family,
        }),
      ).toBe(true);
      return request.inputs.map(() => [...NEW_VECTOR]);
    });
    await expect(reembed()).rejects.toBeInstanceOf(Error);
    expect(edits).toBe(2);
    expect(await storedChunks()).toEqual([{ ...before[0], content: "edit 2" }, before[1]]);
  });

  it("detects appended and deleted rows on both attempts", async () => {
    for (const change of ["append", "delete"] as const) {
      await testSql`DELETE FROM documents WHERE server_id = ${refs.serverId}`;
      const documentId = await insertDocument(`_rt_${change}`, ["one", "two", "three"]);
      let calls = 0;
      embed.mockImplementation(async (request) => {
        calls++;
        if (change === "append") {
          await insertChunk(documentId, 4 + calls, `added ${calls}`);
        } else {
          const [first] = await storedChunks();
          expect(await serverMemoryRepository.deleteChunk(first.document_chunk_id, refs.serverId, null)).toBe(true);
        }
        return request.inputs.map(() => [...NEW_VECTOR]);
      });
      await expect(reembed()).rejects.toBeInstanceOf(Error);
      expect(calls).toBe(2);
      const after = await storedChunks();
      expect(after).toHaveLength(change === "append" ? 5 : 1);
      expect(
        after.every(
          (chunk) => chunk.embedding === OLD_VECTOR && chunk.embedding_model_id === oldModel.embedding_model_id,
        ),
      ).toBe(true);
    }
  });

  it("rejects malformed vector counts, empty vectors, non-finite values and inconsistent widths atomically", async () => {
    const invalidBatches = [
      [[1, 0]],
      [
        [1, 0],
        [1, 0],
        [1, 0],
      ],
      [[], []],
      [
        [Number.NaN, 0],
        [1, 0],
      ],
      [
        [1, 0],
        [Number.POSITIVE_INFINITY, 0],
      ],
      [
        [1, 0],
        [1, 0, 0],
      ],
    ];
    for (const vectors of invalidBatches) {
      await testSql`DELETE FROM documents WHERE server_id = ${refs.serverId}`;
      await insertDocument("_rt_invalid", ["one", "two"]);
      const before = await storedChunks();
      embed.mockResolvedValue(vectors);
      await expect(reembed()).rejects.toBeInstanceOf(Error);
      expect(await storedChunks()).toEqual(before);
    }
  });

  it("rejects vectors that differ from an existing target family's stored dimensions", async () => {
    await insertDocument("_rt_pending", ["one", "two"]);
    const existing = await insertDocument("_rt_existing", ["target family"]);
    await testSql`
      UPDATE document_chunks SET embedding_model_id = ${targetModel.embedding_model_id},
        embedding_family = ${targetModel.model_family}, embedding = '[1,0,0,0]'::vector
      WHERE document_id = ${existing}
    `;
    const before = await storedChunks();
    await expect(reembed()).rejects.toBeInstanceOf(Error);
    expect(await storedChunks()).toEqual(before);
  });

  it("processes remaining documents after a failure and only retries unfinished chunks on the next call", async () => {
    await insertDocument("_rt_bad", ["bad"]);
    await insertDocument("_rt_good", ["good"]);
    embed.mockImplementation(async (request) => (request.inputs[0] === "bad" ? [] : [[...NEW_VECTOR]]));
    await expect(reembed()).rejects.toBeInstanceOf(Error);
    expect((await storedChunks()).map((chunk) => chunk.embedding_model_id)).toEqual([
      oldModel.embedding_model_id,
      targetModel.embedding_model_id,
    ]);
    embed.mockClear();
    embed.mockImplementation(async (request) => request.inputs.map(() => [...NEW_VECTOR]));
    await reembed();
    expect(embed.mock.calls.map(([request]) => request.inputs)).toEqual([["bad"]]);
    expect((await storedChunks()).every((chunk) => chunk.embedding_model_id === targetModel.embedding_model_id)).toBe(
      true,
    );
  });
});
