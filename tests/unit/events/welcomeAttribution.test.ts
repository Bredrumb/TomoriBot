import { stubAllShardOwnership } from "../../helpers/shardOwnership";
stubAllShardOwnership();
import { describe, expect, it, spyOn } from "bun:test";
import { ChannelType, Collection, TextChannel, type Client, type GuildMember, type Message } from "discord.js";
import handler from "@/events/guildMemberAdd/newUser";
import * as gate from "@/events/guildMemberAdd/helpers/welcomeGate";
import * as membership from "@/events/guildMemberAdd/helpers/welcomeMembership";
import * as chat from "@/events/messageCreate/tomoriChat";
import * as stateCache from "@/utils/cache/tomoriStateCache";
import * as userCache from "@/utils/cache/userCache";
import * as mentions from "@/utils/discord/mentionHelper";
import { userRepository } from "@/utils/db/repositories";
import { evaluateChatAdmission, normalizeChatInvocation } from "@/utils/chat/admission";
import {
  acquireChannelLockForTurn,
  clearChannelProcessingQueue,
  getOrCreateChannelLockEntry,
  releaseChannelLockAndReplayQueue,
  selfReplySuppressionUntil,
  suppressNextSelfReply,
} from "@/utils/chat/channelQueue";
import { applyWelcomeHandoff } from "@/utils/chat/welcomeHandoff";
import { observeWelcomeReply } from "@/utils/chat/welcomeReply";
import type { TomoriChatInput } from "@/utils/chat/types";
import type { StructuredContextItem } from "@/types/misc/context";
import { PrivacyLevel } from "@/types/db/schema";
import { createLlmRow, createPersona, createUserRow } from "../../helpers/fixtures";

async function runWelcome(privacyLevel = PrivacyLevel.MINIMAL, takeHandoff = false, queueWelcome = false) {
  const persona = createPersona({
    llm: createLlmRow({ sees_images: false }),
    vision_llm: undefined,
    config: {
      welcome_channel_disc_id: "welcome-channel",
      welcome_prompt: "Welcome the new member",
      welcome_persona_id: 1,
    },
  });
  const client = { user: { id: "fixture-bot" } } as Client;
  const guild = {
    id: "fixture-guild",
    name: "Lantern Lounge",
    preferredLocale: "en-US",
    members: { me: { isCommunicationDisabled: () => false }, cache: new Map() },
    channels: { fetch: async () => channel },
  };
  const channel = Object.assign(Object.create(TextChannel.prototype), {
    id: "welcome-channel",
    type: ChannelType.GuildText,
    guild,
    isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
    messages: {
      fetch: async () => {
        if (takeHandoff) {
          const incoming = normalizeChatInvocation({
            client,
            message: { ...message, id: "member-message", author: member.user } as Message,
            isFromQueue: false,
          });
          applyWelcomeHandoff(incoming, member.id);
          contexts.push(...(incoming.injectedContextItems ?? []));
        }
        return { first: () => message };
      },
    },
  });
  const message = {
    id: "bystander-message",
    client,
    channel,
    channelId: channel.id,
    guild,
    author: { id: "blacklisted-bystander", username: "Juno", bot: false },
    content: "good night",
    mentions: { users: new Map(), roles: new Map(), everyone: false },
    attachments: new Map(),
    embeds: [],
    webhookId: null,
    reference: null,
  } as unknown as Message;
  const member = {
    id: "new-member",
    guild,
    user: { id: "new-member", username: "Mirri", tag: "Mirri", bot: false },
    displayName: "Mirri",
    roles: { cache: new Collection([[guild.id, { id: guild.id, name: "@everyone", position: 0 }]]) },
  } as unknown as GuildMember;
  const refreshedMember = {
    ...member,
    roles: {
      cache: new Collection([
        [guild.id, { id: guild.id, name: "@everyone", position: 0 }],
        ["community-role", { id: "community-role", name: "Community", position: 1 }],
        ["language-role", { id: "language-role", name: "Português", position: 2 }],
      ]),
    },
  } as unknown as GuildMember;
  const admissions: string[] = [];
  const echoReasons: Array<string | undefined> = [];
  const contexts: StructuredContextItem[] = [];
  let queuedWelcome: TomoriChatInput | undefined;
  const blacklist = spyOn(userCache, "getCachedBlacklistStatus").mockResolvedValue(true);
  const spies = [
    spyOn(userRepository, "register").mockResolvedValue(
      createUserRow({ user_disc_id: member.id, privacy_level: privacyLevel }),
    ),
    spyOn(stateCache, "getCachedTomoriState").mockResolvedValue(persona),
    spyOn(stateCache, "getCachedAllPersonas").mockResolvedValue([persona]),
    spyOn(gate, "waitForWelcomeGate").mockResolvedValue({ outcome: "open", member }),
    spyOn(membership, "checkWelcomeMembership").mockResolvedValue({ status: "active", member: refreshedMember }),
    spyOn(mentions, "buildForcedMentionsForUser").mockResolvedValue([]),
    spyOn(mentions, "ensureDiscordUserMention").mockResolvedValue(undefined),
    blacklist,
    spyOn(userCache, "getCachedUserRow").mockResolvedValue(null),
    spyOn(userCache, "getCachedPrivacyLevel").mockResolvedValue(privacyLevel),
    spyOn(chat, "tomoriChat").mockImplementation(async (input) => {
      contexts.push(...(input.injectedContextItems ?? []));
      if (queueWelcome) {
        queuedWelcome = input;
        return "queued";
      }
      const incoming = normalizeChatInvocation({
        ...input,
        skipLock: true,
      });
      const admission = await evaluateChatAdmission(incoming);
      admissions.push(admission.disposition);

      suppressNextSelfReply(channel.id);
      const unrelatedManual = normalizeChatInvocation({
        client,
        message,
        isFromQueue: false,
        isManuallyTriggered: true,
        borrowsTriggerMessage: true,
      });
      await evaluateChatAdmission(unrelatedManual);
      expect(unrelatedManual.suppressSelfReply).toBeUndefined();
      expect(selfReplySuppressionUntil.has(channel.id)).toBe(true);
      selfReplySuppressionUntil.delete(channel.id);

      const lockEntry = getOrCreateChannelLockEntry(channel.id, guild.id);
      acquireChannelLockForTurn(lockEntry, {
        messageId: message.id,
        userDiscId: message.author.id,
        isPersonaJob: false,
        isCommandTriggered: true,
        suppressSelfReply: incoming.suppressSelfReply,
      });
      const botEcho = (id: string) =>
        ({
          ...message,
          id,
          author: { id: "fixture-bot", username: "Tomori", bot: true },
          content: "welcome line",
        }) as unknown as Message;
      const inFlightEcho = await evaluateChatAdmission(
        normalizeChatInvocation({ client, message: botEcho("100000000000000201"), isFromQueue: false }),
      );
      echoReasons.push(inFlightEcho.reason);
      releaseChannelLockAndReplayQueue({
        channelId: channel.id,
        lockEntry,
        completedMessageId: message.id,
        handleStopResponse: async () => {},
        processQueuedMessage: async () => {},
      });
      const postReleaseEcho = await evaluateChatAdmission(
        normalizeChatInvocation({ client, message: botEcho("100000000000000202"), isFromQueue: false }),
      );
      echoReasons.push(postReleaseEcho.reason);
      return admission.disposition;
    }),
  ];
  try {
    await handler(client, member);
    const wouldReplyToMember = async (id: string) => {
      const reply = { ...message, id, author: member.user, content: "Thanks!" } as Message;
      await observeWelcomeReply(reply, Promise.resolve(null));
      return chat.shouldBotReply(reply, persona, [persona], { referencedMessage: null });
    };
    return {
      admissions,
      echoReasons,
      blacklistReads: blacklist.mock.calls.length,
      prompt: contexts
        .flatMap((context) => context.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])))
        .join("\n"),
      queuedWelcome,
      wouldReplyToMember,
      channelId: channel.id,
    };
  } finally {
    for (const spy of spies) spy.mockRestore();
    clearChannelProcessingQueue(channel.id);
    selfReplySuppressionUntil.delete(channel.id);
  }
}

describe("welcome attribution", () => {
  it("admits a welcome anchored on a blacklisted bystander's message and suppresses its gateway echoes", async () => {
    const result = await runWelcome();
    expect(result.admissions).toEqual(["run"]);
    expect(result.echoReasons).toEqual(["self_reply_suppressed", "self_reply_suppressed"]);
    expect(result.blacklistReads).toBe(0);
  });

  it("includes roles fetched after onboarding in standalone and member-carried greetings", async () => {
    for (const takeHandoff of [false, true]) {
      const result = await runWelcome(PrivacyLevel.MINIMAL, takeHandoff);
      expect(result.prompt).toContain(JSON.stringify(["Português", "Community"]));
      expect(result.prompt).not.toContain("@everyone");
      if (takeHandoff) expect(result.admissions).toEqual([]);
    }
  });

  it("keeps roles out of greetings when member privacy hides them", async () => {
    for (const privacyLevel of [PrivacyLevel.PARTIAL, PrivacyLevel.FULL]) {
      for (const takeHandoff of [false, true]) {
        const result = await runWelcome(privacyLevel, takeHandoff);
        expect(result.prompt).toContain("Mirri");
        expect(result.prompt).not.toContain("Português");
        expect(result.prompt).not.toContain("Community");
      }
    }
  });

  it("arms a queued welcome only after its greeting has a Discord delivery receipt", async () => {
    for (const delivered of [true, false]) {
      const { queuedWelcome, wouldReplyToMember, channelId } = await runWelcome(PrivacyLevel.MINIMAL, false, true);
      const greetingId = "100000000000000102";
      expect(await wouldReplyToMember("100000000000000101")).toBe(false);
      await queuedWelcome?.onGenerationResult?.(
        delivered
          ? {
              status: "completed",
              streamResults: [{ status: "completed", firstMessageId: greetingId, accumulatedText: "Welcome!" }],
              personaResponses: [{ personaId: 1, personaName: "Mirri", text: "Welcome!" }],
              firstDeliveredMessageId: greetingId,
            }
          : { status: "empty_response", streamResults: [], personaResponses: [] },
        delivered
          ? [
              {
                messageId: greetingId,
                channelId,
                route: "bot",
                webhookId: null,
                identity: { username: "Mirri" },
                speaker: { personaId: 1, kind: "appearance" },
              },
            ]
          : [],
      );
      expect(await wouldReplyToMember("100000000000000103")).toBe(delivered);
    }
  });
});
