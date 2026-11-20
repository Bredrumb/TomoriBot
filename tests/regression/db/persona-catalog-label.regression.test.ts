import { beforeAll, describe, expect, it } from "bun:test";
import { seedPersonasFromCatalog } from "@/db/seed/catalog/personaSeed";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const HANDED_OVER_LABEL = "メスガキトモリ";
const RENAMED_LABEL = "ツンデレトモリ";

describe.skipIf(!DB_TESTS_AVAILABLE)("persona catalog label handover", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  it("re-seeds a database that still labels 716/ja with the label 256/ja now owns", async () => {
    await seedPersonasFromCatalog(testSql);

    await testSql`
      DELETE FROM persona_presets WHERE preset_lineage_id = 256 AND preset_language = 'ja'
    `;
    await testSql`
      UPDATE persona_presets
      SET persona_preset_name = ${HANDED_OVER_LABEL}
      WHERE preset_lineage_id = 716 AND preset_language = 'ja'
    `;

    await seedPersonasFromCatalog(testSql);

    const rows = await testSql<Array<{ preset_lineage_id: number | string; persona_preset_name: string }>>`
      SELECT preset_lineage_id, persona_preset_name FROM persona_presets
      WHERE preset_language = 'ja' AND preset_lineage_id IN (256, 716)
      ORDER BY preset_lineage_id
    `;

    expect(rows.map((row) => [Number(row.preset_lineage_id), row.persona_preset_name])).toEqual([
      [256, HANDED_OVER_LABEL],
      [716, RENAMED_LABEL],
    ]);
  });
});
