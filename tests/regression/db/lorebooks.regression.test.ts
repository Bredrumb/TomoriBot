import { SQL } from "bun";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { LorebookRepository, lorebookRepository } from "@/modules/lorebooks/db/repositories";
import { LOREBOOK_ENTRIES_PER_SCOPE_MAX, type LorebookEntryInput } from "@/modules/lorebooks/db/types";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

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
    await testSql`INSERT INTO persona_lorebook_entries (server_id, title, content, constant) VALUES (${refs.serverId}, 'bad', ' ', true)`;
    expect(await lorebookRepository.listScope(refs.serverId, null)).toEqual({ status: "unavailable", entries: [] });
    expect(await lorebookRepository.loadEnabledForScope(refs.serverId, null)).toEqual([]);
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
