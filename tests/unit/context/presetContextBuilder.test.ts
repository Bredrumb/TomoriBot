import { describe, expect, test } from "bun:test";
import type { Client } from "discord.js";
import type { CachedPresetData } from "@/utils/cache/stPresetCache";
import { reassembleWithPreset } from "@/utils/text/presetContextBuilder";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";

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

function depthNode(content: string, nodeOrder: number): CachedPresetData["nodes"][number] {
  return {
    preset_id: 1,
    identifier: "depth_note",
    name: "Depth Note",
    role: "system",
    content,
    is_marker: false,
    is_enabled: true,
    is_comment: false,
    node_order: nodeOrder,
    injection_position: 1,
    injection_depth: 0,
    injection_order: 100,
  };
}

function taggedItem(tag: ContextItemTag, text: string, role: "system" | "user" = "system"): StructuredContextItem {
  return { role, parts: [{ type: "text", text }], metadataTag: tag };
}

function nativeWorldInfoItems(): StructuredContextItem[] {
  return [
    taggedItem(ContextItemTag.SYSTEM_HUMANIZER_RULES, "System prompt"),
    taggedItem(ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS, "Documents", "user"),
    taggedItem(ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE, "Lore before"),
    taggedItem(ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER, "Lore after"),
    taggedItem(ContextItemTag.DIALOGUE_HISTORY, "Alice: hello", "user"),
  ];
}

async function reassemble(
  nodes: CachedPresetData["nodes"],
  contextItems: StructuredContextItem[],
): Promise<StructuredContextItem[]> {
  const result = await reassembleWithPreset(
    { contextItems, tailDirectives: [], lowerPriorityTailDirectives: [] },
    {
      preset: { preset_id: 1, server_id: 1, preset_name: "Test Preset", raw_json: {}, is_active: true },
      nodes,
    },
    {
      triggererName: "Alice",
      tomoriNickname: "Tomori",
      tomoriAttributes: [],
      personaPrompt: null,
      sampleDialoguesIn: [],
      sampleDialoguesOut: [],
      lastUserMessage: "look",
    },
    {
      client: {} as Client,
      guildId: "111111111111111111",
      triggererName: "Alice",
      triggererFormattedName: "Alice",
      triggererAddressTerm: "",
      botName: "Tomori",
      personalMemoriesEnabled: true,
    },
  );
  return result.contextItems;
}

describe("reassembleWithPreset", () => {
  test("routes before and after lore around documents at their world info markers", async () => {
    const items = await reassemble(
      [
        markerNode("main", 0),
        markerNode("worldInfoBefore", 1),
        markerNode("worldInfoAfter", 2),
        markerNode("chatHistory", 3),
      ],
      nativeWorldInfoItems(),
    );

    expect(items.map((item) => item.metadataTag)).toEqual([
      ContextItemTag.SYSTEM_HUMANIZER_RULES,
      ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE,
      ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS,
      ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER,
      ContextItemTag.DIALOGUE_HISTORY,
    ]);
  });

  test("keeps documents at the first world info marker when the after marker comes first", async () => {
    const items = await reassemble(
      [
        markerNode("main", 0),
        markerNode("worldInfoAfter", 1),
        markerNode("worldInfoBefore", 2),
        markerNode("chatHistory", 3),
      ],
      nativeWorldInfoItems(),
    );

    expect(items.map((item) => item.metadataTag)).toEqual([
      ContextItemTag.SYSTEM_HUMANIZER_RULES,
      ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER,
      ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS,
      ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE,
      ContextItemTag.DIALOGUE_HISTORY,
    ]);
  });

  test("flushes lore before chat history when the preset has neither world info marker", async () => {
    const items = await reassemble([markerNode("main", 0), markerNode("chatHistory", 1)], nativeWorldInfoItems());

    expect(items.map((item) => item.metadataTag)).toEqual([
      ContextItemTag.SYSTEM_HUMANIZER_RULES,
      ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE,
      ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS,
      ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER,
      ContextItemTag.DIALOGUE_HISTORY,
    ]);
  });

  test("flushes the after bucket before chat history when only the before marker exists", async () => {
    const items = await reassemble(
      [markerNode("main", 0), markerNode("worldInfoBefore", 1), markerNode("chatHistory", 2)],
      nativeWorldInfoItems(),
    );

    expect(items.map((item) => item.metadataTag)).toEqual([
      ContextItemTag.SYSTEM_HUMANIZER_RULES,
      ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE,
      ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS,
      ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER,
      ContextItemTag.DIALOGUE_HISTORY,
    ]);
  });

  test("keeps depth insertion merged into history with world info routing enabled", async () => {
    const items = await reassemble(
      [
        markerNode("main", 0),
        markerNode("worldInfoBefore", 1),
        markerNode("worldInfoAfter", 2),
        markerNode("chatHistory", 3),
        depthNode("Depth note", 4),
      ],
      nativeWorldInfoItems(),
    );

    expect(items.map((item) => item.metadataTag)).toEqual([
      ContextItemTag.SYSTEM_HUMANIZER_RULES,
      ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE,
      ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS,
      ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER,
      ContextItemTag.DIALOGUE_HISTORY,
    ]);
    expect(items[4].parts).toEqual([
      { type: "text", text: "Alice: hello" },
      { type: "text", text: "\n[System: Depth note]" },
    ]);
  });

  test("preserves mediaDescriptors on reordered dialogue history items", async () => {
    const dialogueItem: StructuredContextItem = {
      role: "user",
      parts: [{ type: "text", text: "Alice: look" }],
      metadataTag: ContextItemTag.DIALOGUE_HISTORY,
      messageId: "111111111111111111",
      mediaDescriptors: [
        {
          kind: "image",
          uri: "https://cdn.example/image.png",
          mimeType: "image/png",
          fallbackUri: "https://fallback.example/image.png",
          mediaId: "media_1",
          withinWindow: true,
          filename: "image.png",
        },
      ],
    };
    const presetData: CachedPresetData = {
      preset: {
        preset_id: 1,
        server_id: 1,
        preset_name: "Descriptor Preset",
        raw_json: {},
        is_active: true,
      },
      nodes: [markerNode("main", 0), markerNode("chatHistory", 1), depthNode("Depth note", 2)],
    };

    const result = await reassembleWithPreset(
      {
        contextItems: [
          {
            role: "system",
            parts: [{ type: "text", text: "System prompt" }],
            metadataTag: ContextItemTag.SYSTEM_HUMANIZER_RULES,
          },
          dialogueItem,
        ],
        tailDirectives: [],
        lowerPriorityTailDirectives: [],
      },
      presetData,
      {
        triggererName: "Alice",
        tomoriNickname: "Tomori",
        tomoriAttributes: [],
        personaPrompt: null,
        sampleDialoguesIn: [],
        sampleDialoguesOut: [],
        lastUserMessage: "look",
      },
      {
        client: {} as Client,
        guildId: "111111111111111111",
        triggererName: "Alice",
        triggererFormattedName: "Alice",
        triggererAddressTerm: "",
        botName: "Tomori",
        personalMemoriesEnabled: true,
      },
    );

    const reorderedDialogue = result.contextItems.find((item) => item.metadataTag === ContextItemTag.DIALOGUE_HISTORY);

    expect(reorderedDialogue?.mediaDescriptors).toEqual(dialogueItem.mediaDescriptors);
    expect(reorderedDialogue?.parts).toEqual([
      { type: "text", text: "Alice: look" },
      { type: "text", text: "\n[System: Depth note]" },
    ]);
  });
});
