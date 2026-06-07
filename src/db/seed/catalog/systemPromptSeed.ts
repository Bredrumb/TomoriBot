import type { SQL } from "bun";
import { str } from "./sql";
import { systemPromptSections } from "./systemPrompts";
import type { SystemPromptInput } from "./types";

const SYSTEM_PROMPT_COLUMNS =
  "system_prompt_preset_name, system_prompt_preset_desc, ja_description, preset_prompt_text";

const SYSTEM_PROMPT_ON_CONFLICT = `ON CONFLICT (system_prompt_preset_name) DO UPDATE SET
  system_prompt_preset_desc = EXCLUDED.system_prompt_preset_desc,
  ja_description = EXCLUDED.ja_description,
  preset_prompt_text = EXCLUDED.preset_prompt_text,
  updated_at = CURRENT_TIMESTAMP`;

function rowsOf(): SystemPromptInput[] {
  return systemPromptSections.flatMap((section) => section.rows);
}

function renderSystemPromptTuple(preset: SystemPromptInput): string {
  return [str(preset.name), str(preset.desc), str(preset.jaDescription), str(preset.promptText)].join(", ");
}

export function validateSystemPrompts(): string[] {
  const errors: string[] = [];
  const seenNames = new Set<string>();

  for (const preset of rowsOf()) {
    if (seenNames.has(preset.name)) {
      errors.push(`system_prompt_presets: duplicate system_prompt_preset_name ${preset.name}`);
    }
    seenNames.add(preset.name);

    if (preset.promptText.length === 0) {
      errors.push(`system_prompt_presets/${preset.name}: preset_prompt_text is empty`);
    }
  }

  return errors;
}

export function buildSystemPromptSeedStatements(): string[] {
  const values = rowsOf()
    .map((preset) => `  (${renderSystemPromptTuple(preset)})`)
    .join(",\n");

  return [
    `INSERT INTO system_prompt_presets (${SYSTEM_PROMPT_COLUMNS})\nVALUES\n${values}\n${SYSTEM_PROMPT_ON_CONFLICT}`,
  ];
}

export async function seedSystemPromptsFromCatalog(client: SQL): Promise<void> {
  const violations = validateSystemPrompts();
  if (violations.length > 0) {
    throw new Error(`System prompt catalog invariant violations:\n  - ${violations.join("\n  - ")}`);
  }

  for (const statement of buildSystemPromptSeedStatements()) {
    await client.unsafe(statement);
  }
}
