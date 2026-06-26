import { describe, expect, it } from "bun:test";
import type { Client } from "discord.js";
import { HumanizerDegree, type AssembledServerConfig, type TomoriState } from "@/types/db/schema";
import { appendDialogueHistoryContext } from "@/utils/text/context/dialogueHistory";
import type { SimplifiedMessageForContext } from "@/utils/text/context/types";

function makeMessage(index: number): SimplifiedMessageForContext {
  return {
    id: `message-${index}`,
    authorId: `user-${index}`,
    authorName: `User ${index}`,
    authorType: "user",
    content: `message ${index}`,
    imageAttachments: [],
    videoAttachments: [],
  };
}

function makeConfig(verbatimToolCallingEnabled: boolean): AssembledServerConfig {
  return {
    message_fetch_limit: 80,
    context_note: null,
    context_note_depth: 0,
    humanizer_degree: HumanizerDegree.NONE,
    personal_memories_enabled: true,
    uncensor_unicode_space_enabled: false,
    uncensor_sanitize_enabled: false,
    verbatim_tool_calling_enabled: verbatimToolCallingEnabled,
  } as AssembledServerConfig;
}

function makeTomoriState(hasTools: boolean): TomoriState {
  return {
    context_note: null,
    context_note_depth: 0,
    llm: {
      has_tools: hasTools,
    },
  } as TomoriState;
}

async function buildItems(options: { verbatimToolCallingEnabled: boolean; hasTools: boolean; messageCount?: number }) {
  const contextItems = [];
  await appendDialogueHistoryContext({
    contextItems,
    client: {} as Client,
    guildId: "guild-1",
    simplifiedMessageHistory: Array.from({ length: options.messageCount ?? 5 }, (_, index) => makeMessage(index)),
    botName: "Tomori",
    tomoriConfig: makeConfig(options.verbatimToolCallingEnabled),
    tomoriState: makeTomoriState(options.hasTools),
    includeTimestamps: false,
    isUserImpersonation: false,
    uncensorInputOptions: { unicodeSpacesEnabled: false, sanitizeEnabled: false },
    convertMentions: async (text) => text,
  });
  return contextItems;
}

function itemText(item: { parts: Array<{ type: string; text?: string }> }): string {
  return item.parts.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");
}

describe("appendDialogueHistoryContext — verbatim tool-calling nudge", () => {
  it("injects the nudge at depth 3 when enabled and tools are available", async () => {
    const items = await buildItems({ verbatimToolCallingEnabled: true, hasTools: true });
    const nudgeIndex = items.findIndex((item) => itemText(item).includes("Experimental verbatim tool calling"));
    const messageTwoIndex = items.findIndex((item) => item.messageId === "message-2");

    expect(nudgeIndex).toBeGreaterThan(-1);
    expect(nudgeIndex).toBe(messageTwoIndex - 1);
  });

  it("does not inject the nudge when the workaround flag is off", async () => {
    const items = await buildItems({ verbatimToolCallingEnabled: false, hasTools: true });

    expect(items.some((item) => itemText(item).includes("Experimental verbatim tool calling"))).toBe(false);
  });

  it("does not inject the nudge when effective tools are disabled", async () => {
    const items = await buildItems({ verbatimToolCallingEnabled: true, hasTools: false });

    expect(items.some((item) => itemText(item).includes("Experimental verbatim tool calling"))).toBe(false);
  });
});
