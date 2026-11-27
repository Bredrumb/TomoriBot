import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  customIdleNudgeRowSchema,
  isKnownPrerequisite,
  isNudgeToolName,
  personaAuthoredIdleNudgesSchema,
} from "@/modules/natural-nudges/db/types";
import { splitSqlStatements } from "@/utils/db/sqlSplitter";
import { createCustomIdleNudge } from "../../helpers/fixtures";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const migration = "src/db/migrations/146_remove_stm_tool_path";
const retiredTool = "update_short_term_memory";
const retiredPrerequisite = `tool:${retiredTool}`;
const historicalTimestamp = "2020-01-01T00:00:00Z";

describe.skipIf(!DB_TESTS_AVAILABLE)("STM tool removal migration", () => {
  let fixtures: FixtureRefs;

  beforeAll(async () => {
    await setupTestDb();
    fixtures = await insertFixtures(testSql);
  });

  afterAll(async () => {
    await cleanupFixtures(testSql);
  });

  it("cleans all Natural Nudge stores while preserving other values and list order", async () => {
    const custom = createCustomIdleNudge({
      server_id: fixtures.serverId,
      enabled: false,
      prerequisites: ["tool:web_search", "presence_activity"],
      recommended_tools: ["web_search", "create_thread"],
    });
    const { category, title, brief, agenda_hint, prerequisites, recommended_tools, enabled } = custom;
    const first = { id: "riddle", category, title, brief, agenda_hint, prerequisites, recommended_tools };
    const second = { ...first, id: "story", title: "Story", prerequisites: [], recommended_tools: [] };
    const originalPrerequisites = [prerequisites[0], retiredPrerequisite, prerequisites[1]];
    const originalTools = [recommended_tools[0], retiredTool, recommended_tools[1]];
    const legacyNudges = [{ ...first, prerequisites: originalPrerequisites, recommended_tools: originalTools }, second];
    const statements = splitSqlStatements(await Bun.file(`${migration}.sql`).text());
    const rollback = new Error("Roll back migrated fixtures");

    try {
      await testSql.begin(async (tx) => {
        const [insertedCustom] = await tx`
          INSERT INTO server_natural_nudge_custom_idle_nudges AS nudge (
            server_id, category, title, brief, agenda_hint, prerequisites, recommended_tools, enabled, updated_at
          ) VALUES (
            ${fixtures.serverId}, ${category}, ${title}, ${brief}, ${agenda_hint},
            ${tx.array(originalPrerequisites, "TEXT")}, ${tx.array(originalTools, "TEXT")}, ${enabled},
            ${historicalTimestamp}::timestamptz
          ) RETURNING to_jsonb(nudge) AS row
        `;
        const [insertedPreset] = await tx`
          INSERT INTO persona_presets AS preset (
            persona_preset_name, persona_preset_desc, preset_language, natural_nudge_idle_nudges
          ) VALUES ('_rt_stm_tool_nudge_preset', 'Riddle', 'en-US', ${legacyNudges}::jsonb)
          RETURNING to_jsonb(preset) AS row
        `;
        const [insertedConfig] = await tx`
          INSERT INTO persona_natural_nudge_configs AS config (
            persona_id, authored_idle_nudges, disabled_idle_nudge_ids, updated_at
          ) VALUES (${fixtures.personaId}, ${legacyNudges}::jsonb, '["story"]', ${historicalTimestamp}::timestamptz)
          RETURNING to_jsonb(config) AS row
        `;

        expect(personaAuthoredIdleNudgesSchema.safeParse(legacyNudges).success).toBe(false);
        for (const statement of statements) await tx.unsafe(statement);

        const [migratedCustom] = await tx`
          SELECT to_jsonb(nudge) AS row FROM server_natural_nudge_custom_idle_nudges AS nudge
          WHERE custom_idle_nudge_id = ${insertedCustom.row.custom_idle_nudge_id}
        `;
        expect(migratedCustom.row).toEqual({ ...insertedCustom.row, prerequisites, recommended_tools });
        const parsedCustom = customIdleNudgeRowSchema.parse(migratedCustom.row);
        expect(parsedCustom.prerequisites.every(isKnownPrerequisite)).toBe(true);
        expect(parsedCustom.recommended_tools.every(isNudgeToolName)).toBe(true);

        const [migratedPreset] = await tx`
          SELECT to_jsonb(preset) AS row FROM persona_presets AS preset
          WHERE persona_preset_id = ${insertedPreset.row.persona_preset_id}
        `;
        const [migratedConfig] = await tx`
          SELECT to_jsonb(config) AS row FROM persona_natural_nudge_configs AS config
          WHERE persona_id = ${fixtures.personaId}
        `;
        const expected = [first, second];
        expect(migratedPreset.row).toEqual({ ...insertedPreset.row, natural_nudge_idle_nudges: expected });
        expect(migratedConfig.row).toEqual({ ...insertedConfig.row, authored_idle_nudges: expected });
        expect(personaAuthoredIdleNudgesSchema.parse(migratedPreset.row.natural_nudge_idle_nudges)).toEqual(expected);
        expect(personaAuthoredIdleNudgesSchema.parse(migratedConfig.row.authored_idle_nudges)).toEqual(expected);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });
});
