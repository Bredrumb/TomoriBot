import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { Client } from "discord.js";
import type { ServerMemoryRow } from "@/types/db/schema";
import { serverMemoryRepository } from "@/utils/db/repositories";
import { buildServerMemoryContextItem } from "@/utils/text/context/memories";
import { formatMemoryWithId } from "@/utils/memory/memoryId";
import { fitNovelAIPrompt } from "@/providers/novelai/promptFitting";
import { getNovelAIProfile } from "@/providers/novelai/modelProfiles";
import { ContextItemTag } from "@/types/misc/context";
import { createPersona } from "../../helpers/fixtures";

const SCOPED_CHANNEL = "111111111111111111";
const THREAD_IN_SCOPED_CHANNEL = "222222222222222222";
const OTHER_CHANNEL = "333333333333333333";

function memoryRow(
  id: number,
  content: string,
  channelDiscIds: string[],
  options: { pending?: boolean; tags?: string[] } = {},
): ServerMemoryRow {
  return {
    server_memory_id: id,
    server_id: 1,
    persona_id: 1,
    persona_lineage_id: 100,
    user_id: 1,
    content,
    tags: options.tags ?? [],
    channel_disc_ids: channelDiscIds,
    channel_scope_pending: options.pending ?? false,
  };
}

async function memoryItemIn(channelId: string, parentChannelId: string | null, channelMemoryEnabled = true) {
  return buildServerMemoryContextItem({
    tomoriState: createPersona({ server_memories: ["everywhere fact", "channel-only fact"] }),
    guildId: "guild-1",
    serverName: "Server",
    isDMChannel: false,
    botName: "Mirri",
    personalMemoriesEnabled: true,
    channelId,
    parentChannelId,
    channelMemoryEnabled,
    client: {} as Client,
    convertMentions: async (text) => text,
  });
}

async function memoryTextIn(channelId: string, parentChannelId: string | null, channelMemoryEnabled = true) {
  const item = await memoryItemIn(channelId, parentChannelId, channelMemoryEnabled);
  const part = item?.parts[0];
  return part?.type === "text" ? part.text : "";
}

describe("server memory channel scope", () => {
  let loadSpy: { mockRestore(): void } | undefined;

  afterEach(() => {
    loadSpy?.mockRestore();
  });

  function loadRows() {
    loadSpy = spyOn(serverMemoryRepository, "loadServerMemoriesScoped").mockResolvedValue([
      memoryRow(1, "everywhere fact", []),
      memoryRow(2, "channel-only fact", [SCOPED_CHANNEL]),
      memoryRow(3, "unresolved fact", [], { pending: true }),
    ]);
  }

  it("sends plain server memory contents to every NovelAI profile while retaining tool IDs for other providers", async () => {
    const rows = [
      memoryRow(97, "Juno keeps reference ID:505 in a notebook.", []),
      memoryRow(98, "Mirri collects maps.", []),
    ];
    loadSpy = spyOn(serverMemoryRepository, "loadServerMemoriesScoped").mockResolvedValue(rows);
    const item = await memoryItemIn(SCOPED_CHANNEL, null);
    if (!item) throw new Error("Server memory context is missing");
    const part = item.parts[0];
    if (part?.type !== "text") throw new Error("Server memory context contains no text");
    expect(part.text).toContain(formatMemoryWithId(97, rows[0].content));
    expect(item.memoryEntries?.map((entry) => entry.text)).toEqual(rows.map((row) => row.content));
    for (const model of ["glm-4-6", "xialong-v1", "kayra-v1", "llama-3-erato-v1"]) {
      for (const withHistory of [false, true]) {
        const fitted = fitNovelAIPrompt({
          contextItems: [
            item,
            ...(withHistory
              ? [
                  {
                    role: "user" as const,
                    metadataTag: ContextItemTag.DIALOGUE_HISTORY,
                    completionText: "Mirri: Hello.",
                    parts: [{ type: "text" as const, text: "Mirri: Hello." }],
                  },
                ]
              : []),
          ],
          tomoriState: createPersona(),
          profile: getNovelAIProfile(model),
          window: 4096,
          maxOutputTokens: 96,
        });
        expect(fitted.prompt).toContain(rows.map((row) => row.content).join("\n"));
        expect(fitted.prompt).not.toContain("ID:97");
        expect(fitted.prompt).not.toContain("[tags:");
        expect(fitted.report.included.some((id) => id.endsWith("server:97"))).toBe(true);
      }
    }
  });

  it("keeps a scoped memory in its channel and in that channel's threads", async () => {
    loadRows();
    expect(await memoryTextIn(SCOPED_CHANNEL, null)).toContain("channel-only fact");
    expect(await memoryTextIn(THREAD_IN_SCOPED_CHANNEL, SCOPED_CHANNEL)).toContain("channel-only fact");
  });

  it("drops a scoped memory elsewhere while an unscoped memory stays everywhere", async () => {
    loadRows();
    const text = await memoryTextIn(OTHER_CHANNEL, null);
    expect(text).toContain("everywhere fact");
    expect(text).not.toContain("channel-only fact");
  });

  it("treats a memory with an unresolved legacy scope as active in every channel", async () => {
    loadRows();
    expect(await memoryTextIn(SCOPED_CHANNEL, null)).toContain("unresolved fact");
    expect(await memoryTextIn(OTHER_CHANNEL, null)).toContain("unresolved fact");
    expect(await memoryTextIn(OTHER_CHANNEL, null, false)).toContain("unresolved fact");
  });

  it("ignores scopes when channel memory is disabled", async () => {
    loadRows();
    expect(await memoryTextIn(OTHER_CHANNEL, null, false)).toContain("channel-only fact");
  });

  it("ignores legacy keyword and channel tags and omits them from the rendered block", async () => {
    loadSpy = spyOn(serverMemoryRepository, "loadServerMemoriesScoped").mockResolvedValue([
      memoryRow(1, "keyword tagged fact", [], { tags: ['"winter"'] }),
      memoryRow(2, "hash tagged fact", [], { tags: ["#elsewhere"] }),
    ]);
    const text = await memoryTextIn(OTHER_CHANNEL, null);
    expect(text).toContain("keyword tagged fact");
    expect(text).toContain("hash tagged fact");
    expect(text).not.toContain("[tags:");
    expect(text).not.toContain("winter");
    expect(text).not.toContain("elsewhere");
  });
});
