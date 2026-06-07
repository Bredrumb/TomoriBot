import type { SQL } from "bun";
import { personaSections } from "./personas";
import { str, textArray } from "./sql";
import type { PersonaInput } from "./types";

const OFFICIAL_LINEAGE_IDS = new Set<number>([4, 716, 1770, 3585, 50]); // 1337 (Zaya) pending

const PERSONA_COLUMNS =
  "persona_preset_name, persona_preset_desc, preset_attribute_list, preset_sample_dialogues_in, preset_sample_dialogues_out, preset_language, preset_avatar_path, preset_trigger_words, preset_lineage_id";

const PERSONA_ON_CONFLICT = `ON CONFLICT (persona_preset_name) DO UPDATE SET
  persona_preset_desc = EXCLUDED.persona_preset_desc,
  preset_attribute_list = EXCLUDED.preset_attribute_list,
  preset_sample_dialogues_in = EXCLUDED.preset_sample_dialogues_in,
  preset_sample_dialogues_out = EXCLUDED.preset_sample_dialogues_out,
  preset_language = EXCLUDED.preset_language,
  preset_avatar_path = EXCLUDED.preset_avatar_path,
  preset_trigger_words = EXCLUDED.preset_trigger_words,
  preset_lineage_id = EXCLUDED.preset_lineage_id,
  updated_at = CURRENT_TIMESTAMP`;

const OFFICIAL_ATTRIBUTE_FLAGS_UPDATE = `WITH official_attribute_flags AS (
  SELECT
    pp.persona_preset_id,
    ARRAY(
      SELECT (attr.ord = 1)
      FROM unnest(COALESCE(pp.preset_attribute_list, ARRAY[]::TEXT[]))
        WITH ORDINALITY AS attr(attribute_text, ord)
      ORDER BY attr.ord
    )::BOOLEAN[] AS public_flags
  FROM persona_presets pp
  WHERE pp.preset_lineage_id IN (4, 716, 1770, 3585, 50)
)
UPDATE persona_presets pp
SET
  preset_attribute_public_flags = official_attribute_flags.public_flags,
  updated_at = CURRENT_TIMESTAMP
FROM official_attribute_flags
WHERE pp.persona_preset_id = official_attribute_flags.persona_preset_id
  AND pp.preset_attribute_public_flags IS DISTINCT FROM official_attribute_flags.public_flags`;

function rowsOf(): PersonaInput[] {
  return personaSections.flatMap((section) => section.rows);
}

function renderPersonaTuple(preset: PersonaInput): string {
  return [
    str(preset.name),
    str(preset.desc),
    textArray(preset.attributes),
    textArray(preset.sampleDialoguesIn),
    textArray(preset.sampleDialoguesOut),
    str(preset.language),
    str(preset.avatarPath),
    textArray(preset.triggerWords),
    String(preset.lineageId),
  ].join(", ");
}

export function validatePersonas(): string[] {
  const errors: string[] = [];
  const rows = rowsOf();
  const seenNames = new Set<string>();
  const seenOfficialLineages = new Set<number>();

  for (const preset of rows) {
    if (seenNames.has(preset.name)) {
      errors.push(`persona_presets: duplicate persona_preset_name ${preset.name}`);
    }
    seenNames.add(preset.name);

    if (preset.sampleDialoguesIn.length !== preset.sampleDialoguesOut.length) {
      errors.push(
        `persona_presets/${preset.name}: preset_sample_dialogues_in length ${preset.sampleDialoguesIn.length} does not match preset_sample_dialogues_out length ${preset.sampleDialoguesOut.length}`,
      );
    }

    if (OFFICIAL_LINEAGE_IDS.has(preset.lineageId)) {
      seenOfficialLineages.add(preset.lineageId);
      if (preset.attributes.length === 0) {
        errors.push(`persona_presets/${preset.name}: official lineage ${preset.lineageId} has no attributes`);
      }
    }
  }

  for (const lineageId of OFFICIAL_LINEAGE_IDS) {
    if (!seenOfficialLineages.has(lineageId)) {
      errors.push(`persona_presets: missing official lineage ${lineageId}`);
    }
  }

  return errors;
}

export function buildPersonaSeedStatements(): string[] {
  const values = rowsOf()
    .map((preset) => `  (${renderPersonaTuple(preset)})`)
    .join(",\n");

  return [
    `INSERT INTO persona_presets (${PERSONA_COLUMNS})\nVALUES\n${values}\n${PERSONA_ON_CONFLICT}`,
    OFFICIAL_ATTRIBUTE_FLAGS_UPDATE,
  ];
}

export async function seedPersonasFromCatalog(client: SQL): Promise<void> {
  const violations = validatePersonas();
  if (violations.length > 0) {
    throw new Error(`Persona catalog invariant violations:\n  - ${violations.join("\n  - ")}`);
  }

  for (const statement of buildPersonaSeedStatements()) {
    await client.unsafe(statement);
  }
}
