import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { EmbeddingModelRow } from "@/types/db/schema";
import { serverMemoryRepository } from "@/utils/db/repositories";
import {
  appendDocumentChunks,
  backfillDocumentLexicalTextBatch,
  createDocumentRecord,
  insertDocumentWithChunks,
  retrieveRelevantDocumentChunks,
} from "@/utils/documents/documentService";
import { buildDocumentLexicalText } from "@/utils/documents/lexicalText";
import * as embeddingProvider from "@/utils/embeddings/embeddingProvider";
import { RAG_DOCUMENTS } from "../../fixtures/rag";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

const migration = path.join(process.cwd(), "src/db/migrations/126_document_chunks_lexical_text");
const ragSchema = path.join(process.cwd(), "src/db/schema_rag.sql");

describe.skipIf(!DB_TESTS_AVAILABLE)("derived document lexical search", () => {
  let refs: FixtureRefs;
  let model: EmbeddingModelRow & { embedding_model_id: number };
  const spies: Array<{ mockRestore(): void }> = [];

  async function insert(name: string, content: string): Promise<number> {
    return insertDocumentWithChunks({
      serverId: refs.serverId,
      personaId: null,
      uploaderUserId: null,
      documentName: name,
      fileName: null,
      mimeType: null,
      fileSizeBytes: null,
      textContent: content,
      chunks: [content],
      embeddings: [[0, 1, 0]],
      embeddingModelId: model.embedding_model_id,
      embeddingFamily: model.model_family,
    });
  }

  async function stored(documentId: number) {
    const [row] = await testSql<Array<{ document_chunk_id: number; content: string; lex_text: string | null }>>`
      SELECT document_chunk_id, content, lex_text FROM document_chunks WHERE document_id = ${documentId}
    `;
    return row;
  }

  async function retrieve(query: string) {
    return retrieveRelevantDocumentChunks({
      serverId: refs.serverId,
      query,
      embeddingModel: model,
      apiKey: "unused",
      maxResults: 10,
      minSimilarity: 0.5,
    });
  }

  async function waitForBackfillLock(lockerPid: number): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
      const [waiter] = await testSql`
        SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${lockerPid} = ANY(pg_blocking_pids(pid))) AS waiting
      `;
      if (waiter.waiting) return;
      await Bun.sleep(10);
    }
    throw new Error("Backfill did not reach the locked write");
  }

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    await executeTestSqlFile(ragSchema);
    const [row] = await testSql<Array<EmbeddingModelRow & { embedding_model_id: number }>>`
      SELECT * FROM embedding_models ORDER BY embedding_model_id LIMIT 1
    `;
    if (!row) throw new Error("Missing embedding fixture");
    model = row;
    spies.push(
      spyOn(embeddingProvider, "generateEmbeddingsBatched").mockResolvedValue([[1, 0, 0]]),
      spyOn(embeddingProvider, "providerSupportsEmbeddingTaskType").mockResolvedValue(false),
    );
  });

  beforeEach(async () => {
    await testSql`DELETE FROM documents WHERE server_id = ${refs.serverId}`;
  });

  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    await cleanupFixtures(testSql);
  });

  it("matches CJK substrings below the cosine floor", async () => {
    const document = RAG_DOCUMENTS.find((doc) => doc.key === "shio-tsumugi");
    if (!document) throw new Error("Missing CJK fixture");
    const id = await insert(document.documentName, document.passages[0].text);
    const results = await retrieve("月湊");
    expect(results.map((row) => row.document_id)).toContain(id);
    expect(results.every((row) => row.similarity < 0.5)).toBe(true);
  });

  it("matches the document name when it is absent from the content", async () => {
    const id = await insert("Glasswing Ferry", "Mirri maintains the eastern pier.");
    expect((await retrieve("Glasswing")).map((row) => row.document_id)).toContain(id);
  });

  it("derives title and content text for incremental history writes", async () => {
    const name = "Lantern Journal";
    const id = await createDocumentRecord({
      serverId: refs.serverId,
      personaId: null,
      uploaderUserId: null,
      documentName: name,
      sourceType: "history",
    });
    await appendDocumentChunks({
      documentId: id,
      documentName: name,
      serverId: refs.serverId,
      embeddingModelId: model.embedding_model_id,
      embeddingFamily: model.model_family,
      startIndex: 0,
      chunks: ["岚守望潮港"],
      embeddings: [[0, 1, 0]],
    });
    const row = await stored(id);
    expect(row.lex_text).toBe(buildDocumentLexicalText(name, row.content));
    expect((await retrieve("Journal")).map((row) => row.document_id)).toContain(id);
  });

  it("replaces edited lexical text and clears it for a content-only write", async () => {
    const id = await insert("_rt_edits", "月湊灯台");
    const row = await stored(id);
    expect(
      await serverMemoryRepository.updateChunk({
        chunkId: row.document_chunk_id,
        serverId: refs.serverId,
        personaId: null,
        content: "北岸燈樓",
        embeddingVector: "[0,1,0]",
        embeddingModelId: model.embedding_model_id,
        embeddingFamily: model.model_family,
      }),
    ).toBe(true);
    expect((await stored(id)).lex_text).toBe(buildDocumentLexicalText("_rt_edits", "北岸燈樓"));
    expect(await retrieve("月湊")).toHaveLength(0);
    expect((await retrieve("燈樓")).map((chunk) => chunk.document_id)).toContain(id);
    await testSql`UPDATE document_chunks SET content = 'fallbackword' WHERE document_id = ${id}`;
    expect((await stored(id)).lex_text).toBeNull();
    expect(await retrieve("燈樓")).toHaveLength(0);
    expect((await retrieve("fallbackword")).map((chunk) => chunk.document_id)).toContain(id);
  });

  it("skips a concurrent edit and resumes the pending row on the next batch", async () => {
    const id = await insert("_rt_backfill", "月湊灯台");
    await testSql`UPDATE document_chunks SET lex_text = NULL WHERE document_id = ${id}`;
    let batch: ReturnType<typeof backfillDocumentLexicalTextBatch> | undefined;
    await testSql.begin(async (tx) => {
      const [locker] = await tx`SELECT pg_backend_pid() AS pid`;
      await tx`SELECT document_chunk_id FROM document_chunks WHERE document_id = ${id} FOR UPDATE`;
      batch = backfillDocumentLexicalTextBatch();
      await waitForBackfillLock(locker.pid);
      await tx`UPDATE document_chunks SET content = '北岸燈樓' WHERE document_id = ${id}`;
    });
    expect(await batch).toMatchObject({ selected: 1, updated: 0 });
    expect((await stored(id)).lex_text).toBeNull();
    expect(await backfillDocumentLexicalTextBatch()).toMatchObject({ selected: 1, updated: 1 });
    expect((await stored(id)).lex_text).toBe(buildDocumentLexicalText("_rt_backfill", "北岸燈樓"));
    expect(await backfillDocumentLexicalTextBatch()).toMatchObject({ selected: 0, updated: 0 });
  });

  it("skips a renamed document until a fresh snapshot is read", async () => {
    const id = await insert("_rt_original_name", "北岸燈樓");
    await testSql`UPDATE document_chunks SET lex_text = NULL WHERE document_id = ${id}`;
    let batch: ReturnType<typeof backfillDocumentLexicalTextBatch> | undefined;
    await testSql.begin(async (tx) => {
      const [locker] = await tx`SELECT pg_backend_pid() AS pid`;
      await tx`SELECT document_id FROM documents WHERE document_id = ${id} FOR UPDATE`;
      batch = backfillDocumentLexicalTextBatch();
      await waitForBackfillLock(locker.pid);
      await tx`UPDATE documents SET document_name = '_rt_fresh_name' WHERE document_id = ${id}`;
    });
    expect(await batch).toMatchObject({ selected: 1, updated: 0 });
    expect((await stored(id)).lex_text).toBeNull();
    expect(await backfillDocumentLexicalTextBatch()).toMatchObject({ selected: 1, updated: 1 });
    expect((await stored(id)).lex_text).toBe(buildDocumentLexicalText("_rt_fresh_name", "北岸燈樓"));
  });

  it("stops backfill without the optional table and resumes when the schema is available", async () => {
    await testSql`ALTER TABLE document_chunks RENAME TO _rt_document_chunks_optional_schema`;
    try {
      expect(await backfillDocumentLexicalTextBatch()).toEqual({ selected: 0, updated: 0 });
    } finally {
      await testSql`ALTER TABLE _rt_document_chunks_optional_schema RENAME TO document_chunks`;
    }
    const id = await insert("_rt_optional_backfill", "月湊灯台");
    await testSql`UPDATE document_chunks SET lex_text = NULL WHERE document_id = ${id}`;
    expect(await backfillDocumentLexicalTextBatch()).toEqual({ selected: 1, updated: 1 });
    expect((await stored(id)).lex_text).toBe(buildDocumentLexicalText("_rt_optional_backfill", "月湊灯台"));
  });

  it("guards migration up and down when the optional schema and vector extension are absent", async () => {
    const rollback = new Error("Rollback optional-schema probe");
    try {
      await testSql.begin(async (tx) => {
        await tx`DROP TABLE document_chunks`;
        await tx`DROP EXTENSION vector CASCADE`;
        await tx.unsafe(await Bun.file(`${migration}.sql`).text());
        await tx.unsafe(await Bun.file(`${migration}.down.sql`).text());
        const [row] = await tx`SELECT to_regclass('public.document_chunks') AS chunks`;
        expect(row.chunks).toBeNull();
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });

  it("supports up, down, up and repeated optional-schema application", async () => {
    const id = await insert("_rt_migrations", "хранительница");
    await executeTestSqlFile(`${migration}.sql`);
    await executeTestSqlFile(`${migration}.down.sql`);
    const [column] = await testSql`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'document_chunks' AND column_name = 'lex_text') AS present
    `;
    expect(column.present).toBe(false);
    await executeTestSqlFile(`${migration}.sql`);
    expect((await stored(id)).lex_text).toBeNull();
    await executeTestSqlFile(ragSchema);
    await executeTestSqlFile(ragSchema);
    expect(await backfillDocumentLexicalTextBatch()).toMatchObject({ selected: 1, updated: 1 });
    expect((await retrieve("хранительницы")).map((row) => row.document_id)).toContain(id);
  });
});
