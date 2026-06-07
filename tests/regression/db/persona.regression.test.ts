/**
 * Regression harness — PersonaRepository domain.
 *
 * Covers: loadTomoriState, loadAllPersonasForServer, loadPersonaConfigRow,
 * updateTomori.
 *
 * Requires: a local Postgres connection (see docs/guides/testing-db-changes.md)
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { forkPointerForAvatarChange } from "@/commands/persona/avatar";
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

  it("preset pointers resolve live preset content and fork on first content edit", async () => {
    const presetLineageId = 900_001;
    const presetName = "_rt_pointer_preset";

    try {
      const [preset] = await testSql`
        INSERT INTO persona_presets (
          persona_preset_name,
          persona_preset_desc,
          preset_lineage_id,
          preset_attribute_list,
          preset_attribute_public_flags,
          preset_sample_dialogues_in,
          preset_sample_dialogues_out,
          preset_language,
          preset_trigger_words,
          preset_avatar_path
        )
        VALUES (
          ${presetName},
          '_rt_pointer_prompt_v1',
          ${presetLineageId},
          ARRAY['_rt_pointer_attr_v1']::TEXT[],
          ARRAY[true]::BOOLEAN[],
          ARRAY['_rt_pointer_in_v1']::TEXT[],
          ARRAY['_rt_pointer_out_v1']::TEXT[],
          'en-US',
          ARRAY['_rt_pointer_trigger_v1']::TEXT[],
          NULL
        )
        ON CONFLICT (persona_preset_name) DO UPDATE SET
          persona_preset_desc = EXCLUDED.persona_preset_desc,
          preset_lineage_id = EXCLUDED.preset_lineage_id,
          preset_attribute_list = EXCLUDED.preset_attribute_list,
          preset_attribute_public_flags = EXCLUDED.preset_attribute_public_flags,
          preset_sample_dialogues_in = EXCLUDED.preset_sample_dialogues_in,
          preset_sample_dialogues_out = EXCLUDED.preset_sample_dialogues_out,
          preset_language = EXCLUDED.preset_language,
          preset_trigger_words = EXCLUDED.preset_trigger_words
        RETURNING *
      `;

      const applied = await personaRepository.applyPresetPointerToPersona({
        personaId: refs.personaId,
        nickname: "_rt_pointer_persona",
        preset,
        personaLineageId: presetLineageId,
      });
      expect(applied?.is_pointer).toBe(true);

      await testSql`
        UPDATE persona_presets
        SET
          persona_preset_desc = '_rt_pointer_prompt_v2',
          preset_attribute_list = ARRAY['_rt_pointer_attr_v2']::TEXT[],
          preset_attribute_public_flags = ARRAY[false]::BOOLEAN[],
          preset_sample_dialogues_in = ARRAY['_rt_pointer_in_v2']::TEXT[],
          preset_sample_dialogues_out = ARRAY['_rt_pointer_out_v2']::TEXT[],
          preset_trigger_words = ARRAY['_rt_pointer_trigger_v2']::TEXT[]
        WHERE persona_preset_name = ${presetName}
      `;

      let personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
      let persona = personas.find((item) => item.persona_id === refs.personaId);
      expect(persona?.is_pointer).toBe(true);
      expect(persona?.attribute_list).toEqual(["_rt_pointer_attr_v2"]);
      expect(persona?.persona_attributes.map((attribute) => attribute.is_public)).toEqual([false]);
      expect(persona?.sample_dialogues_in).toEqual(["_rt_pointer_in_v2"]);
      expect(persona?.trigger_words).toEqual(["_rt_pointer_trigger_v2"]);
      expect(persona?.persona_prompt).toBe("_rt_pointer_prompt_v2");

      expect(await personaRepository.addAttributes(refs.personaId, ["_rt_after_fork"], false)).toBe(true);

      const [forkedRow] = await testSql<Array<{ is_pointer: boolean; persona_lineage_id: number | string | bigint }>>`
        SELECT is_pointer, persona_lineage_id
        FROM personas
        WHERE persona_id = ${refs.personaId}
      `;
      expect(forkedRow.is_pointer).toBe(false);
      expect(Number(forkedRow.persona_lineage_id)).toBe(presetLineageId);

      await testSql`
        UPDATE persona_presets
        SET preset_attribute_list = ARRAY['_rt_pointer_attr_v3']::TEXT[]
        WHERE persona_preset_name = ${presetName}
      `;

      personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
      persona = personas.find((item) => item.persona_id === refs.personaId);
      expect(persona?.attribute_list).toEqual(["_rt_pointer_attr_v2", "_rt_after_fork"]);
    } finally {
      await testSql`
        UPDATE personas
        SET
          persona_nickname = '_rt_persona',
          attribute_list = ARRAY[]::TEXT[],
          sample_dialogues_in = ARRAY[]::TEXT[],
          sample_dialogues_out = ARRAY[]::TEXT[],
          is_pointer = false,
          preset_lineage_id = NULL,
          preset_language = NULL
        WHERE persona_id = ${refs.personaId}
      `;
      await testSql`DELETE FROM persona_attributes WHERE persona_id = ${refs.personaId}`;
      await testSql`
        INSERT INTO persona_configs (persona_id, trigger_words, persona_prompt)
        VALUES (${refs.personaId}, ARRAY['_rt_trigger']::TEXT[], NULL)
        ON CONFLICT (persona_id) DO UPDATE SET
          trigger_words = EXCLUDED.trigger_words,
          persona_prompt = EXCLUDED.persona_prompt
      `;
      await testSql`DELETE FROM persona_presets WHERE persona_preset_name = ${presetName}`;
    }
  });

  it("/server avatar materializes a pointer persona before avatar customization", async () => {
    const presetLineageId = 900_002;
    const personaLineageId = 900_102;
    const presetName = "_rt_avatar_pointer_preset";
    const alterName = `_rt_avatar_pointer_alter_${Date.now()}`;
    let alterPersonaId: number | null = null;

    try {
      const [preset] = await testSql`
        INSERT INTO persona_presets (
          persona_preset_name,
          persona_preset_desc,
          preset_lineage_id,
          preset_attribute_list,
          preset_attribute_public_flags,
          preset_sample_dialogues_in,
          preset_sample_dialogues_out,
          preset_language,
          preset_trigger_words,
          preset_avatar_path
        )
        VALUES (
          ${presetName},
          '_rt_avatar_pointer_prompt',
          ${presetLineageId},
          ARRAY['_rt_avatar_pointer_attr']::TEXT[],
          ARRAY[true]::BOOLEAN[],
          ARRAY['_rt_avatar_pointer_in']::TEXT[],
          ARRAY['_rt_avatar_pointer_out']::TEXT[],
          'en-US',
          ARRAY['_rt_avatar_pointer_trigger']::TEXT[],
          NULL
        )
        ON CONFLICT (persona_preset_name) DO UPDATE SET
          persona_preset_desc = EXCLUDED.persona_preset_desc,
          preset_lineage_id = EXCLUDED.preset_lineage_id,
          preset_attribute_list = EXCLUDED.preset_attribute_list,
          preset_attribute_public_flags = EXCLUDED.preset_attribute_public_flags,
          preset_sample_dialogues_in = EXCLUDED.preset_sample_dialogues_in,
          preset_sample_dialogues_out = EXCLUDED.preset_sample_dialogues_out,
          preset_language = EXCLUDED.preset_language,
          preset_trigger_words = EXCLUDED.preset_trigger_words
        RETURNING *
      `;

      const alter = await personaRepository.createPresetPointerAlterPersona({
        serverId: refs.serverId,
        nickname: alterName,
        preset,
        personaLineageId,
      });
      alterPersonaId = alter?.persona_id ?? null;
      expect(alterPersonaId).not.toBeNull();
      expect(alter?.is_pointer).toBe(true);

      const personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
      const selectedPersona = personas.find((item) => item.persona_id === alterPersonaId);
      expect(selectedPersona?.is_pointer).toBe(true);
      if (!selectedPersona || alterPersonaId === null) {
        throw new Error("Expected pointer alter persona to exist before avatar update.");
      }

      expect(await forkPointerForAvatarChange(selectedPersona)).toBe(true);
      expect(await personaRepository.setAvatar(alterPersonaId, "_rt_avatar_pointer_url")).toBe(true);

      const [forkedRow] = await testSql<
        Array<{ is_pointer: boolean; persona_lineage_id: number | string | bigint; webhook_avatar_url: string | null }>
      >`
        SELECT is_pointer, persona_lineage_id, webhook_avatar_url
        FROM personas
        WHERE persona_id = ${alterPersonaId}
      `;

      expect(forkedRow.is_pointer).toBe(false);
      expect(Number(forkedRow.persona_lineage_id)).toBe(personaLineageId);
      expect(forkedRow.webhook_avatar_url).toBe("_rt_avatar_pointer_url");
    } finally {
      if (alterPersonaId !== null) {
        await testSql`DELETE FROM personas WHERE persona_id = ${alterPersonaId}`;
      } else {
        await testSql`DELETE FROM personas WHERE server_id = ${refs.serverId} AND persona_nickname = ${alterName}`;
      }
      await testSql`DELETE FROM persona_presets WHERE persona_preset_name = ${presetName}`;
    }
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
