import { describe, expect, it } from "bun:test";
import { PRESET_EXPORT_VERSION, presetExportSchema } from "@/types/preset/presetExport";

function presetFile(data: Record<string, unknown>) {
  return {
    version: PRESET_EXPORT_VERSION,
    type: "preset" as const,
    exported_at: "2026-01-01T00:00:00.000Z",
    data: {
      tomori_nickname: "Mirri",
      attribute_list: [],
      sample_dialogues_in: [],
      sample_dialogues_out: [],
      trigger_words: [],
      ...data,
    },
  };
}

describe("preset character reference key", () => {
  it("imports the pre-rename key from older preset files", () => {
    const parsed = presetExportSchema.parse(presetFile({ nai_char_ref_url: "data/charreferences/personas/1/a.png" }));
    expect(parsed.data.char_ref_url).toBe("data/charreferences/personas/1/a.png");
    expect(parsed.data).not.toHaveProperty("nai_char_ref_url");
  });

  it("prefers the current key when a file carries both", () => {
    const parsed = presetExportSchema.parse(
      presetFile({ char_ref_url: "data/charreferences/personas/1/new.png", nai_char_ref_url: "old.png" }),
    );
    expect(parsed.data.char_ref_url).toBe("data/charreferences/personas/1/new.png");
  });
});
