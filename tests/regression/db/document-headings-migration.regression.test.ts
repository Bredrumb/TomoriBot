import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cleanupFixtures, insertFixtures } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

const migration = path.join(process.cwd(), "src/db/migrations/127_document_chunk_headings");

describe.skipIf(!DB_TESTS_AVAILABLE)("document heading migration", () => {
  beforeAll(async () => {
    await setupTestDb();
    await insertFixtures(testSql);
    await executeTestSqlFile(path.join(process.cwd(), "src/db/schema_rag.sql"));
  });
  afterAll(async () => {
    await cleanupFixtures(testSql);
  });

  it("applies up/down/up without optional RAG tables or pgvector", async () => {
    const rollback = new Error("Rollback optional schema probe");
    try {
      await testSql.begin(async (tx) => {
        await tx`DROP TABLE document_chunks`;
        await tx`DROP EXTENSION vector CASCADE`;
        await tx.unsafe(await Bun.file(`${migration}.sql`).text());
        await tx.unsafe(await Bun.file(`${migration}.down.sql`).text());
        await tx.unsafe(await Bun.file(`${migration}.sql`).text());
        const [row] = await tx`SELECT to_regclass('public.document_chunks') AS chunks`;
        expect(row.chunks).toBeNull();
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });

  it("round-trips up/down/up and idempotent schema installation", async () => {
    await executeTestSqlFile(`${migration}.sql`);
    await executeTestSqlFile(`${migration}.down.sql`);
    const [absent] =
      await testSql`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='document_chunks' AND column_name='heading_path') AS present`;
    expect(absent.present).toBe(false);
    await executeTestSqlFile(`${migration}.sql`);
    await executeTestSqlFile(`${migration}.sql`);
    await executeTestSqlFile(path.join(process.cwd(), "src/db/schema_rag.sql"));
    const [column] =
      await testSql`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name='document_chunks' AND column_name='heading_path'`;
    expect(column).toMatchObject({ data_type: "jsonb", is_nullable: "YES" });
  });
});
