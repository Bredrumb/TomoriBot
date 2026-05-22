/**
 * Regression harness - persona preset imports.
 *
 * Covers compatibility with Tomori preset exports created before the schema
 * normalization branch moved trigger_words out of server config tables.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { PresetExportData } from "@/types/preset/presetExport";
import { presetRepository } from "@/utils/db/repositories";
import { FIXTURE_IDS, cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("Preset import - regression", () => {
  let refs: FixtureRefs;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
  });

  afterAll(async () => {
    await cleanupFixtures(testSql);
  });

  it("imports normalized main-branch preset trigger words into persona_configs", async () => {
    const presetData: PresetExportData = {
      tomori_nickname: "_rt_imported_persona",
      attribute_list: ["_rt_import_attr"],
      sample_dialogues_in: ["_rt_user_line"],
      sample_dialogues_out: ["_rt_persona_line"],
      trigger_words: ['"_rt_legacy_trigger"', "`_rt_legacy_trigger`", "_rt_second_legacy_trigger"],
      persona_prompt: "_rt_persona_prompt",
      persona_lineage_id: refs.personaLineageId,
      nai_tags: [],
      nai_char_ref_url: null,
      nai_attg_author: null,
      nai_attg_title: null,
      nai_attg_tags: null,
      nai_attg_genre: null,
      nai_attg_stars: null,
    };

    const result = await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, presetData, "preserve");

    expect(result.success).toBe(true);

    const [personaConfig] = await testSql<Array<{ trigger_words: string[]; persona_prompt: string | null }>>`
      SELECT trigger_words, persona_prompt
      FROM persona_configs
      WHERE persona_id = ${refs.personaId}
      LIMIT 1
    `;

    expect(personaConfig?.trigger_words).toEqual(["_rt_legacy_trigger", "_rt_second_legacy_trigger"]);
    expect(personaConfig?.persona_prompt).toBe("_rt_persona_prompt");
  });
});
