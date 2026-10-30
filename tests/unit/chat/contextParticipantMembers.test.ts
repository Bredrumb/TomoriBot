import { describe, expect, it, mock, spyOn } from "bun:test";
import { Collection, type Client, type GuildMember, type Message } from "discord.js";
import { PrivacyLevel } from "@/types/db/schema";
import { buildChatTurnContext } from "@/utils/chat/contextPipeline";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import type { ChatTurn } from "@/utils/chat/types";
import * as blockCache from "@/utils/cache/personaUserBlockCache";
import { clearUserCache } from "@/utils/cache/userCache";
import * as dbClient from "@/utils/db/client";
import * as contextBuilder from "@/utils/text/contextBuilder";
import { userRepository, userNamingRepository, messageProxyRepository } from "@/utils/db/repositories";
import { hydrateParticipantProfiles } from "@/utils/text/participants/hydration";
import { convertMentions } from "@/utils/text/context/mentionNormalizer";
import { getUserPresenceDetails } from "@/utils/text/context/history";
import { log } from "@/utils/misc/logger";
import * as preparation from "@/utils/text/participants/preparation";
import * as diagnostics from "@/utils/chat/diagnosticTimeline";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { createPersona, createUserRow } from "../../helpers/fixtures";

const GUILD_ID = "100000000000000001";
const USER_ID = "400000000000000001";
const BOT_ID = "300000000000000001";

describe("participant member request scope", () => {
  it("fetches a swept member once across naming, hydration, presence and mentions, including persona turns", async () => {
    clearUserCache();
    const persona = createPersona({
      config: {
        personal_memories_enabled: false,
        emoji_usage_enabled: false,
        sticker_usage_enabled: false,
        time_awareness_enabled: false,
      },
    });
    const row = createUserRow({ user_disc_id: USER_ID, user_nickname: "Mirri Saved" });
    const member = {
      id: USER_ID,
      displayName: "Mirri Guild",
      nickname: "Mirri Guild",
      user: { id: USER_ID, username: "mirri_username", bot: false },
      presence: { status: "online", activities: [] },
      roles: { cache: new Collection() },
    } as unknown as GuildMember;
    const fetchMember = mock(async (_id: string) => member);
    const guild = {
      id: GUILD_ID,
      name: "Fixture Guild",
      preferredLocale: "en-US",
      members: { cache: new Collection(), fetch: fetchMember },
      presences: { cache: new Map() },
    };
    const channel = {
      id: "fixture-channel",
      isThread: () => false,
      messages: { cache: new Map(), fetch: async () => new Map([[message.id, message]]) },
    };
    const client = {
      user: { id: BOT_ID, username: "Tomori" },
      guilds: { cache: new Map([[GUILD_ID, guild]]) },
      users: { cache: new Map(), fetch: async () => null },
      options: { intents: { has: () => true } },
    } as unknown as Client;
    const message = {
      id: "fixture-message",
      content: `Ask <@${USER_ID}>`,
      author: { id: USER_ID, username: "Mirri", bot: false },
      guildId: GUILD_ID,
      guild,
      channelId: channel.id,
      channel,
      client,
      webhookId: null,
      embeds: [],
      components: [],
      attachments: new Map(),
      stickers: new Map(),
      reactions: { cache: new Map() },
      createdTimestamp: 1700000000000,
      type: 0,
      reference: null,
    } as unknown as Message;
    const incoming = normalizeChatInvocation({ client, message, isFromQueue: false });
    const turn = {
      persona,
      tomoriState: persona,
      mainPersona: persona,
      allPersonas: [persona],
      userRow: row,
      userDiscId: USER_ID,
      serverDiscId: GUILD_ID,
      isDMChannel: false,
      guild,
      triggeredPersonaIds: [persona.persona_id],
      requestSnapshot: { tomoriState: persona },
      lockedTurn: { channelId: channel.id, admission: { incoming, client, message, channel, locale: "en-US" } },
    } as unknown as ChatTurn;
    const reads: string[] = [];
    let now = 0;
    const realPrepare = preparation.prepareParticipantContext;
    const diagnostic = spyOn(diagnostics, "recordChatDiagnostic").mockImplementation(() => {});
    const spies = [
      diagnostic,
      spyOn(performance, "now").mockImplementation(() => now),
      spyOn(preparation, "prepareParticipantContext").mockImplementation(async (input) => {
        now += 37;
        return realPrepare(input);
      }),
      spyOn(dbClient, "sql").mockImplementation((async () => []) as unknown as typeof dbClient.sql),
      spyOn(userRepository, "loadByDiscordId").mockResolvedValue(row),
      spyOn(userRepository, "getPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL),
      spyOn(userRepository, "isBlacklisted").mockResolvedValue(false),
      spyOn(userRepository, "getBlacklistedMemberIds").mockResolvedValue([]),
      spyOn(userRepository, "loadContextReferenceCandidates").mockResolvedValue([]),
      spyOn(messageProxyRepository, "loadContextReferenceIdentities").mockResolvedValue([]),
      spyOn(userNamingRepository, "loadPreferences").mockResolvedValue(new Map()),
      spyOn(blockCache, "getCachedActiveBlocksForPersona").mockResolvedValue([]),
      spyOn(log, "info").mockImplementation(() => {}),
      spyOn(contextBuilder, "buildContext").mockImplementation(async (params) => {
        const scope = params.preparedParticipantContext.requestScope;
        expect(scope).toBeDefined();
        expect(params.historyUserLabels?.get(USER_ID)).toBe(member.displayName);
        const hydrated = await hydrateParticipantProfiles(
          {
            client,
            guildId: GUILD_ID,
            channelName: "general",
            botName: "Tomori",
            participantSeeds: params.preparedParticipantContext.discoveryPlan.seeds,
            activePersonaScope: { isMainPersona: true, isUserImpersonation: false },
            tomoriState: persona,
            tomoriConfig: persona.config,
            isDMChannel: false,
            impersonatedIdentityName: null,
            toolPromptMacroResolver: { expand: async (text) => text },
            conversationCorpus: null,
            convertMentions,
            requestScope: scope,
          },
          {
            loadPersonalMemories: async () => [],
            loadReminders: async () => [],
            loadNamingPreferences: async () => new Map(),
          },
        );
        expect(hydrated.profiles.some((profile) => profile.displayName === member.displayName)).toBe(true);
        reads.push(await getUserPresenceDetails(client, USER_ID, GUILD_ID, null, scope));
        reads.push(
          await convertMentions(
            `<@${USER_ID}>`,
            client,
            GUILD_ID,
            "Mirri",
            "Tomori",
            false,
            undefined,
            "preserve",
            undefined,
            new Map(),
            scope,
          ),
        );
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
      await buildChatTurnContext(turn);
      await buildChatTurnContext({ ...turn, persona: createPersona({ ...persona, persona_id: 2 }) });
      expect(fetchMember).toHaveBeenCalledTimes(1);
      expect(fetchMember).toHaveBeenCalledWith(USER_ID);
      expect(reads.filter((read) => read === member.displayName)).toHaveLength(2);
      await buildChatTurnContext({ ...turn, lockedTurn: { ...turn.lockedTurn } });
      expect(fetchMember).toHaveBeenCalledTimes(2);
      const contextEvents = diagnostic.mock.calls
        .map(([event]) => event)
        .filter((event) => event.kind === "context_built");
      expect(contextEvents).toHaveLength(3);
      for (const event of contextEvents) {
        if (event.kind === "context_built") expect(event.participantMs).toBe(37);
      }
    } finally {
      for (const spy of spies.reverse()) spy.mockRestore();
      clearUserCache();
    }
  });
});
