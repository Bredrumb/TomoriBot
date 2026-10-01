import { beforeAll, describe, expect, it } from "bun:test";
import { NOTICE_CONFIG_HINT_KEY, type ToolNoticeKey } from "@/constants/toolNotices";
import type { ToolContext } from "@/types/tool/interfaces";
import { sendMemoryEmbedWithExpand, sendToolNoticeContainer } from "@/utils/discord/expandableEmbedNotice";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";

beforeAll(async () => initializeLocalizer());

const SOURCE_URL = "https://discord.com/channels/1/200/300";

function fakeChannel(id: string, options: { dm?: boolean; parentId?: string } = {}) {
  const sent: string[] = [];
  return {
    id,
    sent,
    parentId: options.parentId ?? null,
    isThread: () => options.parentId !== undefined,
    isDMBased: () => options.dm ?? false,
    send: async (payload: unknown) => {
      sent.push(JSON.stringify(payload));
      return null;
    },
  };
}

function buildContext(input: {
  hidden: ToolNoticeKey[];
  conversation: ReturnType<typeof fakeChannel>;
  thoughtLog?: ReturnType<typeof fakeChannel>;
  privateChannelIds?: string[];
}): ToolContext {
  return {
    channel: input.conversation,
    locale: "en-US",
    message: { url: SOURCE_URL },
    client: {
      channels: { fetch: async (id: string) => (input.thoughtLog?.id === id ? input.thoughtLog : null) },
    },
    tomoriState: {
      config: {
        tool_notice_hidden_keys: input.hidden,
        thought_log_channel_disc_id: input.thoughtLog?.id ?? null,
        private_channel_ids: input.privateChannelIds ?? [],
      },
    },
  } as unknown as ToolContext;
}

const memoryNotice = {
  titleKey: "genai.self_teach.server_memory_learned_title",
  titleVars: { persona_nickname: "Tomori" },
  descriptionKey: "genai.self_teach.server_memory_learned_description",
  descriptionVars: { memory_content: "likes tea" },
  footerKey: "genai.self_teach.server_memory_footer",
};

// JSON-encoded payloads escape backticks and quotes the same way, so compare in that encoding.
const encoded = (text: string) => JSON.stringify(text).slice(1, -1);
const configHint = () => encoded(localizedCopy("en-US", NOTICE_CONFIG_HINT_KEY));

describe("hideable tool notices", () => {
  it("posts a visible memory notice in the conversation with the shared /config line under its own footer", async () => {
    const conversation = fakeChannel("200");
    const thoughtLog = fakeChannel("900");
    await sendMemoryEmbedWithExpand(buildContext({ hidden: [], conversation, thoughtLog }), memoryNotice, "likes tea");

    expect(thoughtLog.sent).toHaveLength(0);
    expect(conversation.sent).toHaveLength(1);
    const footer = encoded(localizedCopy("en-US", "genai.self_teach.server_memory_footer"));
    expect(conversation.sent[0]).toContain(`-# ${footer}\\n-# ${configHint()}`);
  });

  it("reroutes a hidden memory notice to the thought log with a link to its source message", async () => {
    const conversation = fakeChannel("200");
    const thoughtLog = fakeChannel("900");
    await sendMemoryEmbedWithExpand(
      buildContext({ hidden: ["memory_update"], conversation, thoughtLog }),
      memoryNotice,
      "likes tea",
    );

    expect(conversation.sent).toHaveLength(0);
    expect(thoughtLog.sent).toHaveLength(1);
    expect(thoughtLog.sent[0]).toContain(SOURCE_URL);
    expect(thoughtLog.sent[0]).toContain("likes tea");
  });

  it("hides only the toggled notice type", async () => {
    const conversation = fakeChannel("200");
    const thoughtLog = fakeChannel("900");
    await sendToolNoticeContainer(
      buildContext({ hidden: ["task_update"], conversation, thoughtLog }),
      "user_info_update",
      {
        titleKey: "tools.user_info_update.success_title",
        titleVars: { target_user: "Eli" },
        description: "Updated",
      },
    );

    expect(conversation.sent).toHaveLength(1);
    expect(thoughtLog.sent).toHaveLength(0);
  });

  it.each<[string, Omit<Parameters<typeof buildContext>[0], "hidden">]>([
    ["no thought log is set", { conversation: fakeChannel("200") }],
    ["the notice came from a DM", { conversation: fakeChannel("200", { dm: true }), thoughtLog: fakeChannel("900") }],
    [
      "the notice came from a private channel",
      { conversation: fakeChannel("200"), thoughtLog: fakeChannel("900"), privateChannelIds: ["200"] },
    ],
    [
      "the notice came from a thread under a private channel",
      {
        conversation: fakeChannel("201", { parentId: "200" }),
        thoughtLog: fakeChannel("900"),
        privateChannelIds: ["200"],
      },
    ],
  ])("drops a hidden notice when %s", async (_case, setup) => {
    await sendToolNoticeContainer(buildContext({ hidden: ["user_info_update"], ...setup }), "user_info_update", {
      titleKey: "tools.user_info_update.success_title",
      titleVars: { target_user: "Eli" },
      description: "Updated",
    });

    expect(setup.conversation.sent).toHaveLength(0);
    expect(setup.thoughtLog?.sent ?? []).toHaveLength(0);
  });
});
