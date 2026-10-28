import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Client } from "discord.js";
import * as realShortTermMemoryCache from "@/utils/cache/shortTermMemoryCache";
import type { ShortTermMemoryEntry } from "@/utils/cache/shortTermMemoryCache";
import * as realUserCache from "@/utils/cache/userCache";
import { ContextItemTag } from "@/types/misc/context";
import { createScopedModuleMocker } from "../../helpers/mockSurface";
import { createPersona } from "../../helpers/fixtures";
import { serverStmConfigSchema, stmCategorySchema } from "@/types/db/schema";
import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
import { fitNovelAIPrompt } from "@/providers/novelai/promptFitting";
import { getNovelAIProfile } from "@/providers/novelai/modelProfiles";

let otherChannelEntries: ShortTermMemoryEntry[] = [];
let sameChannelEntry: ShortTermMemoryEntry | undefined;

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/cache/shortTermMemoryCache": realShortTermMemoryCache,
  "@/utils/cache/userCache": realUserCache,
});

scopedMock.module("@/utils/cache/shortTermMemoryCache", () => ({
  ...realShortTermMemoryCache,
  preWarmServerStmEntries: mock(async () => undefined),
  getShortTermMemoriesForServer: mock(() => otherChannelEntries),
  preWarmStmEntry: mock(async () => undefined),
  getShortTermMemoryForServerChannel: mock(() => sameChannelEntry),
}));

scopedMock.module("@/utils/cache/userCache", () => ({
  ...realUserCache,
  getCachedUserRow: mock(async () => null),
}));

const { buildShortTermMemoryContext } = await import("@/utils/text/context/memories");

/** A row warmed from the DB after its summary was cleared: no messages, summary, or category values. */
function hydratedEntry(channelId: string, lastUpdated: number, overrides: Partial<ShortTermMemoryEntry> = {}) {
  return { messages: [], serverId: "server-1", channelId, lastUpdated, ...overrides } satisfies ShortTermMemoryEntry;
}

async function recallText() {
  const { memoryItems } = await buildShortTermMemoryContext({
    triggeringUserId: "user-1",
    currentChannelId: "channel-current",
    currentServerId: "server-1",
    tomoriState: null,
    triggererName: "Mirri",
    botName: "Juno",
    personalMemoriesEnabled: false,
    client: {} as Client,
    isUserImpersonation: false,
    convertMentions: async (text) => text,
  });
  return memoryItems
    .filter((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY)
    .flatMap((item) => item.parts.map((part) => (part.type === "text" ? part.text : "")));
}

describe("other-channel short-term recall", () => {
  beforeEach(() => {
    otherChannelEntries = [];
    sameChannelEntry = undefined;
  });
  afterEach(() => {
    spyOn(shortTermMemoryRepository, "getStmConfig").mockRestore();
    spyOn(shortTermMemoryRepository, "getStmCategories").mockRestore();
  });

  it("keeps tool nudges for capable providers but excludes them from every NovelAI prompt", async () => {
    const loadConfig = spyOn(shortTermMemoryRepository, "getStmConfig");
    const loadCategories = spyOn(shortTermMemoryRepository, "getStmCategories");
    for (const categoryMode of [false, true]) {
      for (const override of [null, "custom-cadence-directive"]) {
        loadConfig.mockResolvedValue(serverStmConfigSchema.parse({ server_id: 1, update_nudge_override: override }));
        loadCategories.mockResolvedValue(
          categoryMode
            ? [
                stmCategorySchema.parse({
                  server_id: 1,
                  category_id: 1,
                  position: 0,
                  label: "Plans",
                  description: "Activities",
                }),
              ]
            : [],
        );
        sameChannelEntry = hydratedEntry("channel-current", Date.now(), {
          summary: "Juno played Celeste.",
          turnsSinceRefresh: 5,
          ...(categoryMode ? { categories: { plans: "Juno played Celeste." } } : {}),
        });
        const source = await buildShortTermMemoryContext({
          triggeringUserId: "user-1",
          currentChannelId: "channel-current",
          currentServerId: "server-1",
          tomoriState: createPersona(),
          triggererName: "Mirri",
          botName: "Juno",
          personalMemoriesEnabled: false,
          client: {} as Client,
          isUserImpersonation: false,
          convertMentions: async (text) => text,
        });
        expect(source.nudgeItem).toBeDefined();
        const nudge = source.nudgeItem;
        if (!nudge) throw new Error("Missing cadence nudge fixture");
        const ordinaryText = nudge.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
        expect(ordinaryText.length).toBeGreaterThan(0);
        expect(source.memoryItems.length).toBeGreaterThan(0);
        for (const model of ["kayra-v1", "llama-3-erato-v1", "glm-4-6", "xialong-v1"]) {
          const prepared = fitNovelAIPrompt({
            contextItems: [...source.memoryItems, nudge],
            tomoriState: createPersona(),
            profile: getNovelAIProfile(model),
            window: 4096,
          });
          expect(prepared.prompt).toContain("Juno played Celeste.");
          expect(prepared.prompt).not.toMatch(
            /update_short_term_memory|create_long_term_memory|update_long_term_memory|custom-cadence-directive/u,
          );
          expect(prepared.report.excluded.some((id) => id.includes(ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY))).toBe(
            true,
          );
        }
        expect(nudge.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")).toBe(ordinaryText);
      }
    }
  });

  it("skips entries with nothing to recall so they neither render empty blocks nor displace real ones", async () => {
    otherChannelEntries = [
      hydratedEntry("channel-a", 4000),
      hydratedEntry("channel-b", 3000, { categories: { mood: "  " } }),
      hydratedEntry("channel-c", 2000),
      hydratedEntry("channel-d", 1000, { summary: "Planned a Celeste speedrun." }),
    ];

    const texts = await recallText();

    expect(texts).toHaveLength(1);
    expect(texts[0]?.match(/\[System:/g)).toHaveLength(1);
    expect(texts[0]).toContain("Planned a Celeste speedrun.");
  });

  it("adds no recall item when every entry is empty", async () => {
    otherChannelEntries = [hydratedEntry("channel-a", 2000), hydratedEntry("channel-b", 1000)];

    expect(await recallText()).toEqual([]);
  });
});
