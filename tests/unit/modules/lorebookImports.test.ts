import { describe, expect, it, spyOn } from "bun:test";
import { lorebookEntryInputSchema, LOREBOOK_ENTRIES_PER_SCOPE_MAX } from "@/modules/lorebooks/db/types";
import { taggedMemoryToLorebook } from "@/modules/lorebooks/imports";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";
import { log } from "@/utils/misc/logger";

describe("lorebook import mapping", () => {
  it("distinguishes channel-only tags and preserves mixed keyword/channel scope", () => {
    expect(taggedMemoryToLorebook({ content: "Hall", tags: [" '#hall' ", "  "] }, true)).toBeNull();
    expect(
      taggedMemoryToLorebook(
        { content: "Hall", tags: [" '#hall' ", '"manor"', "manor"], channel_disc_ids: ["100000000000000001"] },
        false,
      ),
    ).toMatchObject({
      keys: ["manor"],
      legacy_channel_tags: ["#hall"],
      channel_disc_ids: ["100000000000000001"],
      constant: true,
      scan_depth: 5,
    });
  });

  it("maps disabled entries, splits long Unicode content, and carries supported activation fields", () => {
    const content = `${"x".repeat(3999)}\u{1f319}${"y".repeat(4500)}`;
    const result = presetRepository.convertSillyTavernJsonToPresetData({
      spec: "chara_card_v3",
      name: "Mirri",
      character_book: {
        scan_depth: 12,
        entries: [
          {
            content,
            keys: ['"manor"', "manor"],
            secondary_keys: ["night"],
            selective: true,
            enabled: false,
            insertion_order: -3,
            position: "after_char",
            comment: "The manor",
            extensions: { selectiveLogic: 3, probability: 42 },
          },
          {
            content: "Always",
            constant: true,
            keys: [],
            extensions: { useProbability: false, probability: 2, scan_depth: 999 },
          },
        ],
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const entries = result.data.lorebook_entries ?? [];
    expect(
      entries
        .slice(0, 3)
        .map((entry) => entry.content)
        .join(""),
    ).toBe(content);
    for (const entry of entries.slice(0, 3)) {
      expect(lorebookEntryInputSchema.safeParse(entry).success).toBe(true);
      expect(entry).toMatchObject({
        keys: ["manor"],
        secondary_keys: ["night"],
        enabled: false,
        selective_logic: 3,
        trigger_chance: 42,
        scan_depth: 12,
        insertion_order: -3,
        placement: 1,
      });
    }
    expect(entries.at(-1)).toMatchObject({ constant: true, trigger_chance: 100, scan_depth: 100 });
    expect(result.data.attribute_list).toEqual([]);
  });

  it("keeps regex keys inert and reports rejected activation data", () => {
    const warning = spyOn(log, "warn").mockImplementation(() => {});
    try {
      const result = presetRepository.convertSillyTavernJsonToPresetData({
        spec: "chara_card_v3",
        name: "Juno",
        character_book: {
          entries: [
            { content: "Regex", keys: ["a+"], use_regex: true },
            { content: "Inert", keys: [] },
          ],
        },
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.lorebook_entries?.[0].keys).toEqual(["/a+/"]);
      expect(warning).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        expect.objectContaining({ metadata: { unsupportedKeys: 1, skippedEntries: 1 } }),
      );
    } finally {
      warning.mockRestore();
    }
  });

  it("preserves absence and keeps the first 250 converted entries from oversized books", () => {
    const absent = presetRepository.convertSillyTavernJsonToPresetData({ spec: "chara_card_v3", name: "Juno" });
    expect(absent.success && absent.data.lorebook_entries).toBeUndefined();
    const empty = presetRepository.convertSillyTavernJsonToPresetData({
      spec: "chara_card_v3",
      name: "Juno",
      character_book: { entries: [] },
    });
    expect(empty.success && empty.data.lorebook_entries).toEqual([]);
    const oversized = presetRepository.convertSillyTavernJsonToPresetData({
      spec: "chara_card_v3",
      name: "Juno",
      character_book: {
        entries: Array.from({ length: LOREBOOK_ENTRIES_PER_SCOPE_MAX + 1 }, (_, index) => ({
          content: `Lore ${index}`,
          keys: ["key"],
        })),
      },
    });
    expect(oversized.success).toBe(true);
    if (!oversized.success) throw new Error("Card conversion failed");
    expect(oversized.data.lorebook_entries).toHaveLength(LOREBOOK_ENTRIES_PER_SCOPE_MAX);
    expect(oversized.data.lorebook_entries?.at(-1)?.content).toBe(`Lore ${LOREBOOK_ENTRIES_PER_SCOPE_MAX - 1}`);
  });
});
