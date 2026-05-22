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
