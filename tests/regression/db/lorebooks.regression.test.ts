import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { SQL } from "bun";
import { runMigrations } from "@/db/migrationRunner";
import { resetDatabaseConnection } from "@/utils/db/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { LorebookRepository, lorebookRepository } from "@/modules/lorebooks/db/repositories";
import {
  LOREBOOK_ENTRIES_PER_SCOPE_MAX,
  lorebookEntryToInput,
  type LorebookEntryInput,
} from "@/modules/lorebooks/db/types";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

function input(overrides: Partial<LorebookEntryInput> = {}): LorebookEntryInput {
  return {
    title: "Manor",
    content: "The manor overlooks the sea.",
    keys: ["manor"],
    secondary_keys: [],
    selective_logic: 0,
    scan_depth: 5,
    trigger_chance: 100,
    insertion_order: 100,
    placement: 0,
    constant: false,
    enabled: true,
    channel_disc_ids: [],
    ...overrides,
  };
}

describe.skipIf(!DB_TESTS_AVAILABLE)("lorebook storage contracts", () => {
  let refs: FixtureRefs;
  let otherServer: number;
  let lineage: number;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    lineage = refs.personaLineageId;
    const [row] = await testSql`INSERT INTO servers (server_disc_id) VALUES ('_rt_lorebook_other') RETURNING server_id`;
    otherServer = row.server_id;
  });

  beforeEach(async () => {
    await testSql`DELETE FROM persona_lorebook_entries WHERE server_id IN (${refs.serverId}, ${otherServer})`;
    await testSql`DELETE FROM server_lorebooks WHERE server_id IN (${refs.serverId}, ${otherServer})`;
  });

  afterAll(async () => {
    await testSql`DELETE FROM servers WHERE server_id = ${otherServer}`;
    await cleanupFixtures(testSql);
  });

  async function add(
    scope: number | null,
    patch: Partial<LorebookEntryInput> = {},
    serverId = refs.serverId,
  ): Promise<number> {
    const result = await lorebookRepository.insert(serverId, scope, input(patch));
    if (typeof result !== "number") throw new Error(`Fixture insert failed: ${result}`);
    return result;
  }

  it("wipes only Serverwide lore and its pending scopes when personas are preserved", async () => {
    const discId = "_rt_lorebook_nuke";
    const [server] = await testSql`INSERT INTO servers (server_disc_id) VALUES (${discId}) RETURNING server_id`;
    const serverId: number = server.server_id;
    try {
      const [persona] = await testSql`INSERT INTO personas (server_id, persona_nickname, is_alter)
        VALUES (${serverId}, 'Mirri', false) RETURNING persona_lineage_id`;
      const personaLineage = Number(persona.persona_lineage_id);
      const serverEntry = await add(null, {}, serverId);
      const personaEntry = await add(personaLineage, { legacy_channel_tags: ["#hall"] }, serverId);
      await testSql`INSERT INTO legacy_channel_scope_tags (source_table, row_id, server_id, channel_tags)
        VALUES ('persona_lorebook_entries', ${serverEntry}, ${serverId}, ARRAY['#hall'])`;
      const control = await add(null);
      expect(await serverRepository.nukeServer(serverId, discId, { preservePersonas: true })).toBe(true);
      expect((await lorebookRepository.listScope(serverId, null)).entries).toHaveLength(0);
      expect(await lorebookRepository.listBooks(serverId)).toHaveLength(0);
      expect(
        (await lorebookRepository.listScope(serverId, personaLineage)).entries.map((entry) => entry.entry_id),
      ).toEqual([personaEntry]);
      expect(
        await testSql`SELECT row_id FROM legacy_channel_scope_tags
        WHERE source_table = 'persona_lorebook_entries' AND row_id = ${serverEntry}`,
      ).toHaveLength(0);
      expect(
        await testSql`SELECT row_id FROM legacy_channel_scope_tags
        WHERE source_table = 'persona_lorebook_entries' AND row_id = ${personaEntry}`,
      ).toHaveLength(1);
      expect(
        (await lorebookRepository.listScope(refs.serverId, null)).entries.some((entry) => entry.entry_id === control),
      ).toBe(true);
      expect(await testSql`SELECT persona_id FROM personas WHERE server_id = ${serverId}`).toHaveLength(1);
    } finally {
      await testSql`DELETE FROM legacy_channel_scope_tags WHERE server_id = ${serverId}`;
      await testSql`DELETE FROM servers WHERE server_id = ${serverId}`;
    }
  });

  it("isolates runtime and panel reads and counts disabled entries in each owned scope", async () => {
    const global = await add(null);
    const owned = await add(lineage, { channel_disc_ids: ["100000000000000001"], placement: 1 });
    const disabled = await add(lineage, { enabled: false });
    await add(lineage + 1);
    await add(null, {}, otherServer);
    expect((await lorebookRepository.loadEnabledForScope(refs.serverId, lineage)).map((row) => row.entry_id)).toEqual([
      global,
      owned,
    ]);
    expect((await lorebookRepository.loadEnabledForScope(refs.serverId, null)).map((row) => row.entry_id)).toEqual([
      global,
    ]);
    const listed = await lorebookRepository.listScope(refs.serverId, lineage);
    expect(listed.status).toBe("fresh");
    expect(listed.entries.map((row) => row.entry_id)).toEqual([owned, disabled]);
    expect(listed.entries[0]).toMatchObject({
      persona_lineage_id: lineage,
      placement: 1,
      channel_disc_ids: ["100000000000000001"],
    });
    expect(await lorebookRepository.countsByLineage(refs.serverId)).toEqual(
      new Map([
        [null, 1],
        [lineage, 2],
        [lineage + 1, 1],
      ]),
    );
  });

  it("requires server and lineage ownership for edits, flags and deletion", async () => {
    const id = await add(lineage);
    for (const [serverId, scope] of [
      [otherServer, lineage],
      [refs.serverId, null],
      [refs.serverId, lineage + 1],
    ] as const) {
      expect(await lorebookRepository.update(serverId, scope, id, input({ title: "Changed" }))).toBe("missing");
      expect(await lorebookRepository.setFlags(serverId, scope, id, { enabled: false })).toBe("missing");
      expect(await lorebookRepository.delete(serverId, scope, id)).toBe("missing");
    }
    await testSql`UPDATE persona_lorebook_entries SET updated_at = '2000-01-01' WHERE entry_id = ${id}`;
    expect(
      await lorebookRepository.update(
        refs.serverId,
        lineage,
        id,
        input({ title: "Changed", channel_disc_ids: ["100000000000000001"] }),
      ),
    ).toBe("updated");
    expect(await lorebookRepository.setFlags(refs.serverId, lineage, id, { enabled: false, constant: true })).toBe(
      "updated",
    );
    const [row] = await testSql`SELECT * FROM persona_lorebook_entries WHERE entry_id = ${id}`;
    expect(row).toMatchObject({
      title: "Changed",
      enabled: false,
      constant: true,
      channel_disc_ids: ["100000000000000001"],
    });
    expect(row.updated_at.getTime()).toBeGreaterThan(new Date("2000-01-01").getTime());
    expect(await lorebookRepository.delete(refs.serverId, lineage, id)).toBe("deleted");
    expect(await lorebookRepository.delete(refs.serverId, lineage, id)).toBe("missing");
  });

  it("rejects invalid writes and prevents switching a keyless constant to keywords", async () => {
    const id = await add(null, { constant: true, keys: [] });
    expect(await lorebookRepository.setFlags(refs.serverId, null, id, { constant: false })).toBe("invalid");
    expect(await lorebookRepository.setFlags(refs.serverId, null, id, {})).toBe("invalid");
    expect(await lorebookRepository.insert(refs.serverId, null, input({ keys: [] }))).toBe("invalid");
    expect(await lorebookRepository.update(refs.serverId, null, id, input({ content: "x".repeat(4001) }))).toBe(
      "invalid",
    );
    expect(await lorebookRepository.update(refs.serverId, null, id, input({ channel_disc_ids: ["bad"] }))).toBe(
      "invalid",
    );
    expect(await lorebookRepository.insert(refs.serverId, 0, input())).toBe("invalid");
    expect(await lorebookRepository.delete(refs.serverId, null, -1)).toBe("invalid");
    expect((await lorebookRepository.listScope(refs.serverId, null)).entries[0]).toMatchObject({
      entry_id: id,
      constant: true,
      keys: [],
    });
  });

  it("admits one concurrent insert in the last slot and keeps global and persona limits independent", async () => {
    await testSql`
      INSERT INTO persona_lorebook_entries (server_id, persona_lineage_id, title, content, keys)
      SELECT ${refs.serverId}, ${lineage}, 'filler', 'lore', ARRAY['key'] FROM generate_series(1, ${LOREBOOK_ENTRIES_PER_SCOPE_MAX - 1})
    `;
    const results = await Promise.all([
      lorebookRepository.insert(refs.serverId, lineage, input()),
      lorebookRepository.insert(refs.serverId, lineage, input()),
    ]);
    expect(results.filter((value) => typeof value === "number")).toHaveLength(1);
    expect(results.filter((value) => value === "limit")).toHaveLength(1);
    expect((await lorebookRepository.listScope(refs.serverId, lineage)).entries).toHaveLength(
      LOREBOOK_ENTRIES_PER_SCOPE_MAX,
    );
    await add(null);
    await add(lineage + 1);
    await add(lineage, {}, otherServer);
  });

  it("replaces only the requested lineage, including an empty replacement, without truncating batches", async () => {
    const old = await add(lineage);
    const global = await add(null);
    const other = await add(lineage + 1);
    const batch = Array.from({ length: LOREBOOK_ENTRIES_PER_SCOPE_MAX + 1 }, () => input());
    expect(await lorebookRepository.replaceLineageEntries(refs.serverId, lineage, batch)).toBe("limit");
    expect(await lorebookRepository.replaceLineageEntries(refs.serverId, lineage, [input({ keys: [] })])).toBe(
      "invalid",
    );
    expect((await lorebookRepository.listScope(refs.serverId, lineage)).entries.map((row) => row.entry_id)).toEqual([
      old,
    ]);
    expect(
      await lorebookRepository.replaceLineageEntries(refs.serverId, lineage, [
        input({ enabled: false, constant: true, keys: [], placement: 1 }),
      ]),
    ).toBe("replaced");
    const replaced = (await lorebookRepository.listScope(refs.serverId, lineage)).entries;
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({ enabled: false, constant: true, keys: [], placement: 1 });
    expect(replaced[0].entry_id).not.toBe(old);
    expect(await lorebookRepository.replaceLineageEntries(refs.serverId, lineage, [])).toBe("replaced");
    expect((await lorebookRepository.listScope(refs.serverId, lineage)).entries).toEqual([]);
    expect(
      (await lorebookRepository.loadEnabledForScope(refs.serverId, lineage + 1)).map((row) => row.entry_id),
    ).toEqual([global, other]);
  });

  it("appends only unseen entries and refuses a batch that would cross the scope limit", async () => {
    const existing = await add(null);
    expect(
      await lorebookRepository.appendScopeEntries(refs.serverId, null, [
        input(),
        input({ title: "Harbor", keys: ["harbor"] }),
        input({ title: "Harbor", keys: ["harbor"] }),
      ]),
    ).toEqual({ status: "appended", added: 1, skipped: 2 });
    const listed = (await lorebookRepository.listScope(refs.serverId, null)).entries;
    expect(listed.map((row) => row.title)).toEqual(["Manor", "Harbor"]);
    expect(listed[0].entry_id).toBe(existing);

    await testSql`
      INSERT INTO persona_lorebook_entries (server_id, persona_lineage_id, title, content, keys)
      SELECT ${refs.serverId}, ${lineage}, 'filler', 'lore', ARRAY['key'] FROM generate_series(1, ${LOREBOOK_ENTRIES_PER_SCOPE_MAX - 1})
    `;
    expect(
      await lorebookRepository.appendScopeEntries(refs.serverId, lineage, [
        input({ title: "First", keys: ["first"] }),
        input({ title: "Second", keys: ["second"] }),
      ]),
    ).toEqual({ status: "limit" });
    expect((await lorebookRepository.listScope(refs.serverId, lineage)).entries).toHaveLength(
      LOREBOOK_ENTRIES_PER_SCOPE_MAX - 1,
    );
    expect(await lorebookRepository.appendScopeEntries(refs.serverId, null, [input({ keys: [] })])).toEqual({
      status: "invalid",
    });
  });

  it("serializes replacement with insertion at the scope limit", async () => {
    const batch = Array.from({ length: LOREBOOK_ENTRIES_PER_SCOPE_MAX }, () => input());
    const [replace, insert] = await Promise.all([
      lorebookRepository.replaceLineageEntries(refs.serverId, lineage, batch),
      lorebookRepository.insert(refs.serverId, lineage, input()),
    ]);
    expect(replace).toBe("replaced");
    expect(typeof insert === "number" || insert === "limit").toBe(true);
    expect((await lorebookRepository.listScope(refs.serverId, lineage)).entries).toHaveLength(
      LOREBOOK_ENTRIES_PER_SCOPE_MAX,
    );
  });

  it("rolls back deletion and earlier inserts when a replacement fails in the database", async () => {
    const old = await add(lineage, { channel_disc_ids: ["100000000000000001"] });
    await testSql`ALTER TABLE persona_lorebook_entries ADD CONSTRAINT rt_lore_reject CHECK (title <> '_rt_reject') NOT VALID`;
    try {
      expect(
        await lorebookRepository.replaceLineageEntries(refs.serverId, lineage, [
          input(),
          input({ title: "_rt_reject" }),
        ]),
      ).toBe("failed");
      const listed = await lorebookRepository.listScope(refs.serverId, lineage);
      expect(listed.entries.map((row) => row.entry_id)).toEqual([old]);
      expect(listed.entries[0].channel_disc_ids).toEqual(["100000000000000001"]);
    } finally {
      await testSql`ALTER TABLE persona_lorebook_entries DROP CONSTRAINT rt_lore_reject`;
    }
  });

  it("reports unavailable reads and failed writes on a closed connection", async () => {
    const closed = new SQL("postgres://localhost/unused");
    await closed.close();
    const repo = new LorebookRepository(closed);
    expect(await repo.listScope(refs.serverId, lineage)).toEqual({ status: "unavailable", entries: [] });
    expect(await repo.countsByLineage(refs.serverId)).toBeNull();
    expect(await repo.loadEnabledForScope(refs.serverId, lineage)).toEqual([]);
    expect(await repo.insert(refs.serverId, lineage, input())).toBe("failed");
    expect(await repo.update(refs.serverId, lineage, 1, input())).toBe("failed");
    expect(await repo.setFlags(refs.serverId, lineage, 1, { enabled: false })).toBe("failed");
    expect(await repo.delete(refs.serverId, lineage, 1)).toBe("failed");
    expect(await repo.replaceLineageEntries(refs.serverId, lineage, [])).toBe("failed");
    expect(await repo.appendScopeEntries(refs.serverId, lineage, [input()])).toEqual({ status: "failed" });
  });

  it("fails a scope read as a whole when stored data is unreadable", async () => {
    await add(null);
    await testSql`INSERT INTO persona_lorebook_entries (server_id, lorebook_name, title, content, constant) VALUES (${refs.serverId}, 'General', 'bad', ' ', true)`;
    expect(await lorebookRepository.listScope(refs.serverId, null)).toEqual({ status: "unavailable", entries: [] });
    expect(await lorebookRepository.loadEnabledForScope(refs.serverId, null)).toEqual([]);
  });

  it("imports a new collection atomically and preserves existing books on collision or failure", async () => {
    await add(null, { lorebook_name: "Harbor" });
    const imported = await lorebookRepository.importNewBook(refs.serverId, "Manor", [input(), input()]);
    expect(imported).toMatchObject({ status: "appended", added: 1, skipped: 1 });
    expect(await lorebookRepository.importNewBook(refs.serverId, "Manor", [input({ title: "Other" })])).toEqual({
      status: "exists",
    });
    expect(
      (await lorebookRepository.listScope(refs.serverId, null)).entries
        .filter((entry) => entry.lorebook_name === "Manor")
        .map((entry) => entry.title),
    ).toEqual(["Manor"]);
    expect(await lorebookRepository.importNewBook(refs.serverId, "Invalid", [input({ content: "" })])).toEqual({
      status: "invalid",
    });
    await testSql`ALTER TABLE persona_lorebook_entries ADD CONSTRAINT rt_lore_import_failure CHECK (title <> 'Rejected')`;
    try {
      expect(
        await lorebookRepository.importNewBook(refs.serverId, "Failed", [input(), input({ title: "Rejected" })]),
      ).toEqual({ status: "failed" });
    } finally {
      await testSql`ALTER TABLE persona_lorebook_entries DROP CONSTRAINT rt_lore_import_failure`;
    }
    expect((await lorebookRepository.listBooks(refs.serverId))?.map((book) => book.name)).toEqual(["Harbor", "Manor"]);
    const oversized = Array.from({ length: LOREBOOK_ENTRIES_PER_SCOPE_MAX }, (_, index) =>
      input({ title: `Entry ${index}` }),
    );
    expect(await lorebookRepository.importNewBook(refs.serverId, "Oversized", oversized)).toEqual({ status: "limit" });
    expect((await lorebookRepository.listBooks(refs.serverId))?.some((book) => book.name === "Oversized")).toBe(false);
  });

  it("stores collection controls, preserves entry flags, and restores the controls with lore backups", async () => {
    await add(null);
    await add(null, { title: "Disabled", enabled: false });
    const book = (await lorebookRepository.listBooks(refs.serverId))?.[0];
    if (!book) throw new Error("Collection fixture missing");
    const channel = "100000000000000002";
    expect(await lorebookRepository.setBookEnabled(otherServer, book.lorebook_id, false)).toBe(false);
    expect(await lorebookRepository.setBookChannels(otherServer, book.lorebook_id, [channel])).toBe(false);
    expect(await lorebookRepository.setBookChannels(refs.serverId, book.lorebook_id, ["invalid"])).toBe(false);
    expect(await lorebookRepository.setBookChannels(refs.serverId, book.lorebook_id, [channel])).toBe(true);
    expect(await lorebookRepository.setBookEnabled(refs.serverId, book.lorebook_id, false)).toBe(true);
    expect(await lorebookRepository.loadEnabledForScope(refs.serverId, lineage)).toEqual([]);
    const stored = await lorebookRepository.listScope(refs.serverId, null);
    expect(stored.entries.map((entry) => entry.enabled)).toEqual([true, false]);
    const exported = stored.entries.map(lorebookEntryToInput);
    expect(await lorebookRepository.appendScopeEntries(refs.serverId, null, [input()])).toMatchObject({
      status: "appended",
      added: 0,
      skipped: 1,
    });
    expect(
      await lorebookRepository.replaceScopeEntries(refs.serverId, null, [
        exported[0],
        { ...exported[1], lorebook_enabled: true },
      ]),
    ).toBe("invalid");
    expect((await lorebookRepository.listScope(refs.serverId, null)).entries.map((entry) => entry.entry_id)).toEqual(
      stored.entries.map((entry) => entry.entry_id),
    );

    expect(exported[0]).toMatchObject({
      lorebook_enabled: false,
      lorebook_channel_disc_ids: [channel],
      channel_disc_ids: [],
    });
    await lorebookRepository.setBookEnabled(refs.serverId, book.lorebook_id, true);
    await lorebookRepository.setBookChannels(refs.serverId, book.lorebook_id, []);
    expect(await lorebookRepository.replaceScopeEntries(refs.serverId, null, exported)).toBe("replaced");
    expect((await lorebookRepository.listBooks(refs.serverId))?.[0]).toMatchObject({
      enabled: false,
      channel_disc_ids: [channel],
    });
    await lorebookRepository.setBookEnabled(refs.serverId, book.lorebook_id, true);
    expect(
      (await lorebookRepository.loadEnabledForScope(refs.serverId, lineage)).map((entry) => entry.enabled),
    ).toEqual([true]);
  });

  it("owns collections by server and isolates duplicate detection, replacement, rename, and deletion", async () => {
    const first = await lorebookRepository.createBook(refs.serverId, "Manor");
    const second = await lorebookRepository.createBook(refs.serverId, "Harbor");
    if (first === null || second === null) throw new Error("Collection fixture creation failed");
    expect(await lorebookRepository.createBook(refs.serverId, "Manor")).toBe(first);
    for (const name of ["Manor", "Harbor"]) {
      expect(
        await lorebookRepository.appendScopeEntries(refs.serverId, null, [input({ lorebook_name: name })]),
      ).toMatchObject({ status: "appended", added: 1 });
    }
    expect(
      await lorebookRepository.appendScopeEntries(refs.serverId, null, [input({ lorebook_name: "Manor" })]),
    ).toMatchObject({ added: 0, skipped: 1 });
    expect(
      await lorebookRepository.replaceScopeEntries(
        refs.serverId,
        null,
        [input({ title: "New manor", lorebook_name: "Manor" })],
        undefined,
        "Manor",
      ),
    ).toBe("replaced");
    let listed = await lorebookRepository.listScope(refs.serverId, null);
    expect(listed.entries.filter((entry) => entry.lorebook_name === "Harbor")).toHaveLength(1);
    expect(listed.entries.filter((entry) => entry.lorebook_name === "Manor").map((entry) => entry.title)).toEqual([
      "New manor",
    ]);
    expect(await lorebookRepository.renameBook(otherServer, first, "Stolen")).toBe(false);
    expect(await lorebookRepository.deleteBook(otherServer, second)).toBe(false);
    expect(await lorebookRepository.renameBook(refs.serverId, first, "Estate")).toBe(true);
    listed = await lorebookRepository.listScope(refs.serverId, null);
    expect(listed.entries.some((entry) => entry.lorebook_name === "Estate")).toBe(true);
    const runtime = await lorebookRepository.loadEnabledForScope(refs.serverId, lineage);
    expect(new Set(runtime.map((entry) => entry.lorebook_name))).toEqual(new Set(["Estate", "Harbor"]));
    expect(await lorebookRepository.deleteBook(refs.serverId, first)).toBe(true);
    const stale = input({ lorebook_name: "Estate" });
    expect(await lorebookRepository.insert(refs.serverId, null, stale, undefined, first)).toBe("invalid");
    expect(await lorebookRepository.appendScopeEntries(refs.serverId, null, [stale], undefined, first)).toMatchObject({
      status: "invalid",
    });
    expect(await lorebookRepository.replaceScopeEntries(refs.serverId, null, [stale], undefined, "Estate", first)).toBe(
      "invalid",
    );
    expect((await lorebookRepository.listBooks(refs.serverId))?.some((book) => book.name === "Estate")).toBe(false);
    expect(
      (await lorebookRepository.listScope(refs.serverId, null)).entries.map((entry) => entry.lorebook_name),
    ).toEqual(["Harbor"]);
  });

  it("refuses a collection replacement that would exceed the shared scope limit", async () => {
    await add(null, { lorebook_name: "Harbor" });
    const entries = Array.from({ length: LOREBOOK_ENTRIES_PER_SCOPE_MAX }, (_, index) =>
      input({ title: `Entry ${index}`, lorebook_name: "Manor" }),
    );
    expect(await lorebookRepository.replaceScopeEntries(refs.serverId, null, entries, undefined, "Manor")).toBe(
      "limit",
    );
    expect((await lorebookRepository.listScope(refs.serverId, null)).entries).toHaveLength(1);
  });

  it("backfills old Serverwide rows and refuses rollback when collections or zero chances would be lost", async () => {
    const down = "src/db/migrations/124_server_lorebook_collections.down.sql";
    const up = "src/db/migrations/124_server_lorebook_collections.sql";
    await executeTestSqlFile(down);
    await testSql`INSERT INTO persona_lorebook_entries (server_id, title, content, constant) VALUES (${refs.serverId}, 'Old lore', 'Lore', true)`;
    await testSql`DELETE FROM schema_migrations WHERE name = '124_server_lorebook_collections'`;
    await runMigrations(testSql);
    await executeTestSqlFile(up);
    resetDatabaseConnection();
    const entry = (await lorebookRepository.listScope(refs.serverId, null)).entries[0];
    expect(entry?.lorebook_name).toBe("General");
    await testSql`UPDATE persona_lorebook_entries SET trigger_chance = 0 WHERE entry_id = ${entry.entry_id}`;
    await expect(executeTestSqlFile(down)).rejects.toBeDefined();
    await testSql`UPDATE persona_lorebook_entries SET trigger_chance = 100 WHERE entry_id = ${entry.entry_id}`;
    const general = (await lorebookRepository.listBooks(refs.serverId))?.find((book) => book.name === "General");
    if (!general) throw new Error("Migrated collection missing");
    expect(await lorebookRepository.renameBook(refs.serverId, general.lorebook_id, "Estate")).toBe(true);
    await executeTestSqlFile(up);
    expect((await lorebookRepository.listBooks(refs.serverId))?.some((book) => book.name === "General")).toBe(false);
    await expect(executeTestSqlFile(down)).rejects.toBeDefined();
    expect((await lorebookRepository.listScope(refs.serverId, null)).entries[0]?.entry_id).toBe(entry.entry_id);
  });

  it("retains lineage lore after persona removal and cascades it on server removal", async () => {
    const [persona] =
      await testSql`INSERT INTO personas (server_id, persona_nickname, is_alter) VALUES (${otherServer}, '_rt_lore', true) RETURNING persona_id, persona_lineage_id`;
    const ownLineage = Number(persona.persona_lineage_id);
    const id = await add(ownLineage, {}, otherServer);
    await testSql`DELETE FROM personas WHERE persona_id = ${persona.persona_id}`;
    expect((await lorebookRepository.listScope(otherServer, ownLineage)).entries.map((row) => row.entry_id)).toEqual([
      id,
    ]);
    await testSql`DELETE FROM servers WHERE server_id = ${otherServer}`;
    expect((await lorebookRepository.listScope(otherServer, ownLineage)).entries).toEqual([]);
  });
});
