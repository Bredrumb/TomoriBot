import { crc32 } from "node:zlib";
import JSZip from "jszip";
import { describe, expect, it } from "bun:test";
import { LOREBOOK_CONTENT_MAX } from "@/modules/lorebooks/db/types";
import {
  convertCharacterBook,
  convertLorebookUpload,
  convertWorldInfoFile,
  parseLorebookUpload,
  exportWorldInfo,
} from "@/modules/lorebooks/imports";

function pngCard(card?: unknown): Buffer {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
    "base64",
  );
  if (card === undefined) return png;
  const data = Buffer.from(`chara\0${Buffer.from(JSON.stringify(card)).toString("base64")}`);
  const body = Buffer.concat([Buffer.from("tEXt"), data]);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), chunk.length - 4);
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
}

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

  it("preserves zero probability while missing, null, and disabled probability use 100 percent", () => {
    for (const [extensions, expected] of [
      [{ probability: 0, useProbability: true }, 0],
      [{ probability: null, useProbability: true }, 100],
      [{ useProbability: true }, 100],
      [{ probability: 0, useProbability: false }, 100],
    ] as const) {
      const result = convertCharacterBook({ entries: [{ keys: ["manor"], content: "Lore", extensions }] });
      expect(result.entries[0]?.trigger_chance).toBe(expected);
    }
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

  it("parses uploaded bytes through the shared BOM-stripping helper", async () => {
    const buffer = Buffer.from(`\uFEFF${JSON.stringify(worldInfoFile)}`);
    const parsed = await parseLorebookUpload(buffer);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.conversion.entries).toHaveLength(2);
      expect(parsed.name).toBe(worldInfoFile.name);
    }

    expect(await parseLorebookUpload(Buffer.from("{ not json"))).toEqual({ ok: false, reason: "invalid_json" });
    expect(await parseLorebookUpload(Buffer.from(JSON.stringify({ name: "not a lorebook" })))).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(await parseLorebookUpload(Buffer.from(JSON.stringify({ entries: [] })))).toMatchObject({
      ok: true,
      conversion: { entries: [] },
    });
  });
  it("round-trips supported world info fields without exporting channel scope", () => {
    const original = convertWorldInfoFile(worldInfoFile)?.entries;
    if (!original) throw new Error("Fixture conversion failed");
    const entries = original.map((entry) => ({
      ...entry,
      channel_disc_ids: ["111111111111111111"],
      legacy_channel_tags: ["#hall"],
    }));
    const exported = exportWorldInfo(entries, "Hollow Manor");
    expect(convertWorldInfoFile(exported)?.entries).toEqual(original);
    expect(
      Object.values(exported.entries).every(
        (entry) => !("channel_disc_ids" in entry) && !("legacy_channel_tags" in entry),
      ),
    ).toBe(true);
  });

  it("extracts the same Character Book from PNG, CHARX, and card JSON bytes", async () => {
    const book = {
      name: "Hollow Manor",
      entries: [{ keys: ["manor"], content: "The manor overlooks the sea.", enabled: false }],
    };
    const card = { spec: "chara_card_v3", data: { name: "Mirri", character_book: book } };
    const zip = new JSZip();
    zip.file("card.json", JSON.stringify(card));
    const carriers = [
      pngCard(card),
      await zip.generateAsync({ type: "nodebuffer" }),
      Buffer.from(JSON.stringify(card)),
    ];
    for (const buffer of carriers) {
      const parsed = await parseLorebookUpload(buffer);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error(parsed.reason);
      expect(parsed.name).toBe(book.name);
      expect(parsed.conversion.entries).toEqual(convertCharacterBook(book).entries);
    }
    const rootCard = { name: "Juno", description: "An archivist.", character_book: book };
    expect((await parseLorebookUpload(pngCard(rootCard))).ok).toBe(true);
  });

  it("distinguishes cards without a book from PNG images without card metadata", async () => {
    expect(await parseLorebookUpload(pngCard({ spec: "chara_card_v3", data: { name: "Mirri" } }))).toEqual({
      ok: false,
      reason: "no_book",
    });
    expect(await parseLorebookUpload(pngCard())).toEqual({ ok: false, reason: "unsupported" });
  });

  it("applies the JSON ceiling even when the file advertises another carrier", async () => {
    const buffer = Buffer.from(JSON.stringify({ entries: [], padding: "x".repeat(2 * 1024 * 1024) }));
    expect(await parseLorebookUpload(buffer)).toEqual({ ok: false, reason: "too_large", maxMB: 2 });
  });
});
