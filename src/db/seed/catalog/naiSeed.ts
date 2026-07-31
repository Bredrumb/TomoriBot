import type { SQL } from "bun";
import { naiPresetSections } from "./naiPresets";
import { bool, jsonb, str } from "./sql";
import type { NaiModelTarget, NaiPresetInput } from "./types";

const NAI_COLUMNS = "preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters";

const NAI_ON_CONFLICT = `ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc`;

const NAI_MODEL_TARGETS: NaiModelTarget[] = ["kayra", "erato"];

function rowsOf(): NaiPresetInput[] {
  return naiPresetSections.flatMap((section) => section.rows);
}

function renderNaiPresetTuple(preset: NaiPresetInput): string {
  return [
    str(preset.name),
    str(preset.modelTarget),
    bool(preset.isDefault),
    str(preset.desc),
    str(preset.jaDesc),
    jsonb(preset.parameters),
  ].join(", ");
}

export function validateNaiPresets(): string[] {
  const errors: string[] = [];
  const seenKeys = new Set<string>();
  const rows = rowsOf();

  for (const preset of rows) {
    const key = `${preset.name}/${preset.modelTarget}`;
    if (seenKeys.has(key)) {
      errors.push(`nai_presets: duplicate row ${key}`);
    }
    seenKeys.add(key);

    if (Object.keys(preset.parameters).length === 0) {
      errors.push(`nai_presets/${key}: parameters is empty`);
    }
  }

  for (const target of NAI_MODEL_TARGETS) {
    const defaults = rows.filter((preset) => preset.modelTarget === target && preset.isDefault);
    if (defaults.length !== 1) {
      errors.push(`nai_presets/${target}: expected exactly one is_default, found ${defaults.length}`);
    }
  }

  return errors;
}

function buildNaiPresetSeedStatements(): string[] {
  return rowsOf().map(
    (preset) => `INSERT INTO nai_presets (${NAI_COLUMNS})
VALUES (${renderNaiPresetTuple(preset)})
${NAI_ON_CONFLICT}`,
  );
}

export async function seedNaiPresetsFromCatalog(client: SQL): Promise<void> {
  const violations = validateNaiPresets();
  if (violations.length > 0) {
    throw new Error(`NAI preset catalog invariant violations:\n  - ${violations.join("\n  - ")}`);
  }

  for (const statement of buildNaiPresetSeedStatements()) {
    await client.unsafe(statement);
  }
}
