import { describe, expect, it, mock, spyOn } from "bun:test";
import type { Message } from "discord.js";
import { Collection, MessageReferenceType, MessageType } from "discord.js";
import { buildChatTurnContext } from "@/utils/chat/contextPipeline";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import type { ChatTurn } from "@/utils/chat/types";
import { PrivacyLevel } from "@/types/db/schema";
import * as blockCache from "@/utils/cache/personaUserBlockCache";
import * as userCache from "@/utils/cache/userCache";
import * as dbClient from "@/utils/db/client";
import * as contextBuilder from "@/utils/text/contextBuilder";
import { log } from "@/utils/misc/logger";
import { createChatLatencyInvocation, runWithChatTurnLatency } from "@/utils/chat/turnLatency";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { createPersona, createUserRow } from "../../helpers/fixtures";

describe("history reply context", () => {
  it.each([
    "cached",
    "evicted",
    "forwarded-thread",
    "prefetched",
    "prefetch-failure",
  ])("resolves history references: %s", async (scenario) => {
    const prefetch = scenario.startsWith("prefetch");
    const fail = scenario === "prefetch-failure";
    const channelEvicted = scenario === "evicted";
    const forwardedThread = scenario === "forwarded-thread";
    const persona = createPersona({
      config: {
        time_awareness_enabled: false,
        personal_memories_enabled: false,
        emoji_usage_enabled: false,
        sticker_usage_enabled: false,
      },
    });
    const targets = new Map<string, Message>();
    const release = Promise.withResolvers<void>();
    const fourStarted = Promise.withResolvers<void>();
    let active = 0;
    let maximumActive = 0;
    const fetchById = mock(async (id: string) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      if (active === 4) fourStarted.resolve();
      try {
        await release.promise;
        if (fail && id === "target-5") throw new Error("missing target");
        const target = targets.get(id);
        if (!target) throw new Error("reply target fetched individually");
        return target;
      } finally {
        active--;
      }
    });
    let historyFetched = false;
    const channel = {
      id: "fixture-channel",
      isThread: () => false,
      messages: {
        cache: new Map(),
        fetch: async (options: string | { limit: number }) => {
          if (typeof options === "string") return fetchById(options);
          historyFetched = true;
          return new Map((forwardedThread ? messages.slice(0, 1) : messages).map((message) => [message.id, message]));
        },
      },
    };
    const client = {
      user: { id: "fixture-bot", username: "Tomori" },
      guilds: { cache: new Map() },
      users: { fetch: async (id: string) => ({ id, username: id }) },
    };
    const base = {
      guildId: "fixture-guild",
      channelId: channel.id,
      webhookId: null,
      channel,
      client,
      embeds: [],
      components: [],
      attachments: new Map(),
      stickers: new Map(),
      messageSnapshots: new Collection(),
      reactions: { cache: new Map() },
      createdTimestamp: 1700000000000,
      type: 0,
    };
    // The history fetch returns newest first, as Discord does.
    const messages = [
      {
        ...base,
        id: "reply",
        author: { id: "fixture-juno", username: "Juno", bot: false },
        content: "what did you mean?",
        reference: { messageId: "target", channelId: channel.id, type: MessageReferenceType.Default },
      },
      {
        ...base,
        id: "target",
        author: { id: "fixture-mirri", username: "Mirri", bot: false },
        content: "the second option",
        reference: null,
      },
    ] as unknown as Message[];
    if (prefetch) {
      const reply = messages[0];
      const target = messages[1];
      for (let i = 0; i < 6; i++) {
        targets.set(`target-${i}`, { ...target, id: `target-${i}`, content: `target content ${i}` } as Message);
      }
      messages.splice(
        0,
        messages.length,
        ...Array.from(
          { length: 7 },
          (_, i) =>
            ({
              ...reply,
              id: `reply-${i}`,
              author: { ...reply.author, id: `author-${i}` },
              content: `reply content ${i}`,
              reference: { messageId: `target-${i % 6}`, channelId: channel.id, type: MessageReferenceType.Default },
            }) as Message,
        ),
      );
    }
    const fetchReference = mock(async () => messages[1]);
    if (forwardedThread) {
      Object.assign(messages[0], {
        type: MessageType.ThreadStarterMessage,
        content: "",
        reference: { messageId: "target", channelId: "parent-channel", type: MessageReferenceType.Default },
        fetchReference,
      });
      Object.assign(messages[1], {
        channelId: "parent-channel",
        content: "",
        reference: { messageId: "original", channelId: "source-channel", type: MessageReferenceType.Forward },
        messageSnapshots: new Collection([
          [
            "original",
            {
              content: "",
              attachments: new Collection([
                [
                  "image",
                  {
                    name: "image.png",
                    url: "https://cdn.discordapp.com/attachments/1/2/image.png",
                    proxyURL: "https://media.discordapp.net/attachments/1/2/image.png",
                    contentType: "image/png",
                  },
                ],
              ]),
              embeds: [],
              stickers: new Collection(),
            },
          ],
        ]),
      });
    }
    for (const message of messages) {
      Object.defineProperty(message, "channel", {
        get: () => (channelEvicted && historyFetched ? null : channel),
      });
    }
    const incoming = normalizeChatInvocation({ client: messages[0].client, message: messages[0], isFromQueue: false });
    const turn = {
      persona,
      tomoriState: persona,
      mainPersona: persona,
      allPersonas: [persona],
      userRow: createUserRow(),
      userDiscId: "fixture-juno",
      serverDiscId: "fixture-guild",
      isDMChannel: false,
      guild: null,
      triggeredPersonaIds: [persona.persona_id],
      requestSnapshot: { tomoriState: persona },
      lockedTurn: {
        channelId: channel.id,
        admission: { incoming, client, message: messages[0], channel, locale: "en-US" },
      },
    } as unknown as ChatTurn;
    const sql = spyOn(dbClient, "sql").mockImplementation((async () => []) as unknown as typeof dbClient.sql);
    const read = spyOn(userCache, "getCachedUserRow").mockResolvedValue(null);
    const privacy = spyOn(userCache, "getCachedPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL);
    const blacklist = spyOn(userCache, "getCachedBlacklistStatus").mockResolvedValue(false);
    const blocks = spyOn(blockCache, "getCachedActiveBlocksForPersona").mockResolvedValue([]);
    const builder = spyOn(contextBuilder, "buildContext").mockResolvedValue({
      contextItems: [],
      tailDirectives: [],
      lowerPriorityTailDirectives: [],
      nudgeInjectionDepth: 0,
      messageIdMap: new MessageIdMap(),
    });
    const metric = spyOn(log, "metric").mockImplementation(() => {});
    try {
      if (prefetch) {
        for (const [id, target] of targets) channel.messages.cache.set(id, target);
        const baseline = await buildChatTurnContext(turn);
        channel.messages.cache.clear();
        const pending = runWithChatTurnLatency(createChatLatencyInvocation(Date.now(), "message"), 0, 0, () =>
          buildChatTurnContext(turn),
        );
        await Promise.race([
          fourStarted.promise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("four reply fetches did not start")), 2000),
          ),
        ]);
        expect(fetchById).toHaveBeenCalledTimes(4);
        release.resolve();
        const result = await pending;
        expect(maximumActive).toBe(4);
        expect(fetchById.mock.calls.map(([id]) => id).sort()).toEqual([...targets.keys()].sort());
        expect(metric.mock.calls.find(([name]) => name === "chat_turn_latency")?.[1]).toMatchObject({
          reply_fetches: 6,
        });
        if (!fail) {
          expect(result.simplifiedMessages).toEqual(baseline.simplifiedMessages);
          expect(result.messageIdMap).toEqual(baseline.messageIdMap);
        } else {
          for (const message of result.simplifiedMessages) {
            const expected = baseline.simplifiedMessages.find((entry) => entry.id === message.id);
            if (message.id === "reply-5") {
              expect(message.content).toBe(messages.find((entry) => entry.id === message.id)?.content ?? null);
            } else {
              expect(message.content?.replace(/ref_\d+/g, "ref")).toBe(expected?.content?.replace(/ref_\d+/g, "ref"));
            }
          }
        }
        return;
      }
      const result = await buildChatTurnContext(turn);
      const reply = result.simplifiedMessages.find((message) => message.id === "reply");
      const target = result.simplifiedMessages.find((message) => message.id === "target");
      expect(fetchById).not.toHaveBeenCalled();
      if (forwardedThread) {
        expect(fetchReference).toHaveBeenCalledTimes(1);
        expect(reply?.imageAttachments).toHaveLength(1);
        expect(reply?.imageAttachments[0]?.sourceMessageId).toBe("reply");
        expect(reply?.mediaSourceMessageIds).toEqual(["reply"]);
        expect(reply?.remoteMediaSourceKind).toBe("reply");
        return;
      }
      expect(target?.content).toContain(messages[1].content);
      expect(reply?.content).toContain(messages[0].content);
      if (!channelEvicted) expect(reply?.content).toContain(messages[1].content);
    } finally {
      release.resolve();
      for (const spy of [sql, read, privacy, blacklist, blocks, builder, metric]) spy.mockRestore();
    }
  });
});
