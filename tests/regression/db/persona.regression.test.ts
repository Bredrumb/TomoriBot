/**
 * Regression harness — PersonaRepository domain.
 *
 * Covers: loadTomoriState, loadAllPersonasForServer, loadPersonaConfigRow,
 * updateTomori.
 *
 * Requires: a local Postgres connection (see docs/guides/testing-db-changes.md)
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { personaRepository } from "@/utils/db/repositories";
import { FIXTURE_IDS, cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("Persona — regression", () => {
  let refs: FixtureRefs;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
  });

  afterAll(async () => {
    await cleanupFixtures(testSql);
  });

  // ── loadTomoriState ───────────────────────────────────────────────────────

  it("loadTomoriState returns null for unknown server", async () => {
    const state = await personaRepository.loadState("_rt_unknown_server_9999");
    expect(state).toBeNull();
  });

  it("loadTomoriState assembles a valid TomoriState for the fixture server", async () => {
    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    expect(state).not.toBeNull();
    expect(state?.persona_id).toBe(refs.personaId);
    // Config should load the server-scoped row
    expect(state?.config).not.toBeNull();
    // LLM should be populated (unconfigured LLM is used when llm_id is NULL)
    expect(state?.llm).not.toBeNull();
  });

  it("loadTomoriState includes a server_memories array for a fresh persona", async () => {
    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    expect(Array.isArray(state?.server_memories)).toBe(true);
  });

  // ── loadAllPersonasForServer ─────────────────────────────────────────────

  it("loadAllPersonasForServer returns at least the main persona", async () => {
    const personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
    expect(personas.length).toBeGreaterThanOrEqual(1);
    const mainPersona = personas.find((p) => !p.is_alter);
    expect(mainPersona).not.toBeUndefined();
    expect(mainPersona?.persona_id).toBe(refs.personaId);
  });

  it("loadAllPersonasForServer returns empty array for unknown server", async () => {
    const personas = await personaRepository.loadAllForServer("_rt_unknown_server_9999");
    expect(personas).toHaveLength(0);
  });

  it("swapPersona promotes the alter row without mixing persona details", async () => {
    const alterName = `_rt_swap_alter_${Date.now()}`;
    const mainAttribute = "_rt_main_attr";
    const alterAttribute = "_rt_alter_attr";
    let alterPersonaId: number | null = null;

    await testSql`
      UPDATE personas
      SET
        attribute_list = ARRAY[${mainAttribute}]::TEXT[],
        sample_dialogues_in = ARRAY['_rt_main_in']::TEXT[],
        sample_dialogues_out = ARRAY['_rt_main_out']::TEXT[]
      WHERE persona_id = ${refs.personaId}
    `;

    const [alterRow] = await testSql<Array<{ persona_id: number }>>`
      INSERT INTO personas (
        server_id,
        persona_nickname,
        attribute_list,
        sample_dialogues_in,
        sample_dialogues_out,
        is_alter
      )
      VALUES (
        ${refs.serverId},
        ${alterName},
        ARRAY[${alterAttribute}]::TEXT[],
        ARRAY['_rt_alter_in']::TEXT[],
        ARRAY['_rt_alter_out']::TEXT[],
        true
      )
      RETURNING persona_id
    `;
    alterPersonaId = alterRow.persona_id;

    try {
      const swapped = await personaRepository.swapPersona(refs.personaId, alterPersonaId);
      expect(swapped).toBe(true);

      const personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
      const promotedAlter = personas.find((persona) => persona.persona_id === alterPersonaId);
      const formerMain = personas.find((persona) => persona.persona_id === refs.personaId);

      expect(promotedAlter?.is_alter).toBe(false);
      expect(promotedAlter?.persona_nickname).toBe(alterName);
      expect(promotedAlter?.attribute_list).toContain(alterAttribute);
      expect(promotedAlter?.sample_dialogues_in).toContain("_rt_alter_in");
      expect(promotedAlter?.sample_dialogues_out).toContain("_rt_alter_out");

      expect(formerMain?.is_alter).toBe(true);
      expect(formerMain?.persona_nickname).toBe("_rt_persona");
      expect(formerMain?.attribute_list).toContain(mainAttribute);
      expect(formerMain?.sample_dialogues_in).toContain("_rt_main_in");
      expect(formerMain?.sample_dialogues_out).toContain("_rt_main_out");
    } finally {
      if (alterPersonaId !== null) {
        await personaRepository.swapPersona(alterPersonaId, refs.personaId);
        await testSql`DELETE FROM personas WHERE persona_id = ${alterPersonaId}`;
      }

      await testSql`
        UPDATE personas
        SET
          attribute_list = ARRAY[]::TEXT[],
          sample_dialogues_in = ARRAY[]::TEXT[],
          sample_dialogues_out = ARRAY[]::TEXT[]
        WHERE persona_id = ${refs.personaId}
      `;
    }
  });

  it("addSampleDialoguePair appends TEXT[] dialogue arrays", async () => {
    await testSql`
      UPDATE personas
      SET
        sample_dialogues_in = ARRAY[]::TEXT[],
        sample_dialogues_out = ARRAY[]::TEXT[]
      WHERE persona_id = ${refs.personaId}
    `;

    const added = await personaRepository.addSampleDialoguePair(refs.personaId, ["_rt_added_in"], ["_rt_added_out"]);
    expect(added).toBe(true);

    const [row] = await testSql<Array<{ sample_dialogues_in: string[]; sample_dialogues_out: string[] }>>`
      SELECT sample_dialogues_in, sample_dialogues_out
      FROM personas
      WHERE persona_id = ${refs.personaId}
    `;

    expect(row.sample_dialogues_in).toEqual(["_rt_added_in"]);
    expect(row.sample_dialogues_out).toEqual(["_rt_added_out"]);
  });

  it("attribute helpers keep persona_attributes and attribute_list mirrored", async () => {
    try {
      expect(
        await personaRepository.replaceAttributes(refs.personaId, ["_rt_private", "_rt_public"], [false, true]),
      ).toBe(true);

      let personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
      let persona = personas.find((item) => item.persona_id === refs.personaId);
      expect(persona?.attribute_list).toEqual(["_rt_private", "_rt_public"]);
      expect(persona?.persona_attributes.map((attribute) => attribute.is_public)).toEqual([false, true]);

      expect(await personaRepository.addAttributes(refs.personaId, ["_rt_added_public"], true)).toBe(true);
      expect(await personaRepository.editAttributeAt(refs.personaId, 1, "_rt_private_edited", true)).toBe(true);
      expect(await personaRepository.removeAttributeAt(refs.personaId, 2)).toBe(true);

      personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
      persona = personas.find((item) => item.persona_id === refs.personaId);
      expect(persona?.attribute_list).toEqual(["_rt_private_edited", "_rt_added_public"]);
      expect(persona?.persona_attributes.map((attribute) => attribute.is_public)).toEqual([true, true]);

      const [mirrorRow] = await testSql<Array<{ attribute_list: string[] }>>`
        SELECT attribute_list
        FROM personas
        WHERE persona_id = ${refs.personaId}
      `;
      expect(mirrorRow.attribute_list).toEqual(["_rt_private_edited", "_rt_added_public"]);
    } finally {
      await personaRepository.replaceAttributes(refs.personaId, []);
    }
  });

  it("preset public-flag rebase preserves locally appended tail flags", async () => {
    const [row] = await testSql<Array<{ flags: boolean[] }>>`
      SELECT persona_preset_rebase_bool_array(
        ARRAY[false, true, true]::BOOLEAN[],
        ARRAY['_rt_old_base', '_rt_local_public', '_rt_local_public_2']::TEXT[],
        ARRAY['_rt_old_base']::TEXT[],
        ARRAY[true, false]::BOOLEAN[]
      ) AS flags
    `;

    expect(row.flags).toEqual([true, false, true, true]);
  });

  // ── loadPersonaConfigRow ─────────────────────────────────────────────────

  it("loadPersonaConfigRow returns the fixture persona_config row", async () => {
    const config = await personaRepository.loadPersonaConfig(refs.personaId);
    expect(config).not.toBeNull();
    expect(config?.persona_id).toBe(refs.personaId);
    expect(config?.trigger_words).toContain("_rt_trigger");
  });

  it("loadPersonaConfigRow returns null for unknown persona", async () => {
    const config = await personaRepository.loadPersonaConfig(999_999_999);
    expect(config).toBeNull();
  });

  it("trigger config writes strip surrounding quote characters", async () => {
    const originalConfig = await personaRepository.loadPersonaConfig(refs.personaId);
    const originalTriggers = [...(originalConfig?.trigger_words ?? [])];

    try {
      const added = await personaRepository.addTrigger(refs.personaId, [
        '"_rt_quoted_trigger"',
        "`_rt_quoted_trigger`",
        "'_rt_second_quoted_trigger'",
      ]);
      expect(added).toBe(true);

      const config = await personaRepository.loadPersonaConfig(refs.personaId);
      expect(config?.trigger_words).toContain("_rt_quoted_trigger");
      expect(config?.trigger_words).toContain("_rt_second_quoted_trigger");
      expect(config?.trigger_words).not.toContain('"_rt_quoted_trigger"');
      expect(config?.trigger_words).not.toContain("`_rt_quoted_trigger`");
    } finally {
      await personaRepository.removeTrigger(refs.personaId, originalTriggers);
    }
  });

  // ── updateTomori ─────────────────────────────────────────────────────────

  it("updateTomori mutates the nickname and returns the updated row", async () => {
    const updated = await personaRepository.update(refs.personaId, { persona_nickname: "_rt_persona_renamed" });
    expect(updated).not.toBeNull();
    expect(updated?.persona_nickname).toBe("_rt_persona_renamed");
  });

  it("loadAllPersonasForServer reflects the nickname change", async () => {
    const personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
    const main = personas.find((p) => p.persona_id === refs.personaId);
    expect(main?.persona_nickname).toBe("_rt_persona_renamed");
  });
});
