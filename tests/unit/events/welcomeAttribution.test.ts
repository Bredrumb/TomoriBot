import { stubAllShardOwnership } from "../../helpers/shardOwnership";
stubAllShardOwnership();
import { describe, expect, it, spyOn } from "bun:test";
import { ChannelType, TextChannel, type Client, type GuildMember, type Message } from "discord.js";
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
import { createLlmRow, createPersona, createUserRow } from "../../helpers/fixtures";

describe("welcome attribution", () => {
  it("admits a welcome anchored on a blacklisted bystander's message", async () => {
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
      messages: { fetch: async () => ({ first: () => message }) },
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
    } as unknown as GuildMember;
    const admissions: string[] = [];
    const spies = [
      spyOn(userRepository, "register").mockResolvedValue(createUserRow({ user_disc_id: member.id })),
      spyOn(stateCache, "getCachedTomoriState").mockResolvedValue(persona),
      spyOn(stateCache, "getCachedAllPersonas").mockResolvedValue([persona]),
      spyOn(gate, "waitForWelcomeGate").mockResolvedValue({ outcome: "open", member }),
      spyOn(membership, "checkWelcomeMembership").mockResolvedValue({ status: "active" }),
      spyOn(mentions, "buildForcedMentionsForUser").mockResolvedValue([]),
      spyOn(mentions, "ensureDiscordUserMention").mockResolvedValue(undefined),
      spyOn(userCache, "getCachedBlacklistStatus").mockResolvedValue(true),
      spyOn(userCache, "getCachedUserRow").mockResolvedValue(null),
      spyOn(chat, "tomoriChat").mockImplementation(async (input) => {
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
      expect(admissions).toEqual(["run"]);
      expect(userCache.getCachedBlacklistStatus).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
      selfReplySuppressionUntil.delete(channel.id);
    }
  });
});
