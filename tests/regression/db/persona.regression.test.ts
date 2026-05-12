/**
 * Regression harness — PersonaRepository domain.
 *
 * Covers: loadTomoriState, loadAllPersonasForServer, loadPersonaConfigRow,
 * updateTomori.
 *
 * Requires: POSTGRES_DB=tomodb_test (see docs/guides/testing-db-changes.md)
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { loadAllPersonasForServer, loadPersonaConfigRow, loadTomoriState } from "@/utils/db/repositories";
import { updateTomori } from "@/utils/db/repositories";
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
    const state = await loadTomoriState("_rt_unknown_server_9999");
    expect(state).toBeNull();
  });

  it("loadTomoriState assembles a valid TomoriState for the fixture server", async () => {
    const state = await loadTomoriState(FIXTURE_IDS.serverDiscId);
    expect(state).not.toBeNull();
    expect(state?.tomori_id).toBe(refs.tomoriId);
    // Config should load the server-scoped row
    expect(state?.config).not.toBeNull();
    // LLM should be populated (unconfigured LLM is used when llm_id is NULL)
    expect(state?.llm).not.toBeNull();
  });

  it("loadTomoriState includes a server_memories array for a fresh persona", async () => {
    const state = await loadTomoriState(FIXTURE_IDS.serverDiscId);
    expect(Array.isArray(state?.server_memories)).toBe(true);
  });

  // ── loadAllPersonasForServer ─────────────────────────────────────────────

  it("loadAllPersonasForServer returns at least the main persona", async () => {
    const personas = await loadAllPersonasForServer(FIXTURE_IDS.serverDiscId);
    expect(personas.length).toBeGreaterThanOrEqual(1);
    const mainPersona = personas.find((p) => !p.is_alter);
    expect(mainPersona).not.toBeUndefined();
    expect(mainPersona?.tomori_id).toBe(refs.tomoriId);
  });

  it("loadAllPersonasForServer returns empty array for unknown server", async () => {
    const personas = await loadAllPersonasForServer("_rt_unknown_server_9999");
    expect(personas).toHaveLength(0);
  });

  // ── loadPersonaConfigRow ─────────────────────────────────────────────────

  it("loadPersonaConfigRow returns the fixture persona_config row", async () => {
    const config = await loadPersonaConfigRow(refs.tomoriId);
    expect(config).not.toBeNull();
    expect(config?.tomori_id).toBe(refs.tomoriId);
    expect(config?.trigger_words).toContain("_rt_trigger");
  });

  it("loadPersonaConfigRow returns null for unknown persona", async () => {
    const config = await loadPersonaConfigRow(999_999_999);
    expect(config).toBeNull();
  });

  // ── updateTomori ─────────────────────────────────────────────────────────

  it("updateTomori mutates the nickname and returns the updated row", async () => {
    const updated = await updateTomori(refs.tomoriId, { tomori_nickname: "_rt_persona_renamed" });
    expect(updated).not.toBeNull();
    expect(updated?.tomori_nickname).toBe("_rt_persona_renamed");
  });

  it("loadAllPersonasForServer reflects the nickname change", async () => {
    const personas = await loadAllPersonasForServer(FIXTURE_IDS.serverDiscId);
    const main = personas.find((p) => p.tomori_id === refs.tomoriId);
    expect(main?.tomori_nickname).toBe("_rt_persona_renamed");
  });
});
