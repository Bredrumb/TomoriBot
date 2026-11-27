import { stubAllShardOwnership } from "../../helpers/shardOwnership";
stubAllShardOwnership();
import { describe, expect, it, spyOn } from "bun:test";
import { ChannelType, type Message, TextChannel } from "discord.js";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";
import * as userCache from "@/utils/cache/userCache";
import { evaluateChatAdmission, normalizeChatInvocation } from "@/utils/chat/admission";
import * as admissionGuards from "@/utils/chat/admissionGuards";
import {
  acquireChannelLockForTurn,
  channelLocks,
  getOrCreateChannelLockEntry,
  releaseChannelLockAndReplayQueue,
} from "@/utils/chat/channelQueue";
import { shouldBotReply } from "@/utils/chat/replyDecision";
import { observeWelcomeReply, trackWelcomeReply } from "@/utils/chat/welcomeReply";
import { verifyMessageWebhook } from "@/utils/chat/webhookIdentity";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { messageProxyInstanceRepository } from "@/utils/db/repositories/MessageProxyInstanceRepository";
import { messageProxyRepository } from "@/utils/db/repositories/MessageProxyRepository";
import {
  clearMessageProxyExpectationStateForTests,
  createMessageProxyExpectation,
  getMessageProxyMessageRecord,
} from "@/utils/messageProxy/proxyExpectation";
import * as pluralBuddyApi from "@/utils/messageProxy/services/pluralbuddy/api";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { officialMessageProxyInstanceFixture } from "../../helpers/messageProxyInstance";

const CHANNEL_ID = "100000000000000001";
const GUILD_ID = "100000000000000002";
const MEMBER_ID = "100000000000000003";
const BYSTANDER_ID = "100000000000000004";
const BOT_ID = "100000000000000005";
const WEBHOOK_ID = "100000000000000006";

function setup() {
  const guild = {
    id: GUILD_ID,
    preferredLocale: "en-US",
    members: { me: { isCommunicationDisabled: () => false }, cache: new Map() },
  };
  const channel: TextChannel = Object.assign(Object.create(TextChannel.prototype), {
    id: CHANNEL_ID,
    guild,
    type: ChannelType.GuildText,
    isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
  });
  const main = createPersona({
    persona_nickname: "Mirri",
    config: { welcome_channel_disc_id: channel.id, welcome_prompt: "Greet the new member" },
  });
  const alter = createPersona({ persona_id: 2, persona_nickname: "Bau", is_alter: true });
  const personas = [main, alter];
  let nextId = 100000000000000100n;
  const makeMessage = (authorId: string, content: string, webhookId: string | null = null) =>
    ({
      id: String(nextId++),
      channelId: channel.id,
      channel,
      guildId: GUILD_ID,
      guild,
      client: { user: { id: BOT_ID } },
      author: {
        id: authorId,
        bot: authorId === BOT_ID || webhookId !== null,
        username: webhookId ? alter.persona_nickname : "Juno",
      },
      webhookId,
      content,
      mentions: { users: new Map(), roles: new Map(), everyone: false },
      reference: null,
      attachments: new Map(),
      embeds: [],
      components: [],
    }) as unknown as Message;
  const wouldReply = (message: Message) => shouldBotReply(message, main, personas, { referencedMessage: null });
  const welcome = (userId = MEMBER_ID, personaId = 1) => trackWelcomeReply(channel, userId, personaId, personas);
  const observe = (message: Message) =>
    observeWelcomeReply(
      message,
      verifyMessageWebhook(message).then(() => null),
    );
  const admit = (message: Message, isFromQueue = false) =>
    evaluateChatAdmission(normalizeChatInvocation({ client: message.client, message, isFromQueue }));
  return { makeMessage, wouldReply, welcome, observe, admit, personas };
}

function stubAdmission(personas: ReturnType<typeof setup>["personas"], useProxy = false) {
  const member = createUserRow({ user_disc_id: MEMBER_ID, message_proxy_service: useProxy ? "pluralbuddy" : null });
  return [
    spyOn(tomoriStateCache, "getCachedAllPersonas").mockResolvedValue(personas),
    spyOn(userCache, "getCachedUserRow").mockResolvedValue(member),
    spyOn(userCache, "getCachedPrivacyLevel").mockResolvedValue(0),
    spyOn(userCache, "getCachedBlacklistStatus").mockResolvedValue(false),
    spyOn(admissionGuards, "evaluateChatAccess").mockResolvedValue({
      rejectedByWhitelist: false,
      allowedPersonaIds: null,
      blockedPersonaIds: new Set(),
      whitelistStatus: null,
      personalSpotlightStatus: null,
    }),
    spyOn(admissionGuards, "enforceGlobalRateLimit").mockResolvedValue(true),
  ];
}

describe("welcome replies", () => {
  it("allows the welcomed member to alternate messages with the welcoming persona", async () => {
    const { makeMessage, wouldReply, welcome, observe } = setup();
    const greeting = makeMessage(BOT_ID, "Welcome!");
    await welcome().confirm(greeting.id);
    await observe(greeting);
    const thanks = makeMessage(MEMBER_ID, "Thanks!");
    await observe(thanks);
    expect(wouldReply(thanks)).toBe(true);

    const secondMemberMessage = makeMessage(MEMBER_ID, "Happy to be here.");
    await observe(secondMemberMessage);
    expect(wouldReply(secondMemberMessage)).toBe(false);

    await observe(makeMessage(BOT_ID, "Glad you joined."));
    const afterReply = makeMessage(MEMBER_ID, "Where should I start?");
    await observe(afterReply);
    expect(wouldReply(afterReply)).toBe(true);
  });

  it("ends on a different human and stays off when the welcoming persona speaks again", async () => {
    const { makeMessage, wouldReply, welcome, observe } = setup();
    await welcome().confirm(makeMessage(BOT_ID, "Welcome!").id);
    const thanks = makeMessage(MEMBER_ID, "Thanks!");
    await observe(thanks);
    const bystander = makeMessage(BYSTANDER_ID, "Good evening.");
    await observe(bystander);
    expect(wouldReply(bystander)).toBe(false);
    expect(wouldReply(thanks)).toBe(true);

    await observe(makeMessage(BOT_ID, "Glad you joined."));
    const afterInterruption = makeMessage(MEMBER_ID, "Where should I start?");
    await observe(afterInterruption);
    expect(wouldReply(afterInterruption)).toBe(false);
  });

  it("keeps a queued reply eligible when another member speaks before replay", async () => {
    const { makeMessage, wouldReply, welcome, admit, personas } = setup();
    const spies = stubAdmission(personas);
    const lockEntry = getOrCreateChannelLockEntry(CHANNEL_ID, GUILD_ID);
    try {
      const greeting = makeMessage(BOT_ID, "Welcome!");
      await welcome().confirm(greeting.id);
      acquireChannelLockForTurn(lockEntry, {
        messageId: greeting.id,
        userDiscId: BYSTANDER_ID,
        isPersonaJob: false,
        isCommandTriggered: true,
      });
      const thanks = makeMessage(MEMBER_ID, "Thanks!");
      expect(await admit(thanks)).toMatchObject({ disposition: "queued", reason: "locked_busy_queued" });
      await admit(makeMessage(BYSTANDER_ID, "Good evening."));
      await new Promise<void>((resolve, reject) => {
        releaseChannelLockAndReplayQueue({
          channelId: CHANNEL_ID,
          lockEntry,
          completedMessageId: greeting.id,
          handleStopResponse: async () => {},
          processQueuedMessage: async (queued) => {
            try {
              expect(queued.message).toBe(thanks);
              const replay = await admit(queued.message, true);
              expect(replay.disposition).toBe("run");
              expect(wouldReply(queued.message)).toBe(true);
              resolve();
            } catch (error) {
              reject(error);
            }
          },
        });
      });
    } finally {
      for (const spy of spies) spy.mockRestore();
      channelLocks.delete(CHANNEL_ID);
    }
  });

  it("routes a verified PluralBuddy repost without an original message ID as a welcome reply", async () => {
    for (const originalAfterGreeting of [true, false]) {
      const { makeMessage, observe, welcome, admit, personas } = setup();
      const pending = welcome();
      if (originalAfterGreeting) await pending.confirm(makeMessage(BOT_ID, "Welcome!").id);
      const original = makeMessage(MEMBER_ID, "Thanks!");
      await observe(original);
      if (!originalAfterGreeting) await pending.confirm(makeMessage(BOT_ID, "Welcome!").id);
      const repost = makeMessage(WEBHOOK_ID, "Thanks!", WEBHOOK_ID);
      const instance = officialMessageProxyInstanceFixture("pluralbuddy");
      createMessageProxyExpectation({
        instance,
        channelId: CHANNEL_ID,
        originalMessageId: original.id,
        senderDiscId: MEMBER_ID,
        originalMessage: original,
        originalReference: null,
      });
      const spies = [
        ...stubAdmission(personas, true),
        spyOn(serverRepository, "loadManagedWebhookByChannelAndWebhookId").mockResolvedValue(null),
        spyOn(messageProxyInstanceRepository, "getEnabled").mockResolvedValue({
          ...instance,
          displayName: "PluralBuddy",
        }),
        spyOn(pluralBuddyApi, "fetchPluralBuddyMessage").mockResolvedValue({
          channelId: CHANNEL_ID,
          messageId: repost.id,
          systemId: MEMBER_ID,
          alterId: 8,
          alterIdKey: "8",
        }),
        spyOn(messageProxyRepository, "persistAttestedIdentity").mockResolvedValue({
          userRow: createUserRow({ user_disc_id: "pb:8", user_nickname: "Bau" }),
          namespace: {
            message_proxy_namespace_id: 51,
            service_id: instance.serviceId,
            instance_id: instance.instanceId,
            namespace_key: MEMBER_ID,
          },
          identity: { message_proxy_identity_id: 61, message_proxy_namespace_id: 51, external_identity_id: 71 },
          isNewIdentity: false,
        }),
      ];
      try {
        const admission = await admit(repost);
        expect(getMessageProxyMessageRecord(repost.id)).toMatchObject({
          originalMessageId: null,
          originalMessage: null,
          originalSuppressed: true,
          senderDiscId: MEMBER_ID,
        });
        expect(admission).toMatchObject({ disposition: "run", userDiscId: MEMBER_ID });
      } finally {
        for (const spy of spies) spy.mockRestore();
        clearMessageProxyExpectationStateForTests();
        channelLocks.delete(CHANNEL_ID);
      }
    }
  });

  it("ends when a different persona using the channel webhook speaks", async () => {
    const lookup = spyOn(serverRepository, "loadManagedWebhookByChannelAndWebhookId").mockResolvedValue({
      managed_webhook_id: 1,
      guild_disc_id: GUILD_ID,
      channel_disc_id: CHANNEL_ID,
      webhook_disc_id: WEBHOOK_ID,
      kind: "shared_channel",
      avatar_fingerprint: null,
      discord_avatar_hash: null,
      webhook_token: Buffer.from("fixture"),
      key_version: 1,
    });
    try {
      const { makeMessage, wouldReply, welcome, observe } = setup();
      await welcome(MEMBER_ID, 2).confirm(makeMessage(WEBHOOK_ID, "Welcome!", WEBHOOK_ID).id);
      await observe(makeMessage(WEBHOOK_ID, "What brought you here?", WEBHOOK_ID));
      const thanks = makeMessage(MEMBER_ID, "My friend invited me.");
      await observe(thanks);
      expect(wouldReply(thanks)).toBe(true);
      await observe(makeMessage(BOT_ID, "I know them too."));
      await observe(makeMessage(WEBHOOK_ID, "Glad you joined.", WEBHOOK_ID));
      const afterInterruption = makeMessage(MEMBER_ID, "Where should I start?");
      await observe(afterInterruption);
      expect(wouldReply(afterInterruption)).toBe(false);

      await welcome().confirm(makeMessage(BOT_ID, "Welcome!").id);
      await observe(makeMessage(WEBHOOK_ID, "Good evening.", WEBHOOK_ID));
      await observe(makeMessage(BOT_ID, "Glad you joined."));
      const afterWebhook = makeMessage(MEMBER_ID, "Where should I start?");
      await observe(afterWebhook);
      expect(wouldReply(afterWebhook)).toBe(false);
    } finally {
      lookup.mockRestore();
    }
  });

  it("does not arm before delivery or after an interruption during the greeting", async () => {
    const { makeMessage, wouldReply, welcome, observe } = setup();
    const pending = welcome();
    const early = makeMessage(MEMBER_ID, "Hello!");
    await observe(early);
    expect(wouldReply(early)).toBe(false);

    const greeting = makeMessage(BOT_ID, "Welcome!");
    await observe(greeting);
    await observe(makeMessage(BYSTANDER_ID, "Good evening."));
    await observe(makeMessage(BOT_ID, "Glad you joined."));
    await pending.confirm(greeting.id);
    const late = makeMessage(MEMBER_ID, "Thanks!");
    await observe(late);
    expect(wouldReply(late)).toBe(false);
  });

  it("hands the trigger to the latest successful welcome even when the persona is the same", async () => {
    const { makeMessage, wouldReply, welcome, observe } = setup();
    const first = welcome();
    const firstGreeting = makeMessage(BOT_ID, "Welcome!");
    const secondGreeting = makeMessage(BOT_ID, "Welcome!");
    await welcome(BYSTANDER_ID).confirm(secondGreeting.id);
    await first.confirm(firstGreeting.id);
    const thanks = makeMessage(BYSTANDER_ID, "Thanks!");
    await observe(thanks);
    expect(wouldReply(thanks)).toBe(true);
  });
});
