import { describe, expect, test } from "bun:test";
import type { Client } from "discord.js";
import type { CachedPresetData } from "@/utils/cache/stPresetCache";
import { createToolPromptMacroResolver } from "@/utils/tools/toolPromptMacros";
import { resolvePresetMacros, type MacroContext } from "@/utils/text/stPresetEngine";
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
  macroOverrides: Partial<Parameters<typeof reassembleWithPreset>[2]> = {},
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
      model: "configured-model",
      provider: "google",
      utcOffsetHours: 8,
      nowMs: Date.UTC(2026, 0, 1),
      ...macroOverrides,
    },
    {
      client: {} as Client,
      guildId: "111111111111111111",
      triggererName: "Alice",
      triggererFormattedName: "Alice",
      triggererAddressTerm: "",
      botName: "Tomori",
      personalMemoriesEnabled: true,
      toolPromptMacroResolver: createToolPromptMacroResolver({ capabilities: { web_search: true } }),
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

const macroContext: MacroContext = {
  userName: "Juno",
  charName: "Mirri",
  personality: "curious",
  description: "A traveler.",
  scenario: "",
  mesExamples: "",
  lastChatMessage: "look",
  model: "configured-model",
  provider: "google",
  charVersion: "",
  utcOffsetHours: 5.75,
  nowMs: Date.UTC(2026, 9, 28, 20, 30),
};

function customNode(content: string, order = 0): CachedPresetData["nodes"][number] {
  return { ...depthNode(content, order), identifier: `custom_${order}`, injection_position: 0 };
}

function resolvedTexts(contents: string[], overrides: Partial<MacroContext> = {}): string[] {
  return resolvePresetMacros(
    contents.map((content, order) => customNode(content, order)),
    { ...macroContext, ...overrides },
  ).resolved.map((node) => node.content);
}

function itemTexts(items: StructuredContextItem[]): string[] {
  return items.flatMap((item) => item.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])));
}

describe("preset conditional and runtime macro expansion", () => {
  test("conditions see declarations so far while body lookups see final values", () => {
    expect(
      resolvedTexts([
        "{{getvar::flag}}/{{#if getvar::flag}}early{{else}}unset{{/if}}",
        "{{setvar::flag::1}}{{#if {{getvar::flag}}}}same-node{{/if}}",
        "{{#if getvar::flag}}previous-node{{else}}wrong{{/if}}{{setvar::flag::0}}",
      ]),
    ).toEqual(["0/unset", "same-node", "previous-node"]);
  });

  test("untaken and malformed branches cannot set or append variables", () => {
    expect(
      resolvedTexts([
        "{{setvar::value::base}}{{#if missing}}{{setvar::value::wrong}}{{addvar::value::bad}}{{else}}{{addvar::value::+kept}}{{#unless description}}{{setvar::value::wrong}}{{/unless}}{{/if}}",
        "{{#if description}}{{setvar::value::wrong}}{{else}}b{{else}}c{{/if}}",
        "{{getvar::value}}",
      ]),
    ).toEqual(["", "", "base+kept"]);
  });

  test("disabled, comment, and marker nodes contribute no variables", () => {
    const nodes = [
      { ...customNode("{{setvar::flag::1}}"), is_enabled: false },
      { ...customNode("{{// flag stays unset}}", 1), is_comment: true },
      { ...markerNode("main", 2), content: "{{setvar::flag::1}}" },
      customNode("{{#if getvar::flag}}wrong{{else}}kept{{/if}}", 3),
    ];
    expect(resolvePresetMacros(nodes, macroContext).resolved.at(-1)?.content).toBe("kept");
  });

  test("bare and nested value macros share runtime, identity, and unknown-value semantics", () => {
    expect(
      resolvedTexts([
        "{{#if description}}d{{/if}}{{#if {{personality}}}}p{{/if}}{{#if user}}u{{/if}}{{#if bot}}c{{/if}}{{#if provider}}r{{/if}}{{#if input}}i{{/if}}",
        "{{#if {{unknown_flag}}}}bad{{else}}unknown{{/if}}/{{#unless scenario}}empty{{/unless}}/{{#unless char_version}}unversioned{{/unless}}",
      ]),
    ).toEqual(["dpucri", "unknown/empty/unversioned"]);
  });

  test("preserves two-pass variables, random, roll, comments, trim, and identity tokens", () => {
    expect(
      resolvedTexts([
        "{{trim}}{{// ignored}}{{getvar::later}}/{{random: chosen}}/{{random::legacy}}/{{roll:1d1}}/{{user}}/{{char}}/{{bot}}  ",
        "{{setvar::later::final}}{{addvar::later::+append}}",
      ]),
    ).toEqual(["final+append/chosen/legacy/1/{{user}}/{{char}}/{{bot}}", ""]);
  });

  test("testing description in a condition preserves its native marker", async () => {
    const items = await reassemble(
      [customNode("{{#if {{description}}}}present{{/if}}"), markerNode("charDescription", 1)],
      [taggedItem(ContextItemTag.SYSTEM_PERSONA_PROMPT, "Native description")],
      { personaPrompt: "A traveler." },
    );
    expect(itemTexts(items)).toEqual(["present", "Native description"]);
  });

  test("only selected content macro expansions suppress native markers", () => {
    expect(
      resolvePresetMacros([customNode("{{#if missing}}{{description}}{{else}}{{personality}}{{/if}}")], macroContext)
        .expandedContentMacros,
    ).toEqual(new Set(["personality"]));
  });

  test("runs tool conditionals after Handlebars and identity conversion last", async () => {
    const items = await reassemble(
      [
        customNode(
          "{{#if description}}{{if capability:web_search}}{{char}} can use {memory_tool}{{else}}offline{{/if}}{{/if}}",
        ),
        customNode("{{if capability:web_search}}{{#unless scenario}}{{user}} asks{{/unless}}{{/if}}", 1),
      ],
      [],
      { personaPrompt: "A traveler." },
    );
    expect(itemTexts(items)).toEqual(["Tomori can use `create_long_term_memory`", "Alice asks"]);
  });

  test("preserves variable collection from both tool-conditional branches before the async pass", async () => {
    const items = await reassemble(
      [
        customNode(
          "{{if capability:web_search}}{{setvar::flag::first}}{{else}}{{setvar::flag::last}}{{/if}}{{getvar::flag}}",
        ),
      ],
      [],
    );
    expect(itemTexts(items)).toEqual(["last"]);
  });

  test("formats all temporal macros with one fixed instant and a fractional server offset", async () => {
    const items = await reassemble(
      [customNode("{{time}}|{{date}}|{{weekday}}"), customNode("{{isotime}}|{{isodate}}", 1)],
      [],
      { nowMs: macroContext.nowMs, utcOffsetHours: 5.75 },
    );
    expect(itemTexts(items)).toEqual(["2:15 AM|October 29, 2026|Thursday", "02:15|2026-10-29"]);
    expect(resolvedTexts(["{{time}}|{{date}}|{{weekday}}|{{isotime}}|{{isodate}}"], { utcOffsetHours: -3.5 })).toEqual([
      "5:00 PM|October 28, 2026|Wednesday|17:00|2026-10-28",
    ]);
  });

  test("time awareness off empties every temporal macro in text and conditions", async () => {
    const items = await reassemble(
      [customNode("[{{time}}|{{date}}|{{weekday}}|{{isotime}}|{{isodate}}]{{#if time}}wrong{{else}}off{{/if}}")],
      [],
      { utcOffsetHours: null },
    );
    expect(itemTexts(items)).toEqual(["[||||]off"]);
  });

  test.each([
    "google",
    "openrouter",
    "novelai",
    "custom",
  ])("maps configured model, %s provider, and input alias", async (provider) => {
    const items = await reassemble(
      [customNode("{{model}}|{{provider}}|{{char_version}}|{{scenario}}|{{input}}|{{lastChatMessage}}")],
      [],
      { model: "configured-model", provider, lastUserMessage: "Look at the lantern." },
    );
    expect(itemTexts(items)).toEqual([`configured-model|${provider}|||Look at the lantern.|Look at the lantern.`]);
  });
});
