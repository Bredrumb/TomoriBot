import { describe, expect, it } from "bun:test";
import type { TomoriPresetRow } from "@/types/db/schema";
import { EMPTY_PERSONA_NAMING_CONFIG } from "@/types/personaNaming";
import { selectPresetsForLocale } from "@/utils/persona/presetLocale";

let nextId = 1;
function preset(name: string, lineageId: number | null, language: string, isNsfw = false): TomoriPresetRow {
  return {
    persona_preset_id: nextId++,
    persona_preset_name: name,
    persona_preset_desc: `${name} preset`,
    preset_lineage_id: lineageId,
    preset_attribute_list: [],
    preset_attribute_public_flags: [],
    preset_sample_dialogues_in: [],
    preset_sample_dialogues_out: [],
    preset_language: language,
    preset_trigger_words: [],
    preset_naming_config: structuredClone(EMPTY_PERSONA_NAMING_CONFIG),
    is_nsfw: isNsfw,
    natural_nudge_interests: [],
    natural_nudge_talkativeness: 2,
    natural_nudge_idle_nudges: [],
  };
}

const tomoriEn = preset("Tomori-kun", 4, "en-US");
const tomoriJa = preset("ともりくん", 4, "ja");
const brattyEn = preset("Tomori-chan", 716, "en-US");
const obonyaJa = preset("オボニャ", 256, "ja");
const lockeEn = preset("Locke", 666, "en-US", true);
const catalog = [tomoriEn, tomoriJa, brattyEn, obonyaJa, lockeEn];

const names = (rows: TomoriPresetRow[]) => rows.map((row) => row.persona_preset_name);

describe("selectPresetsForLocale", () => {
  it("falls back to English only when the locale has no presets on that NSFW side", () => {
    expect(names(selectPresetsForLocale(catalog, "ja", { nsfw: true }))).toEqual(["Locke"]);
    expect(names(selectPresetsForLocale(catalog, "fr", { nsfw: false }))).toEqual(["Tomori-kun", "Tomori-chan"]);
  });

  it("serves only the locale's own presets when the locale has at least one", () => {
    expect(names(selectPresetsForLocale(catalog, "ja", { nsfw: false }))).toEqual(["ともりくん", "オボニャ"]);
    expect(names(selectPresetsForLocale(catalog, "en-US", { nsfw: false }))).toEqual(["Tomori-kun", "Tomori-chan"]);
  });

  it("serves the aliased Spanish catalog to an es-ES user", () => {
    const tomoriEs = preset("Tomori-kun (es)", 4, "es-419");
    expect(names(selectPresetsForLocale([tomoriEn, brattyEn, tomoriEs], "es-ES", { nsfw: false }))).toEqual([
      "Tomori-kun (es)",
    ]);
  });

  it("keeps SFW and NSFW listings disjoint", () => {
    expect(names(selectPresetsForLocale(catalog, "en-US", { nsfw: true }))).toEqual(["Locke"]);
  });

  it("orders every locale by lineage rather than by its localized names", () => {
    const rows = [
      preset("ツンデレトモリ", 716, "ja"),
      preset("デフォルトのトモリ", 4, "ja"),
      preset("Alpha", 716, "en-US"),
      preset("Zeta", 4, "en-US"),
    ];

    expect(names(selectPresetsForLocale(rows, "en-US", { nsfw: false }))).toEqual(["Zeta", "Alpha"]);
    expect(names(selectPresetsForLocale(rows, "ja", { nsfw: false }))).toEqual([
      "デフォルトのトモリ",
      "ツンデレトモリ",
    ]);
  });

  it("sorts presets without a lineage after the catalog", () => {
    const junoEn = preset("Juno", null, "en-US");

    expect(names(selectPresetsForLocale([junoEn, brattyEn, tomoriEn], "en-US", { nsfw: false }))).toEqual([
      "Tomori-kun",
      "Tomori-chan",
      "Juno",
    ]);
  });
});
