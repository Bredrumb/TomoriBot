import { readFile } from "node:fs/promises";
import type { TransactionSQL } from "bun";
import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Client } from "discord.js";
import { lorebookRepository } from "@/modules/lorebooks/db/repositories";
import { lorebookEntryToInput, type LorebookEntryInput } from "@/modules/lorebooks/db/types";
import { taggedMemoryToLorebook } from "@/modules/lorebooks/imports";
import { parseExportFile, getServerExportSchema, type MemoryBucket } from "@/types/db/dataExport";
import type { PresetExportData } from "@/types/preset/presetExport";
import {
  exportRepository,
  importRepository,
  personaRepository,
  presetRepository,
  serverMemoryRepository,
} from "@/utils/db/repositories";
import { splitSqlStatements } from "@/utils/db/sqlSplitter";
import { importAlterPreset } from "@/utils/persona/importAlterPreset";
import { buildMemoryImportMappings } from "@/utils/discord/interactions/transferRoutes";
import { cleanupFixtures, FIXTURE_IDS, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const CHANNEL = "100000000000000001";
const ROLLBACK = new Error("fixture rollback");

function lore(patch: Partial<LorebookEntryInput> = {}): LorebookEntryInput {
  const entry = taggedMemoryToLorebook({ content: "The manor overlooks the sea.", tags: ["manor"] }, true);
  if (!entry) throw new Error("Missing fixture lore");
  return { ...entry, ...patch };
}

function card(patch: Partial<PresetExportData> = {}): PresetExportData {
  return {
    tomori_nickname: "Mirri",
    attribute_list: ["An archivist."],
    sample_dialogues_in: [],
    sample_dialogues_out: [],
    trigger_words: ["mirri"],
    ...patch,
  };
}

async function migration(tx: Pick<TransactionSQL, "unsafe">, down = false): Promise<void> {
  const sql = await readFile(
    `src/db/migrations/123_lorebook_entries_from_tagged_memories${down ? ".down" : ""}.sql`,
    "utf8",
  );
  for (const statement of splitSqlStatements(sql)) await tx.unsafe(statement);
}

async function rolledBack(body: (tx: TransactionSQL) => Promise<void>): Promise<void> {
  try {
    await testSql.begin(async (tx) => {
      await body(tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

describe.skipIf(!DB_TESTS_AVAILABLE)("lorebook migration and transfer", () => {
  let refs: FixtureRefs;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
  });
  beforeEach(async () => {
    await testSql`DELETE FROM legacy_channel_scope_tags WHERE server_id = ${refs.serverId}`;
    await testSql`DELETE FROM persona_lorebook_entries WHERE server_id = ${refs.serverId}`;
    await testSql`DELETE FROM server_memories WHERE server_id = ${refs.serverId}`;
    await testSql`DELETE FROM personas WHERE server_id = ${refs.serverId} AND is_alter`;
    await testSql`UPDATE personas SET persona_nickname = '_rt_persona', persona_lineage_id = ${refs.personaLineageId},
      is_pointer = false, preset_lineage_id = NULL WHERE persona_id = ${refs.personaId}`;
  });
  afterAll(async () => {
    await testSql`DELETE FROM legacy_channel_scope_tags WHERE server_id = ${refs.serverId}`;
    await cleanupFixtures(testSql);
  });

  it("moves only keyword memories, reruns safely, and restores exact snapshots after edits/deletions", async () => {
    for (const taggingEnabled of [false, true]) {
      await rolledBack(async (tx) => {
        await tx`DROP TABLE IF EXISTS lorebook_migration_123_backup`;
        await tx`UPDATE server_memory_configs SET memory_tagging_enabled = ${taggingEnabled} WHERE server_id = ${refs.serverId}`;
        const [keyword] = await tx`INSERT INTO server_memories
          (server_id, persona_id, persona_lineage_id, user_id, content, tags, channel_disc_ids, created_at, updated_at)
          VALUES (${refs.serverId}, ${refs.personaId}, ${refs.personaLineageId}, ${refs.userId}, 'Keyword lore',
            ARRAY[' "manor" ', 'manor', '  '], ARRAY[${CHANNEL}], '2001-01-01', '2002-01-01') RETURNING *`;
        const [mixed] = await tx`INSERT INTO server_memories (server_id, persona_lineage_id, content, tags)
          VALUES (${refs.serverId}, ${refs.personaLineageId}, 'Pending lore', ARRAY['night']) RETURNING *`;
        await tx`INSERT INTO legacy_channel_scope_tags (source_table, row_id, server_id, channel_tags)
          VALUES ('server_memories', ${mixed.server_memory_id}, ${refs.serverId}, ARRAY['#hall'])`;
        const [plain] =
          await tx`INSERT INTO server_memories (server_id, persona_lineage_id, content, tags, channel_disc_ids)
          VALUES (${refs.serverId}, ${refs.personaLineageId}, 'Channel only', ARRAY['#hall'], ARRAY[${CHANNEL}]) RETURNING *`;
        const [blank] = await tx`INSERT INTO server_memories (server_id, persona_lineage_id, content, tags)
          VALUES (${refs.serverId}, ${refs.personaLineageId}, 'Blank tags', ${tx.array(["  ", '""', "\t\n", "\u00A0"], "TEXT")}) RETURNING *`;
        await tx`CREATE TABLE IF NOT EXISTS documents (document_id SERIAL PRIMARY KEY, server_id INT, document_name TEXT NOT NULL, text_content TEXT NOT NULL, channel_disc_ids TEXT[])`;
        const [document] = await tx`INSERT INTO documents (server_id, document_name, text_content, channel_disc_ids)
          VALUES (${refs.serverId}, 'Reference', 'Reference text', ARRAY[${CHANNEL}]) RETURNING document_id`;
        await tx`INSERT INTO legacy_channel_scope_tags (source_table, row_id, server_id, channel_tags)
          VALUES ('documents', ${document.document_id}, ${refs.serverId}, ARRAY['#hall'])`;

        await migration(tx);
        const first =
          await tx`SELECT * FROM persona_lorebook_entries WHERE server_id = ${refs.serverId} ORDER BY entry_id`;
        expect(first).toHaveLength(2);
        expect(first[0]).toMatchObject({
          persona_lineage_id: String(refs.personaLineageId),
          keys: ["manor"],
          constant: !taggingEnabled,
          scan_depth: 5,
          channel_disc_ids: [CHANNEL],
          created_at: keyword.created_at,
        });
        expect<unknown>(
          await tx`SELECT * FROM server_memories WHERE server_id = ${refs.serverId} ORDER BY server_memory_id`,
        ).toEqual([plain, blank]);
        expect<unknown>(
          await tx`SELECT document_id FROM documents WHERE document_id = ${document.document_id}`,
        ).toHaveLength(1);
        expect<unknown>(
          await tx`SELECT channel_tags FROM legacy_channel_scope_tags WHERE source_table = 'persona_lorebook_entries'
          AND row_id = ${first[1].entry_id}`,
        ).toEqual([{ channel_tags: ["#hall"] }]);
        await migration(tx);
        expect<unknown>(
          await tx`SELECT * FROM persona_lorebook_entries WHERE server_id = ${refs.serverId} ORDER BY entry_id`,
        ).toEqual(first);

        await tx`UPDATE persona_lorebook_entries SET content = 'Edited later' WHERE entry_id = ${first[0].entry_id}`;
        await tx`DELETE FROM persona_lorebook_entries WHERE entry_id = ${first[1].entry_id}`;
        const [newLore] = await tx`INSERT INTO persona_lorebook_entries (server_id, title, content, constant)
          VALUES (${refs.serverId}, 'New', 'Authored later', true) RETURNING *`;
        await migration(tx, true);
        expect<unknown>(
          await tx`SELECT * FROM server_memories WHERE server_memory_id IN (${keyword.server_memory_id}, ${mixed.server_memory_id})
          ORDER BY server_memory_id`,
        ).toEqual([keyword, mixed]);
        expect<unknown>(await tx`SELECT * FROM persona_lorebook_entries WHERE server_id = ${refs.serverId}`).toEqual([
          newLore,
        ]);
        expect<unknown>(
          await tx`SELECT channel_tags, resolved_at FROM legacy_channel_scope_tags WHERE source_table = 'server_memories'
          AND row_id = ${mixed.server_memory_id}`,
        ).toEqual([{ channel_tags: ["#hall"], resolved_at: null }]);
        await migration(tx, true);
      });
    }
  });

  it("rolls the entire migration back if a later row cannot fit", async () => {
    await rolledBack(async (tx) => {
      await tx`DROP TABLE IF EXISTS lorebook_migration_123_backup`;
      await tx`INSERT INTO server_memories (server_id, persona_lineage_id, content, tags) VALUES
        (${refs.serverId}, ${refs.personaLineageId}, 'Valid', ARRAY['key']),
        (${refs.serverId}, ${refs.personaLineageId}, ${`${"x".repeat(3999)}\u{1f319}`}, ARRAY['key'])`;
      await expect(
        tx.savepoint(async (savepoint) => {
          await migration(savepoint);
        }),
      ).rejects.toThrow();
      expect<unknown>(
        await tx`SELECT server_memory_id FROM server_memories WHERE server_id = ${refs.serverId}`,
      ).toHaveLength(2);
      expect<unknown>(
        await tx`SELECT entry_id FROM persona_lorebook_entries WHERE server_id = ${refs.serverId}`,
      ).toHaveLength(0);
    });
  });

  it("round-trips persona lore and distinguishes absent and explicitly empty payloads", async () => {
    const entries = [
      lore({ enabled: false, channel_disc_ids: [CHANNEL], placement: 1 }),
      lore({ constant: true, keys: [] }),
    ];
    expect(
      (await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, card({ lorebook_entries: entries }))).success,
    ).toBe(true);
    const exported = await presetRepository.exportPresetData(FIXTURE_IDS.serverDiscId);
    expect(exported.success).toBe(true);
    if (!exported.success) return;
    expect(exported.data.data.lorebook_entries).toEqual(entries);
    expect((await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, card())).success).toBe(true);
    expect((await lorebookRepository.listScope(refs.serverId, refs.personaLineageId)).entries).toHaveLength(2);
    expect(
      (await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, card({ lorebook_entries: [] }))).success,
    ).toBe(true);
    expect((await lorebookRepository.listScope(refs.serverId, refs.personaLineageId)).entries).toHaveLength(0);
    expect((await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, exported.data.data)).success).toBe(true);
    expect(
      (await lorebookRepository.listScope(refs.serverId, refs.personaLineageId)).entries.map(lorebookEntryToInput),
    ).toEqual(entries);
  });

  it("guards rollback attribution after deletion and refuses occupied original identifiers", async () => {
    await rolledBack(async (tx) => {
      await tx`DROP TABLE IF EXISTS lorebook_migration_123_backup`;
      const [memory] =
        await tx`INSERT INTO server_memories (server_id, persona_id, persona_lineage_id, user_id, content, tags)
        VALUES (${refs.serverId}, ${refs.personaId}, ${refs.personaLineageId}, ${refs.userId}, 'Original', ARRAY['key']) RETURNING server_memory_id`;
      const [otherServer] =
        await tx`INSERT INTO servers (server_disc_id) VALUES ('_rt_lore_deleted_server') RETURNING server_id`;
      await tx`INSERT INTO server_memories (server_id, persona_lineage_id, content, tags)
        VALUES (${otherServer.server_id}, ${refs.personaLineageId}, 'Deleted server', ARRAY['key'])`;
      await migration(tx);
      await tx`INSERT INTO server_memories (server_memory_id, server_id, persona_lineage_id, content)
        VALUES (${memory.server_memory_id}, ${refs.serverId}, ${refs.personaLineageId}, 'New occupant')`;
      await expect(
        tx.savepoint(async (savepoint) => {
          await migration(savepoint, true);
        }),
      ).rejects.toThrow();
      expect<unknown>(
        await tx`SELECT content FROM server_memories WHERE server_memory_id = ${memory.server_memory_id}`,
      ).toEqual([{ content: "New occupant" }]);
      await tx`DELETE FROM server_memories WHERE server_memory_id = ${memory.server_memory_id}`;
      await tx`DELETE FROM users WHERE user_id = ${refs.userId}`;
      await tx`DELETE FROM personas WHERE persona_id = ${refs.personaId}`;
      await tx`DELETE FROM servers WHERE server_id = ${otherServer.server_id}`;
      await migration(tx, true);
      expect<unknown>(
        await tx`SELECT user_id, persona_id FROM server_memories WHERE server_memory_id = ${memory.server_memory_id}`,
      ).toEqual([{ user_id: null, persona_id: null }]);
      expect<unknown>(
        await tx`SELECT server_memory_id FROM server_memories WHERE server_id = ${otherServer.server_id}`,
      ).toHaveLength(0);
    });
  });

  it("preserves the previous book on failed main replacement and refuses unavailable exports", async () => {
    await lorebookRepository.insert(refs.serverId, refs.personaLineageId, lore());
    const replacement = spyOn(lorebookRepository, "replaceLineageEntries").mockResolvedValue("failed");
    try {
      expect(
        (await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, card({ lorebook_entries: [] }))).success,
      ).toBe(false);
    } finally {
      replacement.mockRestore();
    }
    expect(
      (await lorebookRepository.listScope(refs.serverId, refs.personaLineageId)).entries.map(lorebookEntryToInput),
    ).toEqual([lore()]);
    const read = spyOn(lorebookRepository, "listScope").mockResolvedValue({ status: "unavailable", entries: [] });
    try {
      expect((await presetRepository.exportPresetData(FIXTURE_IDS.serverDiscId)).success).toBe(false);
    } finally {
      read.mockRestore();
    }
  });

  it("round-trips combined server-data lore and preserves absent arrays", async () => {
    await lorebookRepository.insert(refs.serverId, refs.personaLineageId, lore({ enabled: false }));
    await lorebookRepository.insert(refs.serverId, null, lore({ constant: true }));
    const exported = await exportRepository.exportServerData(FIXTURE_IDS.serverDiscId, refs.personaId);
    expect(exported.success).toBe(true);
    const serverExport = getServerExportSchema().parse(exported.data);
    const parsed = parseExportFile(serverExport);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !("memories" in parsed.payload)) throw new Error("Missing combined memories");
    const firstBucket: MemoryBucket = parsed.payload.memories.buckets[0];
    expect(firstBucket.lorebook_entries).toHaveLength(1);
    expect(
      (await importRepository.importServerData(FIXTURE_IDS.serverDiscId, serverExport.data, refs.personaId)).success,
    ).toBe(true);
    expect(
      (await lorebookRepository.listScope(refs.serverId, refs.personaLineageId)).entries.map(lorebookEntryToInput),
    ).toEqual([lore({ enabled: false })]);
    const { lorebook_entries, serverwide_lorebook_entries, ...withoutLore } = serverExport.data;
    expect(
      (await importRepository.importServerData(FIXTURE_IDS.serverDiscId, withoutLore, refs.personaId)).success,
    ).toBe(true);
    expect((await lorebookRepository.listScope(refs.serverId, null)).entries).toHaveLength(1);
  });

  it("imports alter lore, preserves it across removal, and cleans up a failed alter replacement", async () => {
    const params = {
      client: { user: null } as unknown as Client,
      guild: null,
      serverDiscId: FIXTURE_IDS.serverDiscId,
      presetData: card({
        tomori_nickname: "Juno",
        persona_lineage_id: refs.personaLineageId + 99,
        lorebook_entries: [lore()],
      }),
      identityMode: "preserve" as const,
      avatarImageBuffer: null,
    };
    const result = await importAlterPreset(params);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const exported = await presetRepository.exportPresetData(FIXTURE_IDS.serverDiscId, result.personaId);
    expect(exported.success && exported.data.data.lorebook_entries).toEqual([lore()]);
    await personaRepository.removePersona(result.personaId);
    const replacement = spyOn(lorebookRepository, "replaceLineageEntries").mockResolvedValue("failed");
    try {
      expect((await importAlterPreset(params)).ok).toBe(false);
    } finally {
      replacement.mockRestore();
    }
    expect<unknown>(
      await testSql`SELECT persona_id FROM personas WHERE server_id = ${refs.serverId} AND is_alter`,
    ).toHaveLength(0);
    expect(
      (await lorebookRepository.listScope(refs.serverId, refs.personaLineageId + 99)).entries.map(lorebookEntryToInput),
    ).toEqual([lore()]);
  });

  it("round-trips workspace books, including orphaned lineages, Serverwide lore, and channel-only memories", async () => {
    const entry = lore({ enabled: false, legacy_channel_tags: ["#hall"] });
    await lorebookRepository.insert(refs.serverId, refs.personaLineageId, entry);
    await lorebookRepository.insert(refs.serverId, null, lore({ constant: true }));
    await lorebookRepository.insert(refs.serverId, refs.personaLineageId + 99, lore());
    await testSql`INSERT INTO server_memories (server_id, persona_lineage_id, content, channel_disc_ids)
      VALUES (${refs.serverId}, ${refs.personaLineageId}, 'Channel memory', ARRAY[${CHANNEL}])`;
    const exported = await exportRepository.exportWorkspaceMemories(FIXTURE_IDS.serverDiscId, { mode: "all" });
    expect(exported.success).toBe(true);
    if (!exported.success) return;
    const parsed = parseExportFile(exported.data);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !("buckets" in parsed.payload)) return;
    const buckets = parsed.payload.buckets;
    expect(buckets).toHaveLength(2);
    expect(buckets.flatMap((bucket: MemoryBucket) => bucket.lorebook_entries ?? [])).toHaveLength(2);
    const bucket = buckets.find((value) => value.memories.length > 0);
    if (!bucket) throw new Error("Missing memory bucket");
    const mapping = buildMemoryImportMappings(
      "workspace_memories",
      [bucket],
      [{ bucketName: bucket.name, destinationLineageId: refs.personaLineageId }],
      [{ ownership: "workspace", personaId: refs.personaId, lineageId: refs.personaLineageId, label: "Mirri" }],
    );
    if (mapping.status !== "ok" || mapping.kind !== "workspace_memories") throw new Error("Missing mapping");
    const result = await importRepository.importWorkspaceMemoryBundle(
      FIXTURE_IDS.serverDiscId,
      FIXTURE_IDS.userDiscId,
      mapping.mappings,
      "replace",
      "serverwide_lorebook_entries" in parsed.payload ? parsed.payload.serverwide_lorebook_entries : undefined,
    );
    expect(result.success).toBe(true);
    expect(
      (await lorebookRepository.listScope(refs.serverId, refs.personaLineageId)).entries.map(lorebookEntryToInput),
    ).toEqual([entry]);
    expect((await lorebookRepository.listScope(refs.serverId, null)).entries).toHaveLength(1);
    const [importedEntry] = (await lorebookRepository.listScope(refs.serverId, refs.personaLineageId)).entries;
    await serverMemoryRepository.applyLegacyChannelScopes(refs.serverId, [
      { sourceTable: "persona_lorebook_entries", rowId: importedEntry.entry_id, channelDiscIds: [CHANNEL] },
    ]);
    expect((await lorebookRepository.listScope(refs.serverId, refs.personaLineageId)).entries[0]).toMatchObject({
      channel_disc_ids: [CHANNEL],
      legacy_channel_tags: [],
    });
    expect<unknown>(
      await testSql`SELECT channel_disc_ids, tags FROM server_memories WHERE server_id = ${refs.serverId}`,
    ).toEqual([{ channel_disc_ids: [CHANNEL], tags: [] }]);
  });

  it("converts legacy backups with the migration mapping and preserves absent books and personal tags", async () => {
    await lorebookRepository.insert(refs.serverId, refs.personaLineageId, lore());
    const parsed = parseExportFile({
      version: "1.0",
      type: "server_memories",
      exported_at: "fixture",
      data: {
        server_memories: [
          { content: "Channel only", tags: ["#hall"] },
          { content: "Keyword and channel", tags: ["night", "#hall"] },
        ],
      },
    });
    if (!parsed.success || !("buckets" in parsed.payload)) throw new Error("Invalid fixture backup");
    const bucket = parsed.payload.buckets[0];
    const mappings = [{ bucketName: bucket.name, personaId: refs.personaId, memories: bucket.memories }];
    expect(
      (
        await importRepository.importWorkspaceMemoryBundle(
          FIXTURE_IDS.serverDiscId,
          FIXTURE_IDS.userDiscId,
          mappings,
          "replace",
        )
      ).success,
    ).toBe(true);
    expect(
      (
        await importRepository.importWorkspaceMemoryBundle(
          FIXTURE_IDS.serverDiscId,
          FIXTURE_IDS.userDiscId,
          mappings,
          "replace",
        )
      ).success,
    ).toBe(true);
    const entries = (await lorebookRepository.listScope(refs.serverId, refs.personaLineageId)).entries;
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.keys.includes("night"))).toMatchObject({
      constant: true,
      scan_depth: 5,
      legacy_channel_tags: ["#hall"],
    });
    expect<unknown>(
      await testSql`SELECT content, tags FROM server_memories WHERE server_id = ${refs.serverId}`,
    ).toEqual([{ content: "Channel only", tags: [] }]);
    expect(
      (await serverMemoryRepository.loadPendingLegacyChannelScopes(FIXTURE_IDS.serverDiscId))
        .map((row) => row.source_table)
        .sort(),
    ).toEqual(["persona_lorebook_entries", "server_memories"]);
    expect(
      (
        await importRepository.importPersonalMemoryBundle(
          FIXTURE_IDS.userDiscId,
          [
            {
              bucketName: "personal",
              personaLineageId: refs.personaLineageId,
              memories: [{ content: "Personal", tags: ["night"] }],
            },
          ],
          "replace",
        )
      ).success,
    ).toBe(true);
    expect<unknown>(
      await testSql`SELECT tags FROM personal_memories WHERE user_id = ${refs.userId} AND persona_lineage_id = ${refs.personaLineageId}`,
    ).toEqual([{ tags: ["night"] }]);
  });

  it("rolls memory deletes and lore replacement back together on a later failure", async () => {
    await lorebookRepository.insert(refs.serverId, refs.personaLineageId, lore());
    await testSql`INSERT INTO server_memories (server_id, persona_lineage_id, content)
      VALUES (${refs.serverId}, ${refs.personaLineageId}, 'Original memory')`;
    await testSql.unsafe(`CREATE FUNCTION _rt_fail_lorebook_memory() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture insertion failure'; END $$`);
    await testSql.unsafe(`CREATE TRIGGER _rt_fail_lorebook_memory BEFORE INSERT ON server_memories
      FOR EACH ROW WHEN (NEW.content = 'Invalid scope') EXECUTE FUNCTION _rt_fail_lorebook_memory()`);
    let success: boolean;
    try {
      const result = await importRepository.importWorkspaceMemoryBundle(
        FIXTURE_IDS.serverDiscId,
        FIXTURE_IDS.userDiscId,
        [
          {
            bucketName: "main",
            personaId: refs.personaId,
            lorebook_entries: [],
            memories: [{ content: "Invalid scope", tags: [], channel_disc_ids: [CHANNEL] }],
          },
        ],
        "replace",
      );
      success = result.success;
    } finally {
      await testSql`DROP TRIGGER _rt_fail_lorebook_memory ON server_memories`;
      await testSql`DROP FUNCTION _rt_fail_lorebook_memory()`;
    }
    expect(success).toBe(false);
    expect(
      (await lorebookRepository.listScope(refs.serverId, refs.personaLineageId)).entries.map(lorebookEntryToInput),
    ).toEqual([lore()]);
    expect<unknown>(await testSql`SELECT content FROM server_memories WHERE server_id = ${refs.serverId}`).toEqual([
      { content: "Original memory" },
    ]);
  });
});
