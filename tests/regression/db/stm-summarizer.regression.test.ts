import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  getShortTermMemoryForServerChannel,
  getShortTermMemoryForUserChannel,
  incrementStmTurnCounter,
  invalidateShortTermMemory,
  persistStmSummarization,
  preWarmStmEntry,
  snapshotStmContent,
  storeShortTermMemory,
} from "@/utils/cache/shortTermMemoryCache";
import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
import { cleanupFixtures, FIXTURE_IDS, type FixtureRefs, insertFixtures } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const migration = path.join(process.cwd(), "src/db/migrations/145_stm_async_summarizer");
const scope = {
  serverId: FIXTURE_IDS.serverDiscId,
  userId: FIXTURE_IDS.userDiscId,
  channelId: "_rt_stm_summarizer_channel",
};

describe.skipIf(!DB_TESTS_AVAILABLE)("STM summarizer storage", () => {
  let fixtures: FixtureRefs;

  beforeAll(async () => {
    await setupTestDb();
    fixtures = await insertFixtures(testSql);
  });

  afterAll(async () => {
    invalidateShortTermMemory(scope.userId, scope.channelId, fixtures.personaId, scope.serverId);
    await testSql`DELETE FROM short_term_memories WHERE channel_disc_id = ${scope.channelId}`;
    await cleanupFixtures(testSql);
  });

  it("reverses the columns and cadence default and reapplies the cadence rewrite", async () => {
    const rollback = new Error("Roll back migration checks");
    const up = await Bun.file(`${migration}.sql`).text();
    const down = await Bun.file(`${migration}.down.sql`).text();
    try {
      await testSql.begin(async (tx) => {
        const [newServer] = await tx<{ server_id: number }[]>`
          INSERT INTO servers (server_disc_id) VALUES ('_rt_stm_cadence_custom') RETURNING server_id
        `;
        await tx.unsafe(down);
        await tx`INSERT INTO server_stm_configs (server_id) VALUES (${fixtures.serverId})`;
        await tx`INSERT INTO server_stm_configs (server_id, refresh_cadence) VALUES (${newServer.server_id}, 17)`;
        const [legacy] =
          await tx`SELECT refresh_cadence FROM server_stm_configs WHERE server_id = ${fixtures.serverId}`;
        expect(legacy.refresh_cadence).toBe(5);
        await tx.unsafe(up);
        const [migrated] = await tx`
          SELECT refresh_cadence, summarizer_instructions_override FROM server_stm_configs WHERE server_id = ${fixtures.serverId}
        `;
        expect(migrated).toMatchObject({ refresh_cadence: 10, summarizer_instructions_override: null });
        const [custom] =
          await tx`SELECT refresh_cadence FROM server_stm_configs WHERE server_id = ${newServer.server_id}`;
        expect(custom.refresh_cadence).toBe(17);
        const [column] = await tx`
          SELECT data_type, is_nullable FROM information_schema.columns
          WHERE table_name = 'short_term_memories' AND column_name = 'summarized_through'
        `;
        expect(column).toMatchObject({ data_type: "timestamp with time zone", is_nullable: "YES" });
        await tx.unsafe(down);
        const [restored] =
          await tx`SELECT refresh_cadence FROM server_stm_configs WHERE server_id = ${fixtures.serverId}`;
        expect(restored.refresh_cadence).toBe(5);
        const removed = await tx`
          SELECT column_name FROM information_schema.columns
          WHERE (table_name = 'server_stm_configs' AND column_name = 'summarizer_instructions_override')
             OR (table_name = 'short_term_memories' AND column_name = 'summarized_through')
        `;
        expect(removed).toHaveLength(0);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });

  it("persists the override and saves and hydrates the cursor for a guild summary", async () => {
    const instructions = "Keep track of unresolved questions.";
    expect(
      await shortTermMemoryRepository.upsertStmConfig(fixtures.serverId, {
        summarizer_instructions_override: instructions,
      }),
    ).toBe(true);
    expect(await shortTermMemoryRepository.toExportShape(scope.serverId)).toMatchObject({
      stm_config: { refresh_cadence: 10, summarizer_instructions_override: instructions },
    });

    const { personaId, personaLineageId } = fixtures;
    const summary = "Juno is deciding what to bring.";
    const marker = 1700000000000;
    await storeShortTermMemory(
      scope.userId,
      scope.channelId,
      [],
      scope.serverId,
      undefined,
      undefined,
      personaId,
      personaLineageId,
    );
    await incrementStmTurnCounter(scope.channelId, scope.serverId, null, personaId);
    const previous = getShortTermMemoryForServerChannel(scope.serverId, scope.channelId, personaId);
    if (!previous) throw new Error("Missing server STM fixture");
    const snapshot = snapshotStmContent(previous);
    await testSql`
      ALTER TABLE short_term_memories ADD CONSTRAINT rt_stm_reset_refusal
      CHECK (channel_disc_id <> '_rt_stm_summarizer_channel' OR last_refreshed_turn = 0)
    `;
    try {
      await expect(persistStmSummarization({ ...scope, personaId }, snapshot, { summary }, marker)).rejects.toThrow();
      const stored = await testSql`
        SELECT summary, summarized_through FROM short_term_memories WHERE channel_disc_id = ${scope.channelId}
      `;
      expect(stored).toEqual([
        { summary: null, summarized_through: null },
        { summary: null, summarized_through: null },
      ]);
      expect(previous.summary).toBeUndefined();
      expect(previous.turnsSinceRefresh).toBe(1);
    } finally {
      await testSql`ALTER TABLE short_term_memories DROP CONSTRAINT rt_stm_reset_refusal`;
    }

    await persistStmSummarization({ ...scope, personaId }, snapshot, { summary }, marker);
    expect(previous).toMatchObject({ summary, summarizedThrough: marker, turnsSinceRefresh: 0, lastRefreshedTurn: 1 });
    expect(getShortTermMemoryForUserChannel(scope.userId, scope.channelId, personaId)).toMatchObject({
      summary,
      summarizedThrough: marker,
    });

    const rows = await testSql`
      SELECT scope_kind, summary, summarized_through, turns_since_refresh, last_refreshed_turn
      FROM short_term_memories WHERE channel_disc_id = ${scope.channelId} ORDER BY scope_kind
    `;
    expect(rows).toEqual([
      {
        scope_kind: "server",
        summary,
        summarized_through: new Date(marker),
        turns_since_refresh: 0,
        last_refreshed_turn: 1,
      },
      {
        scope_kind: "user",
        summary,
        summarized_through: new Date(marker),
        turns_since_refresh: 0,
        last_refreshed_turn: 0,
      },
    ]);

    invalidateShortTermMemory(scope.userId, scope.channelId, personaId, scope.serverId);
    await preWarmStmEntry("server", scope.serverId, scope.channelId, personaId);
    expect(getShortTermMemoryForServerChannel(scope.serverId, scope.channelId, personaId)).toMatchObject({
      summary,
      summarizedThrough: marker,
      turnsSinceRefresh: 0,
    });
  });
});
