import { describe, expect, it } from "bun:test";
import { LOREBOOK_CONTENT_MAX } from "@/modules/lorebooks/db/types";
import { convertCharacterBook, convertLorebookUpload, convertWorldInfoFile } from "@/modules/lorebooks/imports";

const worldInfoFile = {
  name: "Ravensmoor",
  entries: {
    "0": {
      key: ["manor", "cliff"],
      keysecondary: ["storm"],
      comment: "The Manor",
      content: "The manor overlooks the sea.",
      constant: false,
      selective: true,
      selectiveLogic: 1,
      order: 42,
      position: 1,
      probability: 60,
      useProbability: true,
      scanDepth: 8,
    },
    "1": {
      key: [],
      comment: "Voice",
      content: "Always stay in character.",
      constant: true,
      disable: true,
      position: 4,
    },
  },
};

describe("lorebook uploads", () => {
  it("maps a world info file onto entry activation", () => {
    const conversion = convertWorldInfoFile(worldInfoFile);
    expect(conversion).not.toBeNull();
    const [manor, voice] = conversion?.entries ?? [];
    expect(manor).toMatchObject({
      title: "The Manor",
      content: "The manor overlooks the sea.",
      keys: ["manor", "cliff"],
      secondary_keys: ["storm"],
      selective_logic: 1,
      insertion_order: 42,
      placement: 1,
      trigger_chance: 60,
      scan_depth: 8,
      constant: false,
      enabled: true,
      channel_disc_ids: [],
    });
    expect(voice).toMatchObject({
      title: "Voice",
      keys: [],
      constant: true,
      enabled: false,
      placement: 0,
    });
    expect(conversion?.report.collapsedPlacement).toBe(1);
  });

  it("counts entries whose settings have no destination once each", () => {
    const conversion = convertWorldInfoFile({
      entries: {
        "0": { key: ["a"], content: "A", group: "weights", sticky: 2 },
        "1": { key: ["b"], content: "B", matchScenario: true, triggers: ["normal"] },
        "2": { key: ["c"], content: "C" },
      },
    });
    expect(conversion?.entries).toHaveLength(3);
    expect(conversion?.report.ignoredEntries).toBe(2);
    expect(conversion?.report.collapsedPlacement).toBe(0);
  });

  it("keeps disabled and keyless-constant character book entries and reports regex keys", () => {
    const conversion = convertCharacterBook({
      scan_depth: 9,
      entries: [
        {
          keys: ["/a+/"],
          content: "Regex key",
          enabled: false,
          position: "after_char",
          insertion_order: 7,
          extensions: { selectiveLogic: 2, probability: 25 },
        },
        { keys: [], content: "Constant", constant: true },
        { keys: ["dropped"], content: "" },
        { keys: [], content: "Never activates" },
      ],
    });
    expect(conversion.entries.map((entry) => entry.title)).toEqual(["/a+/", "Character Book Entry"]);
    expect(conversion.entries[0]).toMatchObject({
      enabled: false,
      placement: 1,
      scan_depth: 9,
      insertion_order: 7,
      selective_logic: 2,
      trigger_chance: 25,
      keys: ["/a+/"],
    });
    expect(conversion.entries[1]).toMatchObject({ constant: true, keys: [] });
    expect(conversion.report.unsupportedKeys).toBe(1);
    expect(conversion.report.skippedEntries).toBe(2);
  });

  it("splits long world info content without truncating it", () => {
    const content = "x".repeat(LOREBOOK_CONTENT_MAX) + "tail";
    const conversion = convertWorldInfoFile({ entries: { "0": { key: ["long"], content, comment: "Long" } } });
    expect(conversion?.entries).toHaveLength(2);
    expect(conversion?.entries[0].content).toHaveLength(LOREBOOK_CONTENT_MAX);
    expect(conversion?.entries[1].content).toBe("tail");
    expect(conversion?.entries[1].title).toBe("Long (2)");
  });

  it("dispatches world info objects and character book arrays, and rejects other JSON", () => {
    expect(convertLorebookUpload(worldInfoFile)?.entries).toHaveLength(2);
    expect(convertLorebookUpload({ entries: [{ keys: ["a"], content: "A" }] })?.entries).toHaveLength(1);
    expect(convertLorebookUpload({ entries: { "0": { key: ["a"], content: "A" } } })?.entries).toHaveLength(1);
    expect(convertLorebookUpload({ entries: [] })?.entries).toEqual([]);
    expect(convertLorebookUpload({ entries: "nope" })).toBeNull();
    expect(convertLorebookUpload({ name: "card", description: "not a lorebook" })).toBeNull();
    expect(convertLorebookUpload([])).toBeNull();
    expect(convertLorebookUpload(null)).toBeNull();
  });

  it("treats entries without content as skipped rather than empty lore", () => {
    const conversion = convertWorldInfoFile({
      entries: { "0": { key: ["a"], content: "   " }, "1": { key: ["b"], content: "B" } },
    });
    expect(conversion?.entries.map((entry) => entry.content)).toEqual(["B"]);
    expect(conversion?.report.skippedEntries).toBe(1);
  });
});
