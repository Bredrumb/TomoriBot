import { describe, expect, it, spyOn } from "bun:test";
import type { Message } from "discord.js";
import { buildChatTurnContext } from "@/utils/chat/contextPipeline";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import type { ChatTurn } from "@/utils/chat/types";
import { PrivacyLevel } from "@/types/db/schema";
import * as blockCache from "@/utils/cache/personaUserBlockCache";
import * as userCache from "@/utils/cache/userCache";
import * as dbClient from "@/utils/db/client";
import * as contextBuilder from "@/utils/text/contextBuilder";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { createPersona, createUserRow } from "../../helpers/fixtures";

describe("persona-blocked authors in context", () => {
  it("hides a blocked user's slash-command embed even though the bot authored it", async () => {
    const persona = createPersona({
      persona_id: 1,
      config: {
        time_awareness_enabled: false,
        personal_memories_enabled: false,
        emoji_usage_enabled: false,
        sticker_usage_enabled: false,
      },
    });
    const client = {
      user: { id: "fixture-bot", username: "Tomori" },
      guilds: { cache: new Map() },
      users: { fetch: async (id: string) => ({ id, username: id }) },
    };
    const channel = {
      id: "fixture-channel",
      isThread: () => false,
      messages: { cache: new Map(), fetch: async () => new Map(messages.map((message) => [message.id, message])) },
    };
    const base = {
      guildId: "fixture-guild",
      channelId: channel.id,
      webhookId: null,
      channel,
      client,
      reference: null,
      embeds: [],
      components: [],
      attachments: new Map(),
      stickers: new Map(),
      reactions: { cache: new Map() },
      createdTimestamp: 1700000000000,
      type: 0,
    };
    const messages = [
      {
        ...base,
        id: "blocked-reward",
        author: { id: "fixture-bot", username: "Tomori", bot: true },
        interactionMetadata: { user: { id: "blocked-user" } },
        content: "",
        embeds: [{ title: "Headpat Time!", description: "<@blocked-user> is currently headpatting Tomori." }],
      },
      {
        ...base,
        id: "other-user",
        author: { id: "fixture-user", username: "Juno", bot: false },
        content: "hello",
      },
    ] as unknown as Message[];
    const incoming = normalizeChatInvocation({ client: messages[1].client, message: messages[1], isFromQueue: false });
    const turn = {
      persona,
      tomoriState: persona,
      mainPersona: persona,
      allPersonas: [persona],
      userRow: createUserRow(),
      userDiscId: "fixture-user",
      serverDiscId: "fixture-guild",
      isDMChannel: false,
      guild: null,
      triggeredPersonaIds: [persona.persona_id],
      requestSnapshot: { tomoriState: persona },
      lockedTurn: {
        channelId: channel.id,
        admission: { incoming, client, message: messages[1], channel, locale: "en-US" },
      },
    } as unknown as ChatTurn;
    const sql = spyOn(dbClient, "sql").mockImplementation((async () => []) as unknown as typeof dbClient.sql);
    const read = spyOn(userCache, "getCachedUserRow").mockResolvedValue(null);
    const privacy = spyOn(userCache, "getCachedPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL);
    const blacklist = spyOn(userCache, "getCachedBlacklistStatus").mockResolvedValue(false);
    const blocks = spyOn(blockCache, "getCachedActiveBlocksForPersona").mockResolvedValue([
      {
        server_id: persona.server_id,
        persona_id: 1,
        user_disc_id: "blocked-user",
        block_type: "block",
        reason: "fixture",
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);
    const builder = spyOn(contextBuilder, "buildContext").mockResolvedValue({
      contextItems: [],
      tailDirectives: [],
      lowerPriorityTailDirectives: [],
      nudgeInjectionDepth: 0,
      messageIdMap: new MessageIdMap(),
    });
    try {
      const result = await buildChatTurnContext(turn);
      const ids = result.simplifiedMessages.map((message) => message.id);
      expect(ids).not.toContain("blocked-reward");
      expect(ids).toContain("synthetic-user-block-blocked-reward");
      expect(ids).toContain("other-user");
      const notice = result.simplifiedMessages.find((message) => message.id === "synthetic-user-block-blocked-reward");
      expect(notice?.isSystemNotice).toBe(true);
      expect(notice?.content).toContain("<@blocked-user>");
    } finally {
      for (const spy of [sql, read, privacy, blacklist, blocks, builder]) spy.mockRestore();
    }
  });
});
