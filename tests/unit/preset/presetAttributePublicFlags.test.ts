import { describe, expect, it } from "bun:test";
import {
  buildGeneratedPresetAttributePublicFlags,
  buildPrivateAttributePublicFlags,
  type PresetExportData,
} from "@/types/preset/presetExport";
import { presetRepository } from "@/utils/db/repositories";

describe("preset attribute public flags", () => {
  it("marks the generated appearance attribute public", () => {
    expect(
      buildGeneratedPresetAttributePublicFlags([
        "{bot}'s Description: core identity",
        "{bot}'s Appearance: red hoodie",
        "{bot}'s Personality: sharp, warm",
      ]),
    ).toEqual([false, true, false]);
  });

  it("normalizes legacy preset data without flags to private attributes", () => {
    const legacyPresetData: PresetExportData = {
      tomori_nickname: "Legacy",
      attribute_list: ["Legacy description", "Legacy appearance"],
      sample_dialogues_in: [],
      sample_dialogues_out: [],
      trigger_words: ["Legacy"],
    };

    const validation = presetRepository.validatePresetData(legacyPresetData);

    expect(validation.valid).toBe(true);
    expect(validation.data?.attribute_public_flags).toEqual(buildPrivateAttributePublicFlags(["", ""]));
  });

  it("rejects preset data with misaligned public flags", () => {
    const invalidPresetData: PresetExportData = {
      tomori_nickname: "Mismatch",
      attribute_list: ["One attribute"],
      attribute_public_flags: [true, false],
      sample_dialogues_in: [],
      sample_dialogues_out: [],
      trigger_words: ["Mismatch"],
    };

    const validation = presetRepository.validatePresetData(invalidPresetData);

    expect(validation.valid).toBe(false);
    expect(validation.error).toBe("commands.persona.import.error_attribute_flags_mismatch");
  });
});
