import { describe, expect, it, mock } from "bun:test";
import {
  LOREBOOK_CONTENT_MAX,
  LOREBOOK_CONTEXT_CHAR_BUDGET,
  LOREBOOK_KEYS_MAX,
  LOREBOOK_KEY_LENGTH_MAX,
  lorebookEntryInputSchema,
  lorebookEntryRowSchema,
  normalizeLorebookKeys,
  type LorebookEntryRow,
} from "@/modules/lorebooks/db/types";
import { evaluateActiveLorebookEntries, type LorebookActivationOptions } from "@/modules/lorebooks/runtime/activation";

function entry(overrides: Partial<LorebookEntryRow> = {}): LorebookEntryRow {
  return lorebookEntryRowSchema.parse({
    entry_id: 1,
    server_id: 1,
    persona_lineage_id: 10,
    title: "Manor",
    content: "The manor overlooks the sea.",
    keys: ["manor"],
    secondary_keys: [],
    selective_logic: 0,
    scan_depth: 5,
    trigger_chance: 100,
    insertion_order: 100,
    placement: 0,
    constant: false,
    enabled: true,
    channel_disc_ids: [],
    ...overrides,
  });
}

const options: LorebookActivationOptions = {
  serverId: 1,
  lineageId: 10,
  channelId: "100000000000000001",
  channelScopeEnabled: true,
  random: () => 0,
};

function active(
  row: LorebookEntryRow,
  messages: string[],
  overrides: Partial<LorebookActivationOptions> = {},
): boolean {
  return evaluateActiveLorebookEntries([row], messages, { ...options, ...overrides }).length > 0;
}

describe("lorebook activation", () => {
  it("admits only enabled global and active-lineage entries in the requested server", () => {
    const rows = [
      entry(),
      entry({ entry_id: 2, persona_lineage_id: null }),
      entry({ entry_id: 3, persona_lineage_id: 20 }),
      entry({ entry_id: 4, server_id: 2 }),
      entry({ entry_id: 5, enabled: false, constant: true }),
    ];
    expect(evaluateActiveLorebookEntries(rows, ["manor"], options).map((row) => row.entry_id)).toEqual([1, 2]);
    expect(
      evaluateActiveLorebookEntries(rows, ["manor"], { ...options, lineageId: null }).map((row) => row.entry_id),
    ).toEqual([2]);
  });

  it("applies channel and parent scope even to constants, unless channel scoping is off", () => {
    const row = entry({ constant: true, channel_disc_ids: ["100000000000000002"] });
    expect(active(row, [])).toBe(false);
    expect(active(row, [], { parentChannelId: "100000000000000002" })).toBe(true);
    expect(active(row, [], { channelScopeEnabled: false })).toBe(true);
    expect(active(entry({ channel_disc_ids: [options.channelId] }), ["manor"])).toBe(true);
  });

  it("scans the last depth messages oldest to newest, including persona turns", () => {
    expect(active(entry({ scan_depth: 1 }), ["manor", "the sea"])).toBe(false);
    expect(active(entry({ scan_depth: 2 }), ["manor", "the sea"])).toBe(true);
    expect(active(entry(), [])).toBe(false);
  });

  it.each([
    ["manor", "MANOR!", true],
    ["manor", "manorial", false],
    ["manor", "_manor", false],
    ["manor", "manor2", false],
    ["manor", "manor manorish", true],
    ["café", "ＣＡＦÉ", true],
    ["café", "cafe\u0301", true],
    ["cafe", "cafe\u0301", false],
    ["a", "a\u0301", false],
    ["мир", "мир!", true],
    ["мир", "миры", false],
    ["φως", "φως!", true],
    ["φως", "φωςα", false],
    ["42", "142", false],
    ["42", "４２", true],
    ["manor", "𐐀manor", false],
    ["manor", "manor𐐀", false],
    ["城", "古城の中", true],
    ["東京", "東京都", true],
    ["ｶﾅ", "カナです", true],
    ["/manor/i", "manor /manor/i", false],
    ["/manor\nnight/i", "/manor\nnight/i", false],
    ["/城/", "城", false],
  ])("matches key %s in %s: %s", (key, message, expected) => {
    expect(active(entry({ keys: [key] }), [message])).toBe(expected);
  });

  it.each([
    [0, "", false],
    [0, "red", true],
    [0, "red blue", true],
    [1, "", true],
    [1, "red", true],
    [1, "red blue", false],
    [2, "", true],
    [2, "red", false],
    [2, "red blue", false],
    [3, "", false],
    [3, "red", false],
    [3, "red blue", true],
  ] as const)("applies secondary logic %s to %s", (logic, text, expected) => {
    expect(active(entry({ secondary_keys: ["red", "blue"], selective_logic: logic }), [`manor ${text}`])).toBe(
      expected,
    );
    expect(active(entry({ secondary_keys: ["red", "blue"], selective_logic: logic }), [text])).toBe(false);
    expect(active(entry({ selective_logic: logic }), ["manor"])).toBe(true);
  });

  it("uses strict chance boundaries and never rolls for constants or ineligible entries", () => {
    expect(active(entry({ trigger_chance: 1 }), ["manor"], { random: () => 0 })).toBe(true);
    expect(active(entry({ trigger_chance: 1 }), ["manor"], { random: () => 0.01 })).toBe(false);
    expect(active(entry({ trigger_chance: 50 }), ["manor"], { random: () => 0.49999 })).toBe(true);
    expect(active(entry({ trigger_chance: 50 }), ["manor"], { random: () => 0.5 })).toBe(false);
    expect(active(entry(), ["manor"], { random: () => 0.99999 })).toBe(true);
    const random = mock(() => 0.99);
    expect(
      active(entry({ constant: true, keys: [], secondary_keys: ["missing"], trigger_chance: 1 }), [], { random }),
    ).toBe(true);
    expect(active(entry({ enabled: false, constant: true }), [], { random })).toBe(false);
    expect(active(entry(), ["sea"], { random })).toBe(false);
    expect(random).not.toHaveBeenCalled();
  });

  it("orders both placements together and skips oversized entries without mutating inputs", () => {
    const rows = [
      entry({ entry_id: 4, content: "four", placement: 1 }),
      entry({ entry_id: 2, content: "large", insertion_order: 0 }),
      entry({ entry_id: 3, content: "skip this", insertion_order: 1 }),
      entry({ entry_id: 1, content: "a", placement: 0 }),
    ];
    const original = [...rows];
    const admitted = evaluateActiveLorebookEntries(rows, ["manor"], { ...options, charBudget: 10 });
    expect(admitted.map((row) => [row.entry_id, row.placement])).toEqual([
      [2, 0],
      [1, 0],
      [4, 1],
    ]);
    expect(rows).toEqual(original);
    expect(evaluateActiveLorebookEntries(rows, ["manor"], { ...options, charBudget: 0 })).toEqual([]);
    const full = Array.from({ length: 3 }, (_, i) =>
      entry({ entry_id: i + 1, content: "x".repeat(4000), constant: true, keys: [] }),
    );
    expect(evaluateActiveLorebookEntries(full, [], options).reduce((n, row) => n + row.content.length, 0)).toBe(
      LOREBOOK_CONTEXT_CHAR_BUDGET,
    );
  });
});

describe("lorebook input normalization", () => {
  it("trims quotes, drops blank or oversized keys, deduplicates and caps the import helper", () => {
    expect(normalizeLorebookKeys([" 'manor' ", '"sea"', "manor", "", "   ", "x".repeat(65)])).toEqual(["manor", "sea"]);
    const nested = normalizeLorebookKeys(["' \"manor\" '"]);
    expect(nested).toEqual(["manor"]);
    expect(normalizeLorebookKeys(nested)).toEqual(nested);
    expect(normalizeLorebookKeys(Array.from({ length: 25 }, (_, i) => `key${i}`))).toHaveLength(LOREBOOK_KEYS_MAX);
  });

  it("validates write limits before normalization and preserves content and channel restrictions", () => {
    const { entry_id, server_id, persona_lineage_id, ...input } = entry();
    expect(
      lorebookEntryInputSchema.parse({
        ...input,
        keys: [" 'manor' ", "manor"],
        content: " lore\n",
        channel_disc_ids: [options.channelId],
      }),
    ).toMatchObject({ keys: ["manor"], content: " lore\n", channel_disc_ids: [options.channelId] });
    for (const patch of [
      { keys: [] },
      { keys: [" '' "] },
      { title: " " },
      { title: "x".repeat(129) },
      { content: " " },
      { content: "x".repeat(LOREBOOK_CONTENT_MAX + 1) },
      { scan_depth: 0 },
      { scan_depth: 101 },
      { trigger_chance: 0 },
      { trigger_chance: 101 },
      { selective_logic: 4 },
      { placement: 2 },
      { insertion_order: 1.2 },
      { insertion_order: 2147483648 },
      { channel_disc_ids: ["bad"] },
      { keys: Array(LOREBOOK_KEYS_MAX + 1).fill("key") },
      { keys: ["x".repeat(LOREBOOK_KEY_LENGTH_MAX + 1)] },
    ])
      expect(lorebookEntryInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    expect(lorebookEntryInputSchema.safeParse({ ...input, constant: true, keys: [] }).success).toBe(true);
    expect(lorebookEntryInputSchema.safeParse({ ...input, server_id }).success).toBe(false);
  });
});
