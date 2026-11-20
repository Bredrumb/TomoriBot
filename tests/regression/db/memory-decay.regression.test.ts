import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  exportRepository,
  importRepository,
  llmProviderRepo,
  memoryDecayRepository,
  personalMemoryRepository,
  serverMemoryRepository,
} from "@/utils/db/repositories";
import { detectRagAvailability, resetRagAvailabilityCache } from "@/utils/db/ragAvailability";
import { MEMORY_DORMANT_DAYS } from "@/utils/memory/memoryDecay";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";
import { registerCustomEndpoint } from "@/utils/provider/customEndpointService";
import { createServerConfig } from "../../helpers/fixtures";
import { useEnvSandbox } from "../../helpers/env";
import { cleanupFixtures, FIXTURE_IDS, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

const empty = { serverMemoryIds: [], personalMemoryIds: [] };

describe.skipIf(!DB_TESTS_AVAILABLE)("memory decay storage", () => {
  useEnvSandbox(["MAX_SERVER_MEMORIES", "MAX_PERSONAL_MEMORIES", "MEMORY_DECAY_ENABLED"]);
  let refs: FixtureRefs;
  let rag = false;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    resetRagAvailabilityCache();
    rag = await detectRagAvailability();
  });

  beforeEach(async () => {
    await testSql`DELETE FROM server_memories WHERE server_id = ${refs.serverId}`;
    await testSql`DELETE FROM personal_memories WHERE user_id = ${refs.userId}`;
    delete process.env.MEMORY_DECAY_ENABLED;
  });

  afterAll(async () => {
    resetRagAvailabilityCache();
    await cleanupFixtures(testSql);
  });

  async function insertServer(decay = 0, manuallyWritten = false, content = "stored fact") {
    const [row] =
      await testSql`INSERT INTO server_memories (server_id, persona_id, persona_lineage_id, user_id, content, decay_days, manually_written)
      VALUES (${refs.serverId}, ${refs.personaId}, ${refs.personaLineageId}, ${refs.userId}, ${content}, ${decay}, ${manuallyWritten}) RETURNING server_memory_id`;
    return row.server_memory_id as number;
  }

  async function insertPersonal(decay = 0, manuallyWritten = false, lineage = refs.personaLineageId) {
    const [row] =
      await testSql`INSERT INTO personal_memories (user_id, persona_lineage_id, content, decay_days, manually_written)
      VALUES (${refs.userId}, ${lineage}, 'personal fact', ${decay}, ${manuallyWritten}) RETURNING personal_memory_id`;
    return row.personal_memory_id as number;
  }

  it("counts once per UTC day, resets reinforced rows, and leaves unscored days paused", async () => {
    const server = await insertServer(MEMORY_DORMANT_DAYS - 1);
    const personal = await insertPersonal(MEMORY_DORMANT_DAYS + 4);
    const paused = await insertPersonal(6);
    const scored = { serverMemoryIds: [server], personalMemoryIds: [personal] };
    const reinforced = { ...empty, personalMemoryIds: [personal] };
    const changes = await memoryDecayRepository.recordRecallDay(scored, reinforced);
    expect(changes.map((row) => row.kind).sort()).toEqual(["personal", "server"]);
    expect(await memoryDecayRepository.recordRecallDay(scored, reinforced)).toEqual([]);
    const [s] =
      await testSql`SELECT decay_days, decay_counted_on = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date AS today FROM server_memories WHERE server_memory_id = ${server}`;
    expect(s).toMatchObject({ decay_days: MEMORY_DORMANT_DAYS, today: true });
    const rows = await personalMemoryRepository.loadForUserLineage(refs.userId, refs.personaLineageId);
    expect(rows.find((row) => row.personal_memory_id === personal)?.decay_days).toBe(0);
    expect(rows.find((row) => row.personal_memory_id === paused)).toMatchObject({
      decay_days: 6,
      decay_counted_on: null,
    });
    expect(
      (await serverMemoryRepository.loadServerMemoriesScoped(refs.serverId, refs.personaLineageId))[0]?.decay_days,
    ).toBe(MEMORY_DORMANT_DAYS);
    await testSql`UPDATE server_memories SET decay_counted_on = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 7 WHERE server_memory_id = ${server}`;
    await Promise.all([
      memoryDecayRepository.recordRecallDay(scored, empty),
      memoryDecayRepository.recordRecallDay(scored, empty),
    ]);
    const [once] = await testSql`SELECT decay_days FROM server_memories WHERE server_memory_id = ${server}`;
    expect(once.decay_days).toBe(MEMORY_DORMANT_DAYS + 1);
    await Promise.all([
      memoryDecayRepository.recordRecallDay(scored, { ...empty, serverMemoryIds: [server] }),
      memoryDecayRepository.recordRecallDay(scored, empty),
    ]);
    const [reset] = await testSql`SELECT decay_days FROM server_memories WHERE server_memory_id = ${server}`;
    expect(reset.decay_days).toBe(0);
    await testSql`UPDATE server_memories SET decay_days = ${MEMORY_DORMANT_DAYS - 1}, decay_counted_on = NULL, reinforced_on = NULL WHERE server_memory_id = ${server}`;
    const crossings = await Promise.all([
      memoryDecayRepository.recordRecallDay(scored, empty),
      memoryDecayRepository.recordRecallDay(scored, empty),
    ]);
    expect(crossings.flat().filter((row) => row.kind === "server")).toHaveLength(1);
  });

  it("evicts the least reinforced eligible server memory and serializes two saves at the cap", async () => {
    if (!rag) return;
    process.env.MAX_SERVER_MEMORIES = "4";
    const human = await insertServer(40, true);
    const reinforced = await insertServer(20);
    await testSql`UPDATE server_memories SET reinforced_on = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 20 WHERE server_memory_id = ${reinforced}`;
    const oldest = await insertServer(14);
    const other = await insertServer(18);
    const save = (content: string) =>
      serverMemoryRepository.addWithEviction(
        refs.serverId,
        refs.personaId,
        refs.personaLineageId,
        refs.userId,
        content,
        true,
      );
    process.env.MEMORY_DECAY_ENABLED = "false";
    expect(await save("disabled save")).toEqual({ status: "refused", currentCount: 4, limit: 4 });
    delete process.env.MEMORY_DECAY_ENABLED;
    const first = await save("first model save");
    expect(first.status).toBe("saved");
    if (first.status !== "saved") throw new Error("Expected save");
    expect(first.evicted).toMatchObject({ id: oldest, decay_days: 14 });
    expect(first.memory.manually_written).toBe(false);
    const results = await Promise.all([save("second model save"), save("third model save")]);
    expect(results.every((result) => result.status === "saved")).toBe(true);
    const ids = (await serverMemoryRepository.loadServerMemoriesScoped(refs.serverId, refs.personaLineageId)).map(
      (row) => row.server_memory_id,
    );
    expect(ids).toHaveLength(getMemoryLimits().maxServerMemories);
    expect(ids).toContain(human);
    expect(ids).not.toContain(other);
    expect(ids).not.toContain(reinforced);
    expect(await save("cannot fit")).toEqual({ status: "refused", currentCount: 4, limit: 4 });
  });

  it("counts global personal rows but evicts only the saving lineage and obeys the global switch", async () => {
    if (!rag) return;
    process.env.MAX_PERSONAL_MEMORIES = "3";
    const global = await insertPersonal(40, false, 0);
    const human = await insertPersonal(40, true);
    const evictable = await insertPersonal(14);
    await insertPersonal(30, false, refs.personaLineageId + 1);
    process.env.MEMORY_DECAY_ENABLED = "false";
    const save = () => personalMemoryRepository.addWithEviction(refs.userId, refs.personaLineageId, "model fact", true);
    expect(await save()).toEqual({ status: "refused", currentCount: 3, limit: 3 });
    delete process.env.MEMORY_DECAY_ENABLED;
    const results = await Promise.all([save(), save()]);
    expect(results.filter((result) => result.status === "saved")).toHaveLength(1);
    const saved = results.find((result) => result.status === "saved");
    if (saved?.status !== "saved") throw new Error("Expected save");
    expect(saved.evicted?.id).toBe(evictable);
    const rows = await personalMemoryRepository.loadForUserLineage(refs.userId, refs.personaLineageId);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.personal_memory_id)).toEqual(expect.arrayContaining([global, human]));
    await expect(personalMemoryRepository.addWithEviction(refs.userId, 0, "invalid scope", true)).rejects.toThrow();
  });

  async function saveModel(kind: "server" | "personal", content: string) {
    return kind === "server"
      ? serverMemoryRepository.addWithEviction(
          refs.serverId,
          refs.personaId,
          refs.personaLineageId,
          refs.userId,
          content,
          true,
        )
      : personalMemoryRepository.addWithEviction(refs.userId, refs.personaLineageId, content, true);
  }

  async function loadScope(kind: "server" | "personal") {
    return kind === "server"
      ? serverMemoryRepository.loadServerMemoriesScoped(refs.serverId, refs.personaLineageId)
      : personalMemoryRepository.loadForUserLineage(refs.userId, refs.personaLineageId, false);
  }

  it.each([
    ["server", "model"],
    ["server", "imported"],
    ["server", "default"],
    ["personal", "model"],
    ["personal", "imported"],
    ["personal", "default"],
  ] as const)("evicts a resting %s %s memory at the cap", async (kind, origin) => {
    if (!rag) throw new Error("Eviction coverage requires pgvector");
    process.env.MAX_SERVER_MEMORIES = "1";
    process.env.MAX_PERSONAL_MEMORIES = "1";
    if (origin === "model") {
      expect(await saveModel(kind, "original fact")).toMatchObject({
        status: "saved",
        memory: { manually_written: false },
      });
    } else if (origin === "imported") {
      const memories = [{ content: "original fact", tags: [] }];
      const result =
        kind === "server"
          ? await importRepository.importWorkspaceMemoryBundle(
              FIXTURE_IDS.serverDiscId,
              FIXTURE_IDS.userDiscId,
              [{ bucketName: "Archive", personaId: refs.personaId, memories }],
              "merge",
            )
          : await importRepository.importPersonalMemoryBundle(
              FIXTURE_IDS.userDiscId,
              [{ bucketName: "Archive", personaLineageId: refs.personaLineageId, memories }],
              "merge",
            );
      expect(result.success).toBe(true);
    } else if (kind === "server") {
      await testSql`INSERT INTO server_memories (server_id, persona_id, persona_lineage_id, user_id, content)
        VALUES (${refs.serverId}, ${refs.personaId}, ${refs.personaLineageId}, ${refs.userId}, 'original fact')`;
    } else {
      await testSql`INSERT INTO personal_memories (user_id, persona_lineage_id, content)
        VALUES (${refs.userId}, ${refs.personaLineageId}, 'original fact')`;
    }
    const [original] = await loadScope(kind);
    if (!original) throw new Error("Missing memory fixture");
    const id = "server_id" in original ? original.server_memory_id : original.personal_memory_id;
    if (id === undefined) throw new Error("Missing memory ID");
    expect(original.manually_written).toBe(false);
    if (kind === "server") await testSql`UPDATE server_memories SET decay_days = 14 WHERE server_memory_id = ${id}`;
    else await testSql`UPDATE personal_memories SET decay_days = 14 WHERE personal_memory_id = ${id}`;
    const result = await saveModel(kind, "replacement fact");
    expect(result).toMatchObject({ status: "saved", evicted: { id }, memory: { manually_written: false } });
    expect((await loadScope(kind)).map((row) => row.content)).toEqual(["replacement fact"]);
  });

  it.each([
    "server",
    "personal",
  ] as const)("protects manual %s additions and edit-form saves while model edits preserve protection", async (kind) => {
    if (!rag) throw new Error("Eviction coverage requires pgvector");
    process.env.MAX_SERVER_MEMORIES = "2";
    process.env.MAX_PERSONAL_MEMORIES = "2";
    const manual =
      kind === "server"
        ? await serverMemoryRepository.add(
            refs.serverId,
            refs.personaId,
            refs.personaLineageId,
            refs.userId,
            "manual fact",
            FIXTURE_IDS.serverDiscId,
            [],
            { manuallyWritten: true },
          )
        : await personalMemoryRepository.add(refs.userId, refs.personaLineageId, "manual fact", [], {
            manuallyWritten: true,
          });
    expect(manual?.manually_written).toBe(true);
    const model = await saveModel(kind, "model fact");
    if (model.status !== "saved") throw new Error("Missing model fixture");
    for (const row of await loadScope(kind)) {
      const id = "server_id" in row ? row.server_memory_id : row.personal_memory_id;
      if (id === undefined) throw new Error("Missing memory ID");
      const updated =
        kind === "server"
          ? await serverMemoryRepository.updateByIdWithLineage(
              id,
              `${row.content} revised`,
              refs.serverId,
              refs.personaLineageId,
            )
          : await personalMemoryRepository.updateByIdForUserAndLineage(
              id,
              `${row.content} revised`,
              refs.userId,
              refs.personaLineageId,
            );
      expect(updated).not.toBeNull();
    }
    const rows = await loadScope(kind);
    expect(rows.find((row) => row.content === "manual fact revised")?.manually_written).toBe(true);
    const unprotected = rows.find((row) => row.content === "model fact revised");
    expect(unprotected?.manually_written).toBe(false);
    if (!unprotected) throw new Error("Missing unprotected memory");
    const modelId = "server_id" in unprotected ? unprotected.server_memory_id : unprotected.personal_memory_id;
    if (modelId === undefined) throw new Error("Missing model ID");
    const edited =
      kind === "server"
        ? await serverMemoryRepository.edit(modelId, unprotected.content, ["222222222222222222"], {
            manuallyWritten: true,
          })
        : await personalMemoryRepository.edit(modelId, unprotected.content, ["archive"], { manuallyWritten: true });
    expect(edited).toBe(true);
    if (kind === "server") await testSql`UPDATE server_memories SET decay_days = 20 WHERE server_id = ${refs.serverId}`;
    else await testSql`UPDATE personal_memories SET decay_days = 20 WHERE user_id = ${refs.userId}`;
    expect((await loadScope(kind)).every((row) => row.manually_written && row.decay_days === 20)).toBe(true);
    expect(await saveModel(kind, "cannot fit")).toMatchObject({ status: "refused", currentCount: 2, limit: 2 });
    expect((await loadScope(kind)).map((row) => row.content).sort()).toEqual([
      "manual fact revised",
      "model fact revised",
    ]);
  });

  it.each([
    "server",
    "personal",
  ] as const)("marks manual %s batches protected while ordinary batches stay unprotected", async (kind) => {
    process.env.MAX_SERVER_MEMORIES = "4";
    process.env.MAX_PERSONAL_MEMORIES = "4";
    for (const manual of [false, true]) {
      const options = manual ? { manuallyWritten: true as const } : undefined;
      const content = manual ? "manual batch fact" : "ordinary batch fact";
      const inserted =
        kind === "server"
          ? await serverMemoryRepository.addBatch(
              refs.serverId,
              refs.personaId,
              refs.personaLineageId,
              refs.userId,
              [content],
              [],
              options,
            )
          : await personalMemoryRepository.addBatch(refs.userId, refs.personaLineageId, [content], [], options);
      expect(inserted).toBe(true);
      expect((await loadScope(kind)).find((row) => row.content === content)?.manually_written).toBe(manual);
    }
  });

  it("protects aged model saves when turn embeddings or RAG are unavailable", async () => {
    process.env.MAX_SERVER_MEMORIES = "1";
    process.env.MAX_PERSONAL_MEMORIES = "1";
    const server = await insertServer(20);
    const personal = await insertPersonal(20);
    try {
      for (const embeddingResolved of [false, true]) {
        if (embeddingResolved) resetRagAvailabilityCache();
        expect(
          await serverMemoryRepository.addWithEviction(
            refs.serverId,
            refs.personaId,
            refs.personaLineageId,
            refs.userId,
            "new server fact",
            embeddingResolved,
          ),
        ).toMatchObject({ status: "refused" });
        expect(
          await personalMemoryRepository.addWithEviction(
            refs.userId,
            refs.personaLineageId,
            "new personal fact",
            embeddingResolved,
          ),
        ).toMatchObject({ status: "refused" });
      }
      expect(
        (await serverMemoryRepository.loadServerMemoriesScoped(refs.serverId, refs.personaLineageId))[0]
          ?.server_memory_id,
      ).toBe(server);
      expect(
        (await personalMemoryRepository.loadForUserLineage(refs.userId, refs.personaLineageId))[0]?.personal_memory_id,
      ).toBe(personal);
      process.env.MAX_SERVER_MEMORIES = "2";
      process.env.MAX_PERSONAL_MEMORIES = "2";
      process.env.MEMORY_DECAY_ENABLED = "false";
      expect(
        await serverMemoryRepository.addWithEviction(
          refs.serverId,
          refs.personaId,
          refs.personaLineageId,
          refs.userId,
          "new server fact",
          false,
        ),
      ).toMatchObject({ status: "saved", evicted: null });
      expect(
        await personalMemoryRepository.addWithEviction(refs.userId, refs.personaLineageId, "new personal fact", false),
      ).toMatchObject({ status: "saved", evicted: null });
    } finally {
      await detectRagAvailability();
    }
  });

  it("repairs legacy vector constraints and deletes server and personal endpoints without deleting memories", async () => {
    if (!rag) return;
    const schemaPath = path.join(process.cwd(), "src/db/schema_rag.sql");
    await executeTestSqlFile(schemaPath);
    await testSql`ALTER TABLE memory_embeddings DROP CONSTRAINT memory_embeddings_embedding_model_id_fkey`;
    await testSql`ALTER TABLE memory_embeddings ADD CONSTRAINT memory_embeddings_embedding_model_id_fkey
      FOREIGN KEY (embedding_model_id) REFERENCES embedding_models(embedding_model_id) ON DELETE RESTRICT`;
    try {
      await executeTestSqlFile(schemaPath);
      await executeTestSqlFile(schemaPath);
      const server = await insertServer();
      const personal = await insertPersonal();
      for (const kind of ["server", "personal"] as const) {
        const saved = await registerCustomEndpoint({
          scope:
            kind === "server"
              ? { kind, ownerId: refs.serverId, baseConfig: createServerConfig() }
              : { kind, ownerId: refs.userId },
          label: "memory-vectors",
          capability: "embedding",
          apiStyle: "openai-compatible",
          endpointUrl: "https://embeddings.example.invalid/v1",
          modelName: "fixture-embedding",
        });
        if (!saved?.modelId || !saved.customEndpoint.connection_id) throw new Error("Missing endpoint fixture");
        const modelId = saved.modelId;
        for (const memory of [
          { kind: "server" as const, id: server },
          { kind: "personal" as const, id: personal },
        ]) {
          expect(
            await memoryDecayRepository.upsertVector(
              memory,
              saved.provider,
              modelId,
              [1, 0, 0],
              memory.kind === "server" ? "stored fact" : "personal fact",
            ),
          ).toBe(true);
        }
        const deleted =
          kind === "server"
            ? await llmProviderRepo.deleteServerCustomEndpointConnectionGroup(refs.serverId, [
                saved.customEndpoint.connection_id,
              ])
            : await llmProviderRepo.deleteUserCustomEndpointConnectionGroup(refs.userId, [
                saved.customEndpoint.connection_id,
              ]);
        expect(deleted).toBe(true);
        expect(await testSql`SELECT 1 FROM embedding_models WHERE embedding_model_id = ${modelId}`).toHaveLength(0);
        expect(await testSql`SELECT 1 FROM memory_embeddings WHERE embedding_model_id = ${modelId}`).toHaveLength(0);
        const config =
          kind === "server"
            ? await llmProviderRepo.loadSavedProviderConfig(refs.serverId, saved.provider)
            : await llmProviderRepo.loadUserSavedProviderConfig(refs.userId, saved.provider);
        expect(config).toBeNull();
      }
      expect(
        (await serverMemoryRepository.loadServerMemoriesScoped(refs.serverId, refs.personaLineageId))[0]
          ?.server_memory_id,
      ).toBe(server);
      expect(
        (await personalMemoryRepository.loadForUserLineage(refs.userId, refs.personaLineageId))[0]?.personal_memory_id,
      ).toBe(personal);
    } finally {
      await executeTestSqlFile(schemaPath);
    }
  });

  it("edits preserve decay metadata on databases without vector storage", async () => {
    const server = await insertServer(9, true);
    const personal = await insertPersonal(11, true);
    expect(await serverMemoryRepository.edit(server, "edited fact", [])).toBe(true);
    expect(await personalMemoryRepository.edit(personal, "edited personal fact")).toBe(true);
    expect(
      (await serverMemoryRepository.loadServerMemoriesScoped(refs.serverId, refs.personaLineageId))[0],
    ).toMatchObject({ decay_days: 9, manually_written: true });
    expect((await personalMemoryRepository.loadForUserLineage(refs.userId, refs.personaLineageId))[0]).toMatchObject({
      decay_days: 11,
      manually_written: true,
    });
  });

  it("migration keeps the newest hundred per scope and protects globals retained by any lineage", async () => {
    await testSql`INSERT INTO server_memories (server_id, persona_lineage_id, content, created_at)
      SELECT ${refs.serverId}, ${refs.personaLineageId}, 'fact', NOW() + n * INTERVAL '1 second' FROM generate_series(1, 102) n`;
    await testSql`INSERT INTO personal_memories (user_id, persona_lineage_id, content, created_at)
      SELECT ${refs.userId}, 0, 'global fact', NOW() + n * INTERVAL '1 second' FROM generate_series(1, 102) n`;
    await executeTestSqlFile(path.join(process.cwd(), "src/db/migrations/135_memory_decay.sql"));
    const serverRows = await serverMemoryRepository.loadServerMemoriesScoped(refs.serverId, refs.personaLineageId);
    expect(serverRows.every((row) => !row.manually_written)).toBe(true);
    expect(serverRows.map((row) => row.decay_days)).toEqual([
      ...Array(100).fill(0),
      MEMORY_DORMANT_DAYS,
      MEMORY_DORMANT_DAYS,
    ]);
    let personalRows = await personalMemoryRepository.loadForUserLineage(refs.userId, 0);
    expect(personalRows.map((row) => row.decay_days)).toEqual([
      ...Array(100).fill(0),
      MEMORY_DORMANT_DAYS,
      MEMORY_DORMANT_DAYS,
    ]);
    await testSql`INSERT INTO personal_memories (user_id, persona_lineage_id, content, created_at)
      SELECT ${refs.userId}, ${refs.personaLineageId}, 'specific fact', NOW() + (n + 200) * INTERVAL '1 second' FROM generate_series(1, 101) n`;
    await insertPersonal(0, false, refs.personaLineageId + 1);
    await executeTestSqlFile(path.join(process.cwd(), "src/db/migrations/135_memory_decay.sql"));
    personalRows = await personalMemoryRepository.loadForUserLineage(refs.userId, 0);
    expect(personalRows.filter((row) => row.decay_days === 0)).toHaveLength(100);
    expect(
      (await personalMemoryRepository.loadForUserLineage(refs.userId, refs.personaLineageId, false)).map(
        (row) => row.decay_days,
      ),
    ).toEqual([...Array(100).fill(0), MEMORY_DORMANT_DAYS]);
    await testSql`INSERT INTO personal_memories (user_id, persona_lineage_id, content, created_at)
      SELECT ${refs.userId}, ${refs.personaLineageId + 1}, 'another specific fact', NOW() + (n + 400) * INTERVAL '1 second' FROM generate_series(1, 100) n`;
    await executeTestSqlFile(path.join(process.cwd(), "src/db/migrations/135_memory_decay.sql"));
    expect(
      (await personalMemoryRepository.loadForUserLineage(refs.userId, 0)).every(
        (row) => row.decay_days === MEMORY_DORMANT_DAYS,
      ),
    ).toBe(true);
  });

  it("exports content without decay state or vectors on every memory export surface", async () => {
    await insertServer(14, true);
    await insertPersonal(14, true);
    const exports = await Promise.all([
      exportRepository.exportPersonalData(FIXTURE_IDS.userDiscId, refs.personaLineageId),
      exportRepository.exportServerData(FIXTURE_IDS.serverDiscId),
      exportRepository.exportWorkspaceMemories(FIXTURE_IDS.serverDiscId, { mode: "all" }),
      exportRepository.exportPersonalMemories(FIXTURE_IDS.userDiscId, { mode: "all" }),
    ]);
    for (const exported of exports) {
      expect(exported.success).toBe(true);
      const text = JSON.stringify(exported.data);
      for (const key of ["decay_days", "decay_counted_on", "reinforced_on", "manually_written", "embedding"])
        expect(text).not.toContain(`"${key}"`);
    }
  });

  it("scores within one family, fills vectors once, and removes every family on content edits and deletion", async () => {
    if (!rag) return;
    await executeTestSqlFile(path.join(process.cwd(), "src/db/schema_rag.sql"));
    const [model] = await testSql`SELECT embedding_model_id FROM embedding_models LIMIT 1`;
    const server = await insertServer();
    const personal = await insertPersonal();
    const candidates = { serverMemoryIds: [server], personalMemoryIds: [personal] };
    expect(await memoryDecayRepository.findMissingVectors(candidates, "test-family")).toHaveLength(2);
    const vectors = await Promise.all(
      [1, 2].map(() =>
        memoryDecayRepository.upsertVector(
          { kind: "server", id: server },
          "test-family",
          model.embedding_model_id,
          [1, 0, 0],
          "stored fact",
        ),
      ),
    );
    expect(vectors.sort()).toEqual([false, true]);
    await memoryDecayRepository.upsertVector(
      { kind: "personal", id: personal },
      "test-family",
      model.embedding_model_id,
      [0, 1, 0],
      "personal fact",
    );
    expect(await memoryDecayRepository.scoreCandidates([1, 0, 0], "test-family", candidates)).toEqual([
      { kind: "server", id: server, similarity: 1 },
    ]);
    expect(await memoryDecayRepository.scoreCandidates([1, 0, 0], "other-family", candidates)).toEqual([]);
    expect(await memoryDecayRepository.findMissingVectors(candidates, "test-family")).toEqual([]);
    for (const kind of ["server", "personal"] as const) {
      const id = kind === "server" ? server : personal;
      const original = kind === "server" ? "stored fact" : "personal fact";
      await memoryDecayRepository.upsertVector(
        { kind, id },
        "second-family",
        model.embedding_model_id,
        [1, 0, 0],
        original,
      );
      if (kind === "server")
        await serverMemoryRepository.updateByIdWithLineage(id, "changed", refs.serverId, refs.personaLineageId);
      else
        await personalMemoryRepository.updateByIdForUserAndLineage(id, "changed", refs.userId, refs.personaLineageId);
      expect(await memoryDecayRepository.findMissingVectors(candidates, "test-family")).toContainEqual({
        kind,
        id,
        content: "changed",
      });
      expect(
        await memoryDecayRepository.upsertVector(
          { kind, id },
          "test-family",
          model.embedding_model_id,
          [1, 0, 0],
          original,
        ),
      ).toBe(false);
      await memoryDecayRepository.upsertVector(
        { kind, id },
        "test-family",
        model.embedding_model_id,
        [1, 0, 0],
        "changed",
      );
      if (kind === "server") await serverMemoryRepository.edit(id, "changed again", []);
      else await personalMemoryRepository.edit(id, "changed again");
      expect(await memoryDecayRepository.findMissingVectors(candidates, "test-family")).toContainEqual({
        kind,
        id,
        content: "changed again",
      });
      await memoryDecayRepository.upsertVector(
        { kind, id },
        "test-family",
        model.embedding_model_id,
        [1, 0, 0],
        "changed again",
      );
    }

    const similarIds: number[] = [];
    for (const similarity of [0.4, 0.6, 0.7, 0.8, 0.9]) {
      const id = await insertServer();
      similarIds.push(id);
      await memoryDecayRepository.upsertVector(
        { kind: "server", id },
        "test-family",
        model.embedding_model_id,
        [similarity, Math.sqrt(1 - similarity ** 2), 0],
        "stored fact",
      );
    }
    const top = await memoryDecayRepository.scoreCandidates([1, 0, 0], "test-family", {
      ...empty,
      serverMemoryIds: similarIds,
    });
    expect(top.map((row) => row.id)).toEqual(similarIds.slice(-3).reverse());
    expect(top.every((row) => row.similarity >= 0.5)).toBe(true);
    expect(
      await memoryDecayRepository.scoreCandidates([1, 0, 0], "test-family", {
        ...empty,
        serverMemoryIds: [similarIds[0]],
      }),
    ).toEqual([]);
    const floorId = await insertServer();
    await memoryDecayRepository.upsertVector(
      { kind: "server", id: floorId },
      "test-family",
      model.embedding_model_id,
      [0.5, Math.sqrt(0.75), 0],
      "stored fact",
    );
    const floor = await memoryDecayRepository.scoreCandidates([1, 0, 0], "test-family", {
      ...empty,
      serverMemoryIds: [floorId],
    });
    expect(floor.map((memory) => memory.id)).toEqual([floorId]);
    resetRagAvailabilityCache();
    expect(await memoryDecayRepository.scoreCandidates([], "test-family", candidates)).toEqual([]);
    expect(await memoryDecayRepository.findMissingVectors(candidates, "test-family")).toEqual([]);
    expect(
      await memoryDecayRepository.upsertVector(
        { kind: "server", id: server },
        "test-family",
        model.embedding_model_id,
        [],
        "changed again",
      ),
    ).toBe(false);
    await detectRagAvailability();
    await serverMemoryRepository.remove(server);
    await personalMemoryRepository.remove(personal);
    const [count] =
      await testSql`SELECT count(*) AS count FROM memory_embeddings WHERE server_memory_id = ${server} OR personal_memory_id = ${personal}`;
    expect(Number(count.count)).toBe(0);
  });
});
