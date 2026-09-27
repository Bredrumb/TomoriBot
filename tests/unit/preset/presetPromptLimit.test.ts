import { describe, expect, it } from "bun:test";
import {
  PRESET_EXPORT_VERSION,
  PRESET_MAX_PERSONA_PROMPT_LENGTH,
  PRESET_MAX_STRING_LENGTH,
  presetExportSchema,
} from "@/types/preset/presetExport";
import { presetRepository } from "@/utils/db/repositories";
import { combineModalPromptParts } from "@/utils/text/modalPromptParts";

describe("preset persona prompt limit", () => {
  it("imports the longest prompt the config editor can save", () => {
    const prompt = combineModalPromptParts(
      ["a".repeat(3999), "b".repeat(3999), "c".repeat(3999), "d".repeat(4000)],
      4000,
    );
    const preset = {
      version: PRESET_EXPORT_VERSION,
      type: "preset" as const,
      exported_at: new Date().toISOString(),
      data: {
        tomori_nickname: "Mirri",
        attribute_list: [],
        sample_dialogues_in: [],
        sample_dialogues_out: [],
        trigger_words: [],
        persona_prompt: prompt,
      },
    };

    expect(prompt.length).toBe(PRESET_MAX_PERSONA_PROMPT_LENGTH);
    expect(presetExportSchema.safeParse(preset).success).toBe(true);
    expect(presetRepository.validatePresetFile(preset).data?.persona_prompt).toBe(prompt);
    expect(
      presetExportSchema.safeParse({
        ...preset,
        data: { ...preset.data, persona_prompt: `${prompt}x` },
      }).success,
    ).toBe(false);
    expect(
      presetExportSchema.safeParse({
        ...preset,
        data: { ...preset.data, attribute_list: ["a".repeat(PRESET_MAX_STRING_LENGTH + 1)] },
      }).success,
    ).toBe(false);
  });
});
