import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { EmbeddingModelRow } from "@/types/db/schema";
import { ragRepository } from "@/utils/db/repositories";
import * as embeddingProvider from "@/utils/embeddings/embeddingProvider";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

const QUERY = "zylophane";
const QUERY_VECTOR = [1, 0, 0];
const MIN_SIMILARITY = 0.5;
const MAX_RESULTS = 10;
const NOISE_COUNT = 40;
const LEXICAL_COUNT = 10;

const LEXICAL_NAMES = Array.from({ length: LEXICAL_COUNT }, (_, index) => `_rt_floor_lex_${index}`);
const EXPECTED_LEXICAL_NAMES = [...LEXICAL_NAMES].sort();

async function pgvectorAvailable(): Promise<boolean> {
  const [row] = await testSql<Array<{ available: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS available
  `;
  return row?.available === true;
}

describe.skipIf(!DB_TESTS_AVAILABLE)("document retrieval floor", () => {
  let refs: FixtureRefs;
  let embeddingModel: EmbeddingModelRow;
  let ragReady = false;
  const spies: Array<{ mockRestore(): void }> = [];

  async function insertChunk(name: string, similarity: number, content: string): Promise<void> {
    const vector = `[${[similarity, Math.sqrt(1 - similarity ** 2), 0].join(",")}]`;
    const [document] = await testSql`
      INSERT INTO documents (server_id, document_name, text_content)
      VALUES (${refs.serverId}, ${name}, 'x')
      RETURNING document_id
    `;
    await testSql`
      INSERT INTO document_chunks (document_id, server_id, embedding_model_id, embedding_family, chunk_index, content, embedding)
      VALUES (
        ${document.document_id}, ${refs.serverId}, ${embeddingModel.embedding_model_id},
        ${embeddingModel.model_family}, 0, ${content}, ${vector}::vector
      )
    `;
  }

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    ragReady = await pgvectorAvailable();
    if (!ragReady) return;
    await executeTestSqlFile(path.join(process.cwd(), "src/db/schema_rag.sql"));
    const [model] = await testSql<EmbeddingModelRow[]>`SELECT * FROM embedding_models LIMIT 1`;
    if (!model) throw new Error("Missing seeded embedding model");
    embeddingModel = model;
    spies.push(
      spyOn(embeddingProvider, "generateEmbeddingsBatched").mockResolvedValue([QUERY_VECTOR]),
      spyOn(embeddingProvider, "providerSupportsEmbeddingTaskType").mockResolvedValue(false),
    );
    await testSql`DELETE FROM documents WHERE server_id = ${refs.serverId} AND document_name LIKE '_rt_floor_%'`;
    for (let index = 0; index < NOISE_COUNT; index += 1) {
      await insertChunk(`_rt_floor_noise_${index}`, 0.45 - index * 0.004, "unrelated filler text");
    }
    for (let index = 0; index < LEXICAL_COUNT; index += 1) {
      await insertChunk(LEXICAL_NAMES[index], 0.1 - index * 0.01, QUERY);
    }
  });

  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    if (ragReady) {
      await testSql`DELETE FROM documents WHERE server_id = ${refs.serverId} AND document_name LIKE '_rt_floor_%'`;
    }
    await cleanupFixtures(testSql);
  });

  it("returns the lower-ranked lexical rows after the top-ranked rows fail the floor", async () => {
    if (!ragReady) return;
    const chunks = await ragRepository.retrieveRelevantChunks({
      serverId: refs.serverId,
      personaId: null,
      query: QUERY,
      embeddingModel,
      apiKey: "unused",
      maxResults: MAX_RESULTS,
      minSimilarity: MIN_SIMILARITY,
    });

    expect(chunks.map((chunk) => chunk.document_name).sort()).toEqual(EXPECTED_LEXICAL_NAMES);
    // Every returned row sits below the floor, so only its lexical hit can explain its survival.
    expect(chunks.every((chunk) => chunk.similarity < MIN_SIMILARITY)).toBe(true);
  });
});
