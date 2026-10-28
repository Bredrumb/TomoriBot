import { REST } from "discord.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  ChannelType,
  Collection,
  PermissionFlagsBits,
  PermissionsBitField,
  type TextChannel,
  type Webhook,
} from "discord.js";
import { NOTICE_CONFIG_HINT_KEY, type NoticeVerbosity, type ToolNoticeKey } from "@/constants/toolNotices";
import type { ToolContext } from "@/types/tool/interfaces";
import { UpdateLongTermMemoryTool } from "@/tools/functionCalls/updateLongTermMemoryTool";
import { UpdateUserInfoTool } from "@/tools/functionCalls/updateUserInfoTool";
import { serverMemoryRepository, userNamingRepository, userRepository } from "@/utils/db/repositories";
import { minimalNoticeRefRepository } from "@/utils/db/repositories/MinimalNoticeRefRepository";
import { clearPersonaAppearances, commitPersonaAppearance } from "@/utils/cache/personaAppearanceCacheStore";
import { clearPersonaSpriteCache, setPersonaSpriteCache } from "@/utils/cache/personaSpriteCacheStore";
import { sendMemoryEmbedWithExpand, sendToolNoticeContainer } from "@/utils/discord/expandableEmbedNotice";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import {
  clearAllChannelDeliveryContinuity,
  getChannelLastDelivery,
  recordChannelDeliveredWebhookIdentity,
} from "@/utils/discord/stream/channelDeliveryContinuity";
import { sendToolNotice } from "@/utils/discord/toolProgressNotice";
import * as lifecycle from "@/utils/discord/webhook/lifecycle";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { localizedCopy } from "../../helpers/localeCases";

beforeAll(async () => initializeLocalizer());

const SOURCE_URL = "https://discord.com/channels/1/200/300";

/** A guild channel every member can read unless `restricted` denies `@everyone` the channel. */
function fakeChannel(id: string, options: { dm?: boolean; parentId?: string; restricted?: boolean } = {}) {
  const sent: string[] = [];
  const delivered: string[] = [];
  const audience = (restricted: boolean) => ({
    permissionsFor: () => new PermissionsBitField(restricted ? 0n : PermissionFlagsBits.ViewChannel),
    permissionOverwrites: { cache: [] },
  });
  return {
    id,
    client: { user: { id: "bot" }, rest: new REST() },
    lastMessageId: null as string | null,
    sent,
    delivered,
    guildId: "guild_1",
    guild: {
      id: "guild_1",
      roles: { everyone: { id: "guild_1" } },
      members: { me: { id: "bot", displayAvatarURL: () => undefined } },
    },
    type: options.parentId === undefined ? ChannelType.GuildText : ChannelType.PublicThread,
    parentId: options.parentId ?? null,
    parent: options.parentId === undefined ? null : { id: options.parentId, ...audience(false) },
    ...audience(options.restricted ?? false),
    isThread: () => options.parentId !== undefined,
    isDMBased: () => options.dm ?? false,
    fetchWebhooks: async () => new Collection(),
    createWebhook: async () => ({ id: "created-webhook", channelId: id }),
    send: async (payload: unknown) => {
      sent.push(JSON.stringify(payload));
      const messageId = `20000000000000000${delivered.length + 10}`;
      delivered.push(messageId);
      return {
        id: messageId,
        channelId: id,
        webhookId: null,
        author: { id: "bot" },
        createMessageComponentCollector: () => ({ on: () => undefined }),
      };
    },
  };
}

function buildContext(input: {
  hidden: ToolNoticeKey[];
  conversation: ReturnType<typeof fakeChannel>;
  thoughtLog?: ReturnType<typeof fakeChannel>;
  privateChannelIds?: string[];
  verbosity?: NoticeVerbosity;
}): ToolContext {
  return {
    channel: input.conversation,
    locale: "en-US",
    message: { url: SOURCE_URL },
    deliveryMode: "persona",
    client: {
      user: { id: "bot" },
      guilds: { cache: new Collection() },
      users: { cache: new Collection(), fetch: async () => null },
      channels: { fetch: async (id: string) => (input.thoughtLog?.id === id ? input.thoughtLog : null) },
    },
    tomoriState: createPersona({
      persona_id: 55,
      persona_nickname: "Mirri",
      config: {
        tool_notice_hidden_keys: input.hidden,
        tool_notice_verbosity: input.verbosity ?? "minimal",
        thought_log_channel_disc_id: input.thoughtLog?.id ?? null,
        private_channel_ids: input.privateChannelIds ?? [],
      },
    }),
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

afterEach(() => {
  mock.restore();
  clearAllChannelDeliveryContinuity();
  clearPersonaAppearances();
  clearPersonaSpriteCache();
});

describe("hideable tool notices", () => {
  it.each([
    ["public", false, false],
    ["private", true, false],
    ["passive public", false, true],
    ["passive private", true, true],
  ] as const)("routes user-info details from a %s channel", async (_label, isPrivate, suppressProgressNotices) => {
    const conversation = fakeChannel("200");
    const thoughtLog = fakeChannel("900");
    const context = buildContext({ hidden: [], conversation, thoughtLog, privateChannelIds: isPrivate ? ["200"] : [] });
    const user = createUserRow({ user_disc_id: "123456789012345678", user_nickname: "Juno" });
    context.userId = user.user_disc_id;
    context.guildId = conversation.guildId;
    context.suppressProgressNotices = suppressProgressNotices;
    spyOn(userRepository, "loadByDiscordId").mockResolvedValue(user);
    spyOn(userNamingRepository, "loadPreferences").mockResolvedValue(new Map());
    spyOn(userNamingRepository, "applyUserInfoBatch").mockResolvedValue(undefined);

    const result = await new UpdateUserInfoTool().execute({ pronouns: "they/them" }, context);

    expect(result).toMatchObject({ success: true });
    expect(conversation.sent).toHaveLength(1);
    expect(conversation.sent[0]).not.toContain("they/them");
    expect(thoughtLog.sent).toHaveLength(isPrivate ? 0 : 1);
    if (!isPrivate) {
      expect(thoughtLog.sent[0]).toContain("they/them");
      expect(thoughtLog.sent[0]).toContain(SOURCE_URL);
      expect(thoughtLog.sent[0]).toContain(configHint());
    }
  });

  it.each(["update", "delete"] as const)("mirrors the memory %s tool's content", async (operation) => {
    const conversation = fakeChannel("200");
    const thoughtLog = fakeChannel("900");
    const context = buildContext({ hidden: [], conversation, thoughtLog });
    const user = createUserRow({ user_disc_id: "123456789012345678", user_nickname: "Juno" });
    context.userId = user.user_disc_id;
    const content = "prefers jasmine tea";
    context.tomoriState.config.self_teaching_enabled = true;
    const memory = { server_memory_id: 24, content, user_id: 1 };
    spyOn(userRepository, "loadByDiscordId").mockResolvedValue(user);
    spyOn(serverMemoryRepository, "updateByIdWithLineage").mockResolvedValue(memory);
    spyOn(serverMemoryRepository, "removeByIdWithLineage").mockResolvedValue(memory);
    spyOn(minimalNoticeRefRepository, "record").mockResolvedValue(true);
    spyOn(minimalNoticeRefRepository, "pruneOlderThanDays").mockResolvedValue(0);

    const result = await new UpdateLongTermMemoryTool().execute(
      { memory_id: memory.server_memory_id, memory_content: operation === "update" ? content : "" },
      context,
    );

    expect(result).toMatchObject({ success: true });
    expect(conversation.sent).toHaveLength(1);
    expect(conversation.sent[0]).not.toContain(content);
    expect(thoughtLog.sent).toHaveLength(1);
    expect(thoughtLog.sent[0]).toContain(content);
    expect(thoughtLog.sent[0]).toContain(SOURCE_URL);
    expect(thoughtLog.sent[0]).toContain(configHint());
  });

  it("posts a visible memory notice in the conversation with the shared /config line under its own footer", async () => {
    const conversation = fakeChannel("200");
    const thoughtLog = fakeChannel("900");
    await sendMemoryEmbedWithExpand(
      buildContext({ hidden: [], conversation, thoughtLog, verbosity: "verbose" }),
      memoryNotice,
      "likes tea",
    );

    expect(thoughtLog.sent).toHaveLength(0);
    expect(conversation.sent).toHaveLength(1);
    const footer = encoded(localizedCopy("en-US", "genai.self_teach.server_memory_footer"));
    expect(conversation.sent[0]).toContain(`-# ${footer}\\n-# ${configHint()}`);
  });

  it("posts a Minimal memory notice as its title alone, with no expand button for long content", async () => {
    const conversation = fakeChannel("200");
    const longContent = "likes tea ".repeat(100);
    await sendMemoryEmbedWithExpand(buildContext({ hidden: [], conversation }), memoryNotice, longContent);

    expect(conversation.sent).toHaveLength(1);
    const [payload] = conversation.sent;
    const title = localizedCopy("en-US", memoryNotice.titleKey, memoryNotice.titleVars);
    expect(payload).toContain(`### ${encoded(title)}`);
    expect(payload).not.toContain("likes tea");
    expect(payload).not.toContain(configHint());
    expect(payload).not.toContain("memory_notice_expand");
  });

  it("keeps the expand button on a Verbose memory notice whose content overflows the preview", async () => {
    const conversation = fakeChannel("200");
    await sendMemoryEmbedWithExpand(
      buildContext({ hidden: [], conversation, verbosity: "verbose" }),
      memoryNotice,
      "likes tea ".repeat(100),
    );

    expect(conversation.sent[0]).toContain("memory_notice_expand");
  });

  it("shrinks a visible progress notice to its title and drops the /kill hint", async () => {
    const conversation = fakeChannel("200");
    const context = buildContext({ hidden: [], conversation });
    context.showKillHint = true;
    await sendToolNotice(
      context,
      "web_search",
      {
        titleKey: "tools.search.category_search_title",
        titleVars: { category: "Web", query: "tea" },
        description: "Looking around",
      },
      "test",
    );

    expect(conversation.sent).toHaveLength(1);
    const [payload] = conversation.sent;
    const searchTitle = { category: "Web", query: "tea" };
    expect(payload).toContain(encoded(localizedCopy("en-US", "tools.search.category_search_title", searchTitle)));
    expect(payload).not.toContain("Looking around");
    expect(payload).not.toContain(encoded(localizedCopy("en-US", "tools.tool_notice.kill_hint")));
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
    // The thought log is the full record, so it keeps the Verbose card even on a Minimal server.
    expect(thoughtLog.sent[0]).toContain("likes tea");
    expect(thoughtLog.sent[0]).toContain(configHint());
  });

  it("deduplicates shared progress notices in conversation and thought log while preserving the full mirrored card", async () => {
    const conversation = fakeChannel("200");
    const thoughtLog = fakeChannel("900");
    const context = buildContext({ hidden: [], conversation, thoughtLog });
    context.showKillHint = true;
    context.progressNoticeState = { attempted: false };
    for (const label of ["first-engine", "fallback-engine"]) {
      await sendToolNotice(
        context,
        "web_search",
        {
          titleKey: "tools.search.category_search_title",
          titleVars: { category: "Web", query: "tea" },
          description: "Looking around",
        },
        label,
      );
    }

    expect(conversation.sent).toHaveLength(1);
    expect(thoughtLog.sent).toHaveLength(1);
    const [convPayload] = conversation.sent;
    const [thoughtPayload] = thoughtLog.sent;

    const searchTitle = { category: "Web", query: "tea" };
    expect(convPayload).toContain(encoded(localizedCopy("en-US", "tools.search.category_search_title", searchTitle)));
    expect(convPayload).not.toContain("Looking around");
    expect(convPayload).not.toContain(encoded(localizedCopy("en-US", "tools.tool_notice.kill_hint")));

    expect(thoughtPayload).toContain(SOURCE_URL);
    expect(thoughtPayload).toContain("Looking around");
    expect(thoughtPayload).toContain(encoded(localizedCopy("en-US", "tools.tool_notice.kill_hint")));
  });

  it("keeps a Verbose progress notice conversation-only to avoid redundancy", async () => {
    const conversation = fakeChannel("200");
    const thoughtLog = fakeChannel("900");
    const context = buildContext({ hidden: [], conversation, thoughtLog, verbosity: "verbose" });
    context.showKillHint = true;
    await sendToolNotice(
      context,
      "web_search",
      {
        titleKey: "tools.search.category_search_title",
        titleVars: { category: "Web", query: "tea" },
        description: "Looking around",
      },
      "test",
    );

    expect(conversation.sent).toHaveLength(1);
    expect(thoughtLog.sent).toHaveLength(0);
  });

  it("does not mirror a Minimal notice to the thought log when sent from a DM or private channel", async () => {
    const dmConversation = fakeChannel("200", { dm: true });
    const dmThoughtLog = fakeChannel("900");
    await sendToolNotice(
      buildContext({ hidden: [], conversation: dmConversation, thoughtLog: dmThoughtLog }),
      "web_search",
      {
        titleKey: "tools.search.category_search_title",
        titleVars: { category: "Web", query: "tea" },
        description: "Looking around",
      },
      "test",
    );

    expect(dmConversation.sent).toHaveLength(1);
    expect(dmThoughtLog.sent).toHaveLength(0);

    const privateConversation = fakeChannel("200");
    const privateThoughtLog = fakeChannel("900");
    await sendMemoryEmbedWithExpand(
      buildContext({
        hidden: [],
        conversation: privateConversation,
        thoughtLog: privateThoughtLog,
        privateChannelIds: ["200"],
      }),
      memoryNotice,
      "likes tea",
    );

    expect(privateConversation.sent).toHaveLength(1);
    expect(privateThoughtLog.sent).toHaveLength(0);
  });

  it("hides only the toggled notice type", async () => {
    const conversation = fakeChannel("200");
    const thoughtLog = fakeChannel("900");
    await sendToolNoticeContainer(
      buildContext({ hidden: ["task_update"], conversation, thoughtLog }),
      "user_info_update",
      {
        titleKey: "tools.user_info_update.success_title",
        titleVars: { target_user: "Bau" },
        description: "Updated",
      },
    );

    expect(conversation.sent).toHaveLength(1);
    expect(thoughtLog.sent).toHaveLength(1);
    expect(thoughtLog.sent[0]).toContain(SOURCE_URL);
  });

  it.each<[string, Omit<Parameters<typeof buildContext>[0], "hidden">]>([
    ["no thought log is set", { conversation: fakeChannel("200") }],
    ["the notice came from a DM", { conversation: fakeChannel("200", { dm: true }), thoughtLog: fakeChannel("900") }],
    [
      "the notice came from a private channel",
      { conversation: fakeChannel("200"), thoughtLog: fakeChannel("900"), privateChannelIds: ["200"] },
    ],
    [
      "the notice came from a channel @everyone cannot read",
      { conversation: fakeChannel("200", { restricted: true }), thoughtLog: fakeChannel("900") },
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
      titleVars: { target_user: "Bau" },
      description: "Updated",
    });

    expect(setup.conversation.sent).toHaveLength(0);
    expect(setup.thoughtLog?.sent ?? []).toHaveLength(0);
  });
});

for (const format of ["components", "embed"] as const) {
  describe(`${format} notice delivery continuity`, () => {
    beforeEach(clearAllChannelDeliveryContinuity);

    const previousIdentity = { username: "Mirri (shy)", avatarUrl: "https://example.com/shy.png" };
    const previousSpeaker = { personaId: 55, kind: "appearance" as const };

    function persona(isAlter: boolean) {
      return createPersona({
        persona_id: 55,
        persona_nickname: "Mirri",
        is_alter: isAlter,
        config: { tool_notice_verbosity: "verbose" },
      });
    }

    async function deliver(
      channel: ReturnType<typeof fakeChannel>,
      options: { webhook?: Webhook; isAlter?: boolean } = {},
    ): Promise<void> {
      if (options.webhook) {
        spyOn(lifecycle, "getOrCreateWebhook").mockResolvedValue({ webhook: options.webhook });
      }
      if (format === "embed") {
        await sendStandardEmbed(channel as unknown as TextChannel, "en-US", memoryNotice, {
          persona: persona(options.isAlter ?? true),
          deliveryMode: "persona",
        });
      } else {
        const context = buildContext({ hidden: [], conversation: channel });
        context.tomoriState = persona(options.isAlter ?? true);
        await sendToolNoticeContainer(context, "memory_update", memoryNotice);
      }
    }

    function seed(channel: ReturnType<typeof fakeChannel>): void {
      recordChannelDeliveredWebhookIdentity(channel.id, previousIdentity, "300", previousSpeaker, "400");
    }

    function failedWebhook(channel: ReturnType<typeof fakeChannel>) {
      return {
        id: "400",
        channelId: channel.id,
        guildId: "guild_1",
        token: "fixture",
        client: { rest: new REST() },
        send: mock(async () => {
          throw Object.assign(new Error("Webhook send refused"), { code: 50013 });
        }),
      };
    }

    it("keeps the previous identity and does not repost as the bot when the persona webhook is refused", async () => {
      const channel = fakeChannel("200");
      const webhook = failedWebhook(channel);
      seed(channel);

      await deliver(channel, { webhook: webhook as unknown as Webhook });

      expect(webhook.send).toHaveBeenCalled();
      expect(channel.sent).toHaveLength(0);
      expect(getChannelLastDelivery(channel.id)).toEqual({
        via: "webhook",
        webhookId: "400",
        identity: previousIdentity,
        speaker: previousSpeaker,
      });
    });

    it("records a direct bot send with the persona it presented", async () => {
      const channel = fakeChannel("200");
      seed(channel);

      await deliver(channel, { isAlter: false });

      expect(channel.sent).toHaveLength(1);
      expect(getChannelLastDelivery(channel.id)).toEqual({
        via: "bot",
        speaker: { personaId: 55, kind: "appearance" },
      });
    });

    it("retains the last successful identity when the persona webhook fails", async () => {
      const channel = fakeChannel("200");
      const webhook = failedWebhook(channel);
      const botSend = spyOn(channel, "send").mockRejectedValue(new Error("Bot send refused"));
      seed(channel);

      try {
        await deliver(channel, { webhook: webhook as unknown as Webhook });

        expect(webhook.send).toHaveBeenCalled();
        expect(botSend).not.toHaveBeenCalled();
        expect(getChannelLastDelivery(channel.id)).toEqual({
          via: "webhook",
          webhookId: "400",
          identity: previousIdentity,
          speaker: previousSpeaker,
        });
      } finally {
        botSend.mockRestore();
      }
    });

    it("records the successful webhook without replacing it with a bot delivery", async () => {
      const channel = fakeChannel("200");
      const webhook = {
        id: "400",
        channelId: channel.id,
        guildId: "guild_1",
        token: "fixture",
        client: { rest: new REST() },
        send: mock(async (_payload: Record<string, unknown>) => ({ id: "301", channelId: channel.id })),
      };
      recordChannelDeliveredWebhookIdentity(
        channel.id,
        { username: "Juno" },
        "300",
        {
          personaId: 77,
          kind: "appearance",
        },
        "400",
      );

      await deliver(channel, { webhook: webhook as unknown as Webhook });

      expect(webhook.send).toHaveBeenCalled();
      expect(channel.sent).toHaveLength(0);
      expect(getChannelLastDelivery(channel.id)).toEqual({
        via: "webhook",
        webhookId: "400",
        identity: { username: "Mirri" },
        speaker: previousSpeaker,
      });
    });

    it("posts a main persona's notice under its committed sprite", async () => {
      const channel = fakeChannel("200");
      setPersonaSpriteCache(55, [
        {
          sprite_id: 3,
          persona_id: 55,
          sprite_name: "joy",
          sprite_key: "joy",
          avatar_url: "https://example.com/joy.png",
          usage_instructions: "",
          is_identity: false,
        },
      ]);
      commitPersonaAppearance({
        channelId: channel.id,
        personaId: 55,
        sprite: { personaId: 55, spriteName: "joy", isIdentity: false },
        genericAvatar: false,
      });
      channel.lastMessageId = "1500000000000000000";
      const webhook = {
        id: "400",
        channelId: channel.id,
        guildId: "guild_1",
        token: "fixture",
        client: { rest: new REST() },
        send: mock(async (_payload: Record<string, unknown>) => ({ id: "301", channelId: channel.id })),
      };
      spyOn(lifecycle, "getOrCreateWebhook").mockResolvedValue({ webhook: webhook as unknown as Webhook });

      if (format === "embed") {
        await sendStandardEmbed(channel as unknown as TextChannel, "en-US", memoryNotice, {
          persona: persona(false),
          deliveryMode: "persona",
        });
      } else {
        const context = buildContext({ hidden: [], conversation: channel });
        context.tomoriState = persona(false);
        await sendToolNoticeContainer(context, "memory_update", memoryNotice);
      }

      expect(channel.sent).toHaveLength(0);
      expect(webhook.send).toHaveBeenCalledTimes(1);
      const payload = (webhook.send.mock.calls[0][0] ?? {}) as { username?: string; avatarURL?: string };
      expect(payload.username).toBe("Mirri");
      expect(payload.avatarURL).toBe("https://example.com/joy.png");
      expect(getChannelLastDelivery(channel.id)).toMatchObject({
        via: "webhook",
        webhookId: "400",
        speaker: { personaId: 55, kind: "appearance" },
      });
    });
  });
}
