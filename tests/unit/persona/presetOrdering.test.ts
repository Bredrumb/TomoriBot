import { describe, expect, it } from "bun:test";
import { orderPersonaPresetChoices } from "@/utils/persona/presetOrdering";

describe("persona preset choices", () => {
  it("moves the official default first and preserves the other choices' order", () => {
    const presets = [
      { persona_preset_name: "Bratty", preset_lineage_id: 716 },
      { persona_preset_name: "Default-inspired", preset_lineage_id: null },
      { persona_preset_name: "Default Tomori", preset_lineage_id: 4 },
      { persona_preset_name: "Gloomy", preset_lineage_id: 1770 },
    ];

    expect(orderPersonaPresetChoices(presets).map((preset) => preset.persona_preset_name)).toEqual([
      "Default Tomori",
      "Bratty",
      "Default-inspired",
      "Gloomy",
    ]);
    expect(presets[0].persona_preset_name).toBe("Bratty");
  });

  it("leaves choices unchanged when the official default is absent", () => {
    const presets = [
      { persona_preset_name: "Gloomy", preset_lineage_id: 1770 },
      { persona_preset_name: "Default-inspired", preset_lineage_id: null },
    ];

    expect(orderPersonaPresetChoices(presets)).toEqual(presets);
  });
});
