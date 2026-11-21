import { describe, expect, it } from "bun:test";
import { PERSONA_NICKNAME_MAX_LENGTH } from "@/types/personaNaming";
import type { PresetExportData } from "@/types/preset/presetExport";
import { presetRepository } from "@/utils/db/repositories";

const presetNamed = (name: string): PresetExportData => ({
  tomori_nickname: name,
  attribute_list: ["Description"],
  sample_dialogues_in: [],
  sample_dialogues_out: [],
  trigger_words: [name],
});

describe("preset import nickname limit", () => {
  it("accepts a name at the server nickname cap", () => {
    const validation = presetRepository.validatePresetData(presetNamed("n".repeat(PERSONA_NICKNAME_MAX_LENGTH)));
    expect(validation.valid).toBe(true);
  });

  it("counts astral characters as one, matching Discord", () => {
    const validation = presetRepository.validatePresetData(
      presetNamed("\u{1F338}".repeat(PERSONA_NICKNAME_MAX_LENGTH)),
    );
    expect(validation.valid).toBe(true);
  });

  it("rejects a name past the cap with a localized error carrying the limit", () => {
    const validation = presetRepository.validatePresetData(presetNamed("n".repeat(PERSONA_NICKNAME_MAX_LENGTH + 1)));
    expect(validation.valid).toBe(false);
    expect(validation.error).toBe(`commands.persona.import.error_nickname_too_long|${PERSONA_NICKNAME_MAX_LENGTH}`);
  });
});
