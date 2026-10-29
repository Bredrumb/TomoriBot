import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Client } from "discord.js";
import type { CachedPresetData } from "@/utils/cache/stPresetCache";
import { lorebookRepository } from "@/modules/lorebooks/db/repositories";
import { lorebookEntryRowSchema, type LorebookEntryInput, type LorebookEntryRow } from "@/modules/lorebooks/db/types";
import { convertCharacterBook, taggedMemoryToLorebook } from "@/modules/lorebooks/imports";
import { buildLorebookContextItems } from "@/modules/lorebooks/runtime/contextItems";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { convertMentions } from "@/utils/text/context/mentionNormalizer";
import { resolveRandomChoiceMacrosInBuildOutput } from "@/utils/text/context/templates";
import { reassembleWithPreset } from "@/utils/text/presetContextBuilder";
import { measureContextUsage } from "@/utils/text/promptInspection/contextUsage";
import { buildTextSnapshot } from "@/utils/text/promptInspection/serialize";
import { charsToTokensText } from "@/utils/text/tokenEstimate";
import { createPersona } from "../../helpers/fixtures";

const SERVER_ID = 1;
const LINEAGE_ID = 100;
const OTHER_LINEAGE_ID = 200;
const CHANNEL_ID = "444444444444444444";
const SCOPED_CHANNEL_ID = "111111111111111111";
const THREAD_ID = "555555555555555555";

let nextEntryId = 1;
let loadSpy: { mockRestore(): void; mockResolvedValue(rows: LorebookEntryRow[]): void } | undefined;

beforeEach(() => {
  nextEntryId = 1;
  loadSpy = spyOn(lorebookRepository, "loadEnabledForScope").mockResolvedValue([]);
});

afterEach(() => {
  loadSpy?.mockRestore();
});

function input(overrides: Partial<LorebookEntryInput> = {}): LorebookEntryInput {
  return {
    title: "Entry",
    content: "Entry content.",
    keys: ["entry"],
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
  };
}

function toRow(entry: LorebookEntryInput, overrides: Partial<LorebookEntryRow> = {}): LorebookEntryRow {
  return lorebookEntryRowSchema.parse({
    ...entry,
    entry_id: nextEntryId++,
    server_id: SERVER_ID,
    persona_lineage_id: LINEAGE_ID,
    ...overrides,
  });
}

async function buildItems(
  rows: LorebookEntryRow[],
  options: {
    messages?: string[];
    channelId?: string;
    parentChannelId?: string | null;
    channelScopeEnabled?: boolean;
  } = {},
): Promise<StructuredContextItem[]> {
  loadSpy?.mockResolvedValue(rows);
  return await buildLorebookContextItems({
    tomoriState: createPersona({ server_id: SERVER_ID, persona_lineage_id: LINEAGE_ID }),
    recentMessages: options.messages ?? [],
    channelId: options.channelId ?? CHANNEL_ID,
    parentChannelId: options.parentChannelId ?? null,
    channelScopeEnabled: options.channelScopeEnabled ?? true,
    client: {} as Client,
    guildId: "111111111111111111",
    botName: "Mirri",
    personalMemoriesEnabled: true,
    convertMentions,
  });
}

function textFor(items: StructuredContextItem[], tag: ContextItemTag): string {
  return items
    .filter((item) => item.metadataTag === tag)
    .flatMap((item) => item.parts)
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

function finalized(items: StructuredContextItem[]): StructuredContextItem[] {
  return resolveRandomChoiceMacrosInBuildOutput({
    contextItems: items,
    tailDirectives: [],
    lowerPriorityTailDirectives: [],
  }).contextItems;
}

describe("lorebook context items", () => {
  it("reads one scope and splits Serverwide and persona entries by placement in insertion order", async () => {
    const rows = [
      toRow(input({ title: "Global", content: "Global lore.", constant: true, keys: [], insertion_order: 6 }), {
        persona_lineage_id: null,
      }),
      toRow(input({ title: "Rules", content: "Rules lore.", constant: true, keys: [], insertion_order: 5 })),
      toRow(input({ title: "Harbor", content: "Harbor lore.", keys: ["harbor"], insertion_order: 10 })),
      toRow(input({ title: "Tower", content: "Tower lore.", keys: ["tower"], placement: 1, insertion_order: 20 })),
      toRow(input({ title: "Foreign", content: "Foreign lore.", constant: true, keys: [] }), {
        persona_lineage_id: OTHER_LINEAGE_ID,
      }),
      toRow(input({ title: "Off", content: "Off lore.", constant: true, keys: [] }), { enabled: false }),
    ];

    const items = await buildItems(rows, { messages: ["We reach the harbor and the tower."] });

    expect(loadSpy).toHaveBeenCalledWith(SERVER_ID, LINEAGE_ID);
    expect(items.map((item) => item.metadataTag)).toEqual([
      ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE,
      ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER,
    ]);

    const before = textFor(items, ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE);
    expect(before.indexOf("Rules lore.")).toBeLessThan(before.indexOf("Global lore."));
    expect(before.indexOf("Global lore.")).toBeLessThan(before.indexOf("Harbor lore."));
    expect(before).not.toContain("Foreign lore.");
    expect(before).not.toContain("Off lore.");
    expect(textFor(items, ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER)).toContain("Tower lore.");
  });

  it("requires an admitted channel for an Always On entry unless channel filtering is off", async () => {
    const scoped = toRow(
      input({ title: "Pier", content: "Pier lore.", constant: true, keys: [], channel_disc_ids: [SCOPED_CHANNEL_ID] }),
    );

    expect(await buildItems([scoped])).toEqual([]);
    expect(await buildItems([scoped], { channelId: SCOPED_CHANNEL_ID })).toHaveLength(1);
    expect(await buildItems([scoped], { channelId: THREAD_ID, parentChannelId: SCOPED_CHANNEL_ID })).toHaveLength(1);
    expect(await buildItems([scoped], { channelId: THREAD_ID })).toEqual([]);
    expect(await buildItems([scoped], { channelScopeEnabled: false })).toHaveLength(1);
  });

  it("resolves identity macros and keeps runtime macros and conditionals literal", async () => {
    const rows = [
      toRow(
        input({
          title: "Watch",
          content: "{{char}} and {{bot}} guard {{user}}. {{time}} {{#if morning}}dawn{{/if}} {{random::a,b}}",
          constant: true,
          keys: [],
        }),
      ),
      toRow(input({ title: "Sleep", content: "{{char}} sleeps.", constant: true, keys: [], placement: 1 })),
    ];

    const items = finalized(await buildItems(rows));
    const before = textFor(items, ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE);

    expect(before).toContain("Mirri and Mirri guard User.");
    expect(textFor(items, ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER)).toContain("Mirri sleeps.");
    expect(before).toContain("{{time}}");
    expect(before).toContain("{{#if morning}}dawn{{/if}}");
    expect(before).toContain("{{random::a,b}}");
  });

  it("carries imported and migrated entries through activation into the final preset context", async () => {
    const converted = convertCharacterBook({
      scan_depth: 4,
      entries: [
        {
          keys: ["lantern"],
          content: "The lantern never goes out. {{char}} keeps it lit.",
          name: "Lantern",
          insertion_order: 30,
          position: "after_char",
        },
        { keys: ["sealed"], content: "The sealed door stays shut.", name: "Sealed", enabled: false },
        {
          constant: true,
          content: "The town keeps a curfew. {{time}} {{#if night}}Lights out.{{/if}} {{random::a,b}}",
          name: "Curfew",
        },
      ],
    });
    expect(converted.entries).toHaveLength(3);

    const migrated = taggedMemoryToLorebook(
      {
        content: "The vault key rests under the third stair. {{user}} may take it.",
        tags: ["vault", "#old"],
        channel_disc_ids: [SCOPED_CHANNEL_ID],
      },
      true,
    );
    if (!migrated) throw new Error("Migrated fixture mapping failed");

    const rows = [
      toRow(converted.entries[0], { entry_id: 1 }),
      toRow(converted.entries[1], { entry_id: 2 }),
      toRow(converted.entries[2], { entry_id: 3 }),
      toRow(migrated, { entry_id: 4 }),
    ];
    const loreItems = await buildItems(rows, {
      channelId: SCOPED_CHANNEL_ID,
      messages: ["We light the lantern.", "The sealed door waits.", "I found the vault."],
    });
    expect(loreItems.map((item) => item.metadataTag)).toEqual([
      ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE,
      ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER,
    ]);

    const presetNodes: CachedPresetData["nodes"] = [
      markerNode("main", 0),
      markerNode("worldInfoBefore", 1),
      markerNode("worldInfoAfter", 2),
      markerNode("chatHistory", 3),
    ];
    const reassembled = await reassembleWithPreset(
      {
        contextItems: [
          {
            role: "system",
            parts: [{ type: "text", text: "Preset system prompt" }],
            metadataTag: ContextItemTag.SYSTEM_HUMANIZER_RULES,
          },
          {
            role: "user",
            parts: [{ type: "text", text: "## Retrieved documents\nOld records." }],
            metadataTag: ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS,
          },
          ...loreItems,
          {
            role: "user",
            parts: [{ type: "text", text: "Alice: I found the vault." }],
            metadataTag: ContextItemTag.DIALOGUE_HISTORY,
          },
        ],
        tailDirectives: [],
        lowerPriorityTailDirectives: [],
      },
      {
        preset: { preset_id: 1, server_id: SERVER_ID, preset_name: "Trace Preset", raw_json: {}, is_active: true },
        nodes: presetNodes,
      },
      {
        triggererName: "Alice",
        tomoriNickname: "Mirri",
        tomoriAttributes: [],
        personaPrompt: null,
        sampleDialoguesIn: [],
        sampleDialoguesOut: [],
        lastUserMessage: "I found the vault.",
        model: "configured-model",
        provider: "google",
        utcOffsetHours: 8,
        nowMs: Date.UTC(2026, 0, 1),
      },
      {
        client: {} as Client,
        guildId: "111111111111111111",
        triggererName: "Alice",
        triggererFormattedName: "Alice",
        triggererAddressTerm: "",
        botName: "Mirri",
        personalMemoriesEnabled: true,
      },
    );

    const final = finalized(reassembled.contextItems);
    expect(final.map((item) => item.metadataTag)).toEqual([
      ContextItemTag.SYSTEM_HUMANIZER_RULES,
      ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE,
      ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS,
      ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER,
      ContextItemTag.DIALOGUE_HISTORY,
    ]);

    const before = textFor(final, ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE);
    expect(before).toContain("The town keeps a curfew.");
    expect(before).toContain("The vault key rests under the third stair. User may take it.");
    expect(before.indexOf("curfew")).toBeLessThan(before.indexOf("vault key"));
    expect(before).not.toContain("sealed door");
    expect(before).toContain("{{time}}");
    expect(before).toContain("{{#if night}}Lights out.{{/if}}");
    expect(before).toContain("{{random::a,b}}");

    const after = textFor(final, ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER);
    expect(after).toContain("The lantern never goes out. Mirri keeps it lit.");

    const memoryChars = final
      .filter((item) =>
        [
          ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE,
          ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER,
          ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS,
        ].includes(item.metadataTag as ContextItemTag),
      )
      .flatMap((item) => item.parts)
      .reduce((total, part) => total + (part.type === "text" ? part.text.length : 0), 0);
    const instructionChars = textFor(final, ContextItemTag.SYSTEM_HUMANIZER_RULES).length;
    const conversationChars = textFor(final, ContextItemTag.DIALOGUE_HISTORY).length;
    const usage = measureContextUsage(final, null);
    expect(usage.segments).toEqual([
      { id: "instructions", tokens: charsToTokensText(instructionChars) },
      { id: "memory", tokens: charsToTokensText(memoryChars) },
      { id: "conversation", tokens: charsToTokensText(conversationChars) },
    ]);
    expect(usage.inputTokens).toBe(usage.segments.reduce((total, segment) => total + segment.tokens, 0));

    const snapshot = buildTextSnapshot(final, {});
    const beforeHeader = snapshot.indexOf("=== Lorebook (Before) (`/memories`) ===");
    const documentsHeader = snapshot.indexOf("=== Server Documents (`/memories`) ===");
    const afterHeader = snapshot.indexOf("=== Lorebook (After) (`/memories`) ===");
    expect(beforeHeader).toBeGreaterThanOrEqual(0);
    expect(beforeHeader).toBeLessThan(documentsHeader);
    expect(documentsHeader).toBeLessThan(afterHeader);
  });
});

function markerNode(identifier: string, nodeOrder: number): CachedPresetData["nodes"][number] {
  return {
    preset_id: 1,
    identifier,
    name: identifier,
    role: "system",
    content: "",
    is_marker: true,
    is_enabled: true,
    is_comment: false,
    node_order: nodeOrder,
    injection_position: 0,
    injection_depth: 0,
    injection_order: 100,
  };
}
