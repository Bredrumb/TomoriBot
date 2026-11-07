import { describe, expect, it, spyOn } from "bun:test";
import type { Message } from "discord.js";
import { buildChatTurnContext } from "@/utils/chat/contextPipeline";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import type { ChatTurn } from "@/utils/chat/types";
import { PrivacyLevel, type LlmRow } from "@/types/db/schema";
import * as blockCache from "@/utils/cache/personaUserBlockCache";
import * as channelLlmCache from "@/utils/cache/channelLlmCache";
import * as userCache from "@/utils/cache/userCache";
import * as dbClient from "@/utils/db/client";
import * as contextBuilder from "@/utils/text/contextBuilder";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { createPersona, createUserRow } from "../../helpers/fixtures";

function buildTurn(toolUseEnabled: boolean): { turn: ChatTurn; serverLlm: LlmRow } {
  const persona = createPersona({
    persona_id: 1,
    config: {
      tool_use_enabled: toolUseEnabled,
      time_awareness_enabled: false,
      personal_memories_enabled: false,
      emoji_usage_enabled: false,
      sticker_usage_enabled: false,
    },
  });
  const serverLlm = { ...persona.llm, llm_codename: "server-model", has_tools: true };
  persona.llm = serverLlm;
  const client = {
    user: { id: "fixture-bot", username: "Tomori" },
    guilds: { cache: new Map() },
    users: { fetch: async (id: string) => ({ id, username: id }) },
  };
  const channel = {
    id: "fixture-channel",
    isThread: () => false,
    messages: { cache: new Map(), fetch: async () => new Map([[message.id, message]]) },
  };
  const message = {
    id: "fixture-message",
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
    author: { id: "fixture-user", username: "Juno", bot: false },
    content: "hello",
  } as unknown as Message;
  const incoming = normalizeChatInvocation({ client: message.client, message, isFromQueue: false });
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
    textCredentialSource: "server",
    personalRoutingUserId: null,
    triggeredPersonaIds: [persona.persona_id],
    requestSnapshot: { tomoriState: persona },
    lockedTurn: {
      channelId: channel.id,
      admission: { incoming, client, message, channel, locale: "en-US" },
    },
  } as unknown as ChatTurn;
  return { turn, serverLlm };
}

describe("context pipeline prompt model", () => {
  it("gates tool-dependent context on the channel's model, narrowed by the Tool Use switch", async () => {
    const cases = [
      { channelHasTools: false, toolUseEnabled: true, expected: false },
      { channelHasTools: true, toolUseEnabled: false, expected: false },
      { channelHasTools: true, toolUseEnabled: true, expected: true },
    ];
    const failures: string[] = [];
    for (const { channelHasTools, toolUseEnabled, expected } of cases) {
      const { turn, serverLlm } = buildTurn(toolUseEnabled);
      const channelLlm = { ...serverLlm, llm_codename: "channel-model", has_tools: channelHasTools };
      const promptStates: Array<{ codename?: string; hasTools?: boolean }> = [];
      const spies = [
        spyOn(dbClient, "sql").mockImplementation((async () => []) as unknown as typeof dbClient.sql),
        spyOn(userCache, "getCachedUserRow").mockResolvedValue(null),
        spyOn(userCache, "getCachedPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL),
        spyOn(userCache, "getCachedBlacklistStatus").mockResolvedValue(false),
        spyOn(blockCache, "getCachedActiveBlocksForPersona").mockResolvedValue([]),
        spyOn(channelLlmCache, "getCachedChannelLlm").mockResolvedValue(channelLlm),
        spyOn(contextBuilder, "buildContext").mockImplementation(async (params) => {
          promptStates.push({
            codename: params.snapshot?.tomoriState?.llm.llm_codename,
            hasTools: params.snapshot?.tomoriState?.llm.has_tools,
          });
          return {
            contextItems: [],
            tailDirectives: [],
            lowerPriorityTailDirectives: [],
            nudgeInjectionDepth: 0,
            messageIdMap: new MessageIdMap(),
          };
        }),
      ];
      try {
        const result = await buildChatTurnContext(turn);
        const actual = JSON.stringify({ prompt: promptStates, generation: result.currentPersona.llm.llm_codename });
        const wanted = JSON.stringify({
          prompt: [{ codename: "channel-model", hasTools: expected }],
          generation: "server-model",
        });
        if (actual !== wanted) failures.push(`channel=${channelHasTools} toolUse=${toolUseEnabled}: ${actual}`);
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    }
    expect(failures).toEqual([]);
  });
});
