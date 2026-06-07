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

describe("reassembleWithPreset", () => {
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
