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
import { selfReplySuppressionUntil } from "@/utils/chat/channelQueue";
import { applyWelcomeHandoff } from "@/utils/chat/welcomeHandoff";
import type { StructuredContextItem } from "@/types/misc/context";
import { PrivacyLevel } from "@/types/db/schema";
import { createLlmRow, createPersona, createUserRow } from "../../helpers/fixtures";

async function runWelcome(privacyLevel = PrivacyLevel.MINIMAL, takeHandoff = false) {
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
    members: { me: null, cache: new Map() },
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
  const contexts: StructuredContextItem[] = [];
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
      const admission = await evaluateChatAdmission(
        normalizeChatInvocation({
          ...input,
          skipLock: true,
        }),
      );
      admissions.push(admission.disposition);
      return admission.disposition;
    }),
  ];
  try {
    await handler(client, member);
    return {
      admissions,
      blacklistReads: blacklist.mock.calls.length,
      prompt: contexts
        .flatMap((context) => context.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])))
        .join("\n"),
    };
  } finally {
    for (const spy of spies) spy.mockRestore();
    selfReplySuppressionUntil.delete(channel.id);
  }
}

describe("welcome attribution", () => {
  it("admits a welcome anchored on a blacklisted bystander's message", async () => {
    const result = await runWelcome();
    expect(result.admissions).toEqual(["run"]);
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
});
