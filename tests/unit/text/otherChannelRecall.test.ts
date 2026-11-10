import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { ChannelType, Collection, type Client } from "discord.js";
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
import { applyPromptLayoutInserts, STM_TAIL_SLOT, type PromptLayoutItem } from "@/utils/text/context/promptLayout";
import { resolveRandomChoiceMacrosInBuildOutput } from "@/utils/text/context/templates";
import { createGuildTextChannel } from "../../helpers/discordChannels";
import * as stateCache from "@/utils/cache/tomoriStateCache";
import { createUserRow } from "../../helpers/fixtures";

let otherChannelEntries: ShortTermMemoryEntry[] = [];
let sameChannelEntry: ShortTermMemoryEntry | undefined;
let userEntries: ShortTermMemoryEntry[] = [];
let crossServerOptIn = false;
const channels = new Collection<string, ReturnType<typeof createGuildTextChannel>>();
const client = {
  channels: { cache: channels, fetch: async (id: string) => channels.get(id) ?? null },
} as unknown as Client;

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
  getShortTermMemoriesForUser: mock(() => userEntries),
  preWarmUserStmEntries: mock(async () => undefined),
}));

scopedMock.module("@/utils/cache/userCache", () => ({
  ...realUserCache,
  getCachedUserRow: mock(async () => createUserRow({ shortterm_cache_crossserver_opt_in: crossServerOptIn })),
}));

const { buildShortTermMemoryContext } = await import("@/utils/text/context/memories");

/** A row warmed from the DB after its summary was cleared: no messages, summary, or category values. */
function hydratedEntry(channelId: string, lastUpdated: number, overrides: Partial<ShortTermMemoryEntry> = {}) {
  return { messages: [], serverId: "server-1", channelId, lastUpdated, ...overrides } satisfies ShortTermMemoryEntry;
}

async function recallText(tomoriState = createPersona()) {
  const { memoryItems } = await buildShortTermMemoryContext({
    triggeringUserId: "user-1",
    currentChannelId: "channel-current",
    currentServerId: "server-1",
    tomoriState,
    triggererName: "Mirri",
    botName: "Juno",
    personalMemoriesEnabled: false,
    client,
    isUserImpersonation: false,
    convertMentions: async (text) => text,
  });
  return memoryItems
    .filter((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY)
    .flatMap((item) => item.parts.map((part) => (part.type === "text" ? part.text : "")));
}

describe("other-channel short-term recall", () => {
  beforeEach(() => {
    spyOn(shortTermMemoryRepository, "getStmConfig").mockResolvedValue(null);
    spyOn(shortTermMemoryRepository, "getStmCategories").mockResolvedValue([]);
    otherChannelEntries = [];
    sameChannelEntry = undefined;
    userEntries = [];
    crossServerOptIn = false;
    channels.clear();
    for (const id of ["channel-current", "channel-other", "channel-a", "channel-b", "channel-c", "channel-d"])
      channels.set(id, createGuildTextChannel(id));
  });
  afterEach(() => {
    spyOn(shortTermMemoryRepository, "getStmConfig").mockRestore();
    spyOn(shortTermMemoryRepository, "getStmCategories").mockRestore();
    spyOn(stateCache, "getCachedTomoriState").mockRestore();
  });

  it("isolates private sources and destinations for summaries, categories, and crude messages unless sharing is allowed", async () => {
    spyOn(shortTermMemoryRepository, "getStmConfig").mockResolvedValue(null);
    spyOn(shortTermMemoryRepository, "getStmCategories").mockResolvedValue([]);
    for (const content of [
      { summary: "confidential-marker" },
      { categories: { plans: "confidential-marker" } },
      { messages: [{ role: "user" as const, content: "confidential-marker", timestamp: Date.now() }] },
    ]) {
      for (const restriction of [
        "manual-source",
        "manual-destination",
        "both-manual",
        "restricted-source",
        "restricted-destination",
        "deny",
        "thread",
        "private-thread",
        "missing",
        "public",
      ]) {
        for (const bypass of [false, true]) {
          channels.set(
            "channel-current",
            createGuildTextChannel("channel-current", { everyoneCanView: restriction !== "restricted-destination" }),
          );
          const source = createGuildTextChannel("channel-other", {
            everyoneCanView: restriction !== "restricted-source",
            viewDenied: restriction === "deny",
          });
          const privateIds =
            restriction === "manual-source"
              ? ["channel-other"]
              : restriction === "manual-destination"
                ? ["channel-current"]
                : restriction === "both-manual"
                  ? ["channel-current", "channel-other"]
                  : restriction === "thread"
                    ? ["private-parent"]
                    : [];
          if (restriction === "thread" || restriction === "private-thread") {
            Object.assign(source, {
              type: restriction === "private-thread" ? ChannelType.PrivateThread : ChannelType.PublicThread,
              isThread: () => true,
              parent: createGuildTextChannel("private-parent"),
            });
          }
          channels.set("channel-other", source);
          if (restriction === "missing") channels.delete("channel-other");
          otherChannelEntries = [hydratedEntry("channel-other", Date.now(), content)];
          const texts = await recallText(
            createPersona({ config: { private_channel_ids: privateIds, stm_privacy_bypass: bypass } }),
          );
          expect(texts.join("\n").includes("confidential-marker"), `${restriction}, bypass=${bypass}`).toBe(
            bypass || restriction === "public",
          );
        }
      }
    }
  });

  it("keeps same-channel STM when privacy blocks recall and filters before applying the recall limit", async () => {
    spyOn(shortTermMemoryRepository, "getStmConfig").mockResolvedValue(null);
    spyOn(shortTermMemoryRepository, "getStmCategories").mockResolvedValue([]);
    sameChannelEntry = hydratedEntry("channel-current", Date.now(), { summary: "local-marker" });
    otherChannelEntries = ["channel-a", "channel-b", "channel-c", "channel-d"].map((id, index) =>
      hydratedEntry(id, Date.now() - index, { summary: id }),
    );
    expect(
      (await recallText(createPersona({ config: { private_channel_ids: ["channel-current"] } }))).join("\n"),
    ).toContain("local-marker");
    const texts = await recallText(
      createPersona({ config: { private_channel_ids: ["channel-a", "channel-b", "channel-c"] } }),
    );
    expect(texts.join("\n")).toContain("channel-d");
    expect(texts.join("\n")).not.toContain("<#channel-a>");
  });

  it("honors the source server's private list and sharing setting for cross-server opt-ins", async () => {
    spyOn(shortTermMemoryRepository, "getStmConfig").mockResolvedValue(null);
    spyOn(shortTermMemoryRepository, "getStmCategories").mockResolvedValue([]);
    crossServerOptIn = true;
    channels.set("foreign-channel", createGuildTextChannel("foreign-channel", { guildId: "server-2" }));
    userEntries = [hydratedEntry("foreign-channel", Date.now(), { serverId: "server-2", summary: "foreign-marker" })];
    const loadState = spyOn(stateCache, "getCachedTomoriState");
    for (const sourceBypass of [false, true]) {
      loadState.mockResolvedValue(
        createPersona({ config: { private_channel_ids: ["foreign-channel"], stm_privacy_bypass: sourceBypass } }),
      );
      expect((await recallText()).join("\n").includes("foreign-marker")).toBe(sourceBypass);
    }
    loadState.mockResolvedValue(null);
    expect(await recallText()).toEqual([]);
  });

  it("uses the tail slot for fresh same-channel memory and every rendered other-channel block", async () => {
    spyOn(shortTermMemoryRepository, "getStmConfig").mockResolvedValue(null);
    spyOn(shortTermMemoryRepository, "getStmCategories").mockResolvedValue([]);
    const staleTimestamp = Date.now() - 2 * 60 * 60 * 1000;
    for (const currentState of ["missing", "stale", "fresh"]) {
      for (const otherContent of [
        null,
        { summary: "Other-channel summary" },
        { categories: { plans: "Climb" } },
        { messages: [{ role: "user" as const, content: "Climb", timestamp: staleTimestamp }] },
      ]) {
        sameChannelEntry =
          currentState === "missing"
            ? undefined
            : hydratedEntry("channel-current", currentState === "fresh" ? Date.now() : staleTimestamp, {
                summary: "Same-channel summary",
              });
        otherChannelEntries = otherContent ? [hydratedEntry("channel-other", staleTimestamp, otherContent)] : [];
        const result = await buildShortTermMemoryContext({
          triggeringUserId: "user-1",
          currentChannelId: "channel-current",
          currentServerId: "server-1",
          tomoriState: createPersona(),
          triggererName: "Mirri",
          botName: "Juno",
          personalMemoriesEnabled: false,
          client,
          isUserImpersonation: false,
          convertMentions: async (text) => text,
        });
        expect(result.memoryInjectionDepth).toBe(-1);
        expect(result.memoryItems.length > 0).toBe(currentState !== "missing" || otherContent !== null);
        const shouldUseSlot = currentState === "fresh" || otherContent !== null;
        for (const item of result.memoryItems)
          expect(Boolean((item as PromptLayoutItem)[STM_TAIL_SLOT])).toBe(shouldUseSlot);
      }
    }
  });

  it("compares the saved depth after macro projection instead of comparing item and speaker-turn counts", async () => {
    spyOn(shortTermMemoryRepository, "getStmConfig").mockResolvedValue(
      serverStmConfigSchema.parse({ server_id: 1, content_injection_depth: 3 }),
    );
    spyOn(shortTermMemoryRepository, "getStmCategories").mockResolvedValue([]);
    sameChannelEntry = hydratedEntry("channel-current", Date.now(), { summary: "Same-channel summary" });
    const result = await buildShortTermMemoryContext({
      triggeringUserId: "user-1",
      currentChannelId: "channel-current",
      currentServerId: "server-1",
      tomoriState: createPersona(),
      triggererName: "Mirri",
      botName: "Juno",
      personalMemoriesEnabled: false,
      client,
      isUserImpersonation: false,
      convertMentions: async (text) => text,
    });
    const projected = resolveRandomChoiceMacrosInBuildOutput({
      contextItems: [],
      tailDirectives: [],
      lowerPriorityTailDirectives: [],
      memoryInjectionItems: result.memoryItems,
      memoryInjectionDepth: result.memoryInjectionDepth,
    });
    const items = Array.from({ length: 8 }, (_, index) => ({
      role: "user" as const,
      metadataTag: ContextItemTag.DIALOGUE_HISTORY,
      sender: { id: index % 2 ? "Mirri" : "Juno", name: index % 2 ? "Mirri" : "Juno", type: "user" as const },
      parts: [{ type: "text" as const, text: `Message ${index}` }],
    }));
    applyPromptLayoutInserts(items, [
      { tag: "stm_content", items: projected.memoryInjectionItems ?? [], depth: projected.memoryInjectionDepth },
    ]);
    expect(items.findIndex((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY)).toBe(5);
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
          client,
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
