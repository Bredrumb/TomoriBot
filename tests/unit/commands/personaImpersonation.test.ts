import { stubAllShardOwnership } from "../../helpers/shardOwnership";
stubAllShardOwnership();
import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { ChannelType, MessageFlags, type ChatInputCommandInteraction, type Client, type Message } from "discord.js";
import { execute } from "@/commands/impersonate/persona";
import * as chat from "@/events/messageCreate/tomoriChat";
import { PrivacyLevel } from "@/types/db/schema";
import { evaluateChatAdmission, normalizeChatInvocation } from "@/utils/chat/admission";
import { shouldBotReply } from "@/utils/chat/replyDecision";
import { getSelfReplyChainState } from "@/utils/chat/selfReplyState";
import * as stateCache from "@/utils/cache/tomoriStateCache";
import * as userCache from "@/utils/cache/userCache";
import * as whitelistCache from "@/utils/cache/channelWhitelistCache";
import * as spotlightCache from "@/utils/cache/personalSpotlightCache";
import { personaRepository, serverRepository } from "@/utils/db/repositories";
import * as webhook from "@/utils/discord/webhook/webhookCore";
import * as sends from "@/utils/discord/webhook/singleAttemptMessage";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";

beforeAll(initializeLocalizer);
afterEach(() => {
  getSelfReplyChainState("impersonation-channel").updatedAt = 0;
  for (const restore of mockRestores.splice(0).reverse()) restore();
});
const mockRestores: Array<() => void> = [];

describe("persona impersonation cross-triggers", () => {
  for (const isAlter of [false, true]) {
    for (const prior of ["fresh", "expired", "exhausted"] as const) {
      it(`credits the ephemeral command invoker for ${isAlter ? "webhook" : "bot"} delivery with a ${prior} chain`, async () => {
        const main = createPersona({ persona_id: 1, persona_nickname: "Mirri", trigger_words: ["mirri"] });
        const alter = createPersona({
          persona_id: 2,
          persona_nickname: "Juno",
          is_alter: true,
          trigger_words: ["juno"],
        });
        const personas = [main, alter];
        const selected = isAlter ? alter : main;
        const client = { user: { id: "fixture-bot" } } as Client;
        const guild = { id: "fixture-guild", members: { me: null } };
        const channel = {
          id: "impersonation-channel",
          type: ChannelType.PublicThread,
          parentId: "fixture-parent",
          parent: { id: "fixture-parent" },
          isThread: () => true,
        };
        const message = {
          id: `post-${isAlter}-${prior}`,
          client,
          channel,
          channelId: channel.id,
          guild,
          guildId: guild.id,
          author: {
            id: isAlter ? "fixture-webhook" : client.user?.id,
            username: selected.persona_nickname,
            bot: true,
            displayAvatarURL: () => "https://example.com/avatar.png",
          },
          webhookId: isAlter ? "fixture-webhook" : null,
          content: isAlter ? "hello @mirri" : "hello @juno",
          embeds: [],
          attachments: new Map(),
          mentions: { users: new Map(), roles: new Map(), everyone: false },
          interaction: null,
          reference: null,
        } as unknown as Message;
        const { interaction, calls } = makeFakeInteraction({
          guild,
          guildId: guild.id,
          channel,
          member: null,
          options: {
            getString: (name) => (name === "persona" ? String(selected.persona_id) : message.content),
            getBoolean: () => null,
          },
        });
        const invoker = createUserRow({ user_disc_id: interaction.user.id });
        const chain = getSelfReplyChainState(channel.id);
        chain.originUserDiscId = prior === "fresh" ? null : "previous-user";
        chain.triggerCount = prior === "exhausted" ? 11 : 0;
        if (prior === "expired") chain.updatedAt = 0;
        const outcomes: string[] = [];
        const admit = async (input: Parameters<typeof chat.tomoriChat>[0]) => {
          const admission = await evaluateChatAdmission(normalizeChatInvocation({ ...input, skipLock: true }));
          expect(admission.disposition).toBe("run");
          if (admission.disposition === "run") expect(admission.userDiscId).toBe(interaction.user.id);
          expect(shouldBotReply(message, main, personas, { referencedMessage: null })).toBe(true);
          outcomes.push(admission.disposition);
          return admission.disposition;
        };
        const post = async () => {
          await admit({ client, message, isFromQueue: false });
          return message;
        };
        const spies = [
          spyOn(personaRepository, "loadAllForServer").mockResolvedValue(personas),
          spyOn(stateCache, "getCachedAllPersonas").mockResolvedValue(personas),
          spyOn(userCache, "getCachedPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL),
          spyOn(userCache, "getCachedBlacklistStatus").mockResolvedValue(false),
          spyOn(spotlightCache, "getCachedPersonalSpotlightStatus").mockResolvedValue(null),
          spyOn(whitelistCache, "getCachedWhitelistStatus").mockResolvedValue({
            hasActiveWhitelist: false,
            hasActiveChannelWhitelist: false,
            isChannelWhitelisted: false,
            hasActiveRoleWhitelist: false,
            isRoleWhitelisted: false,
            hasActivePersonaWhitelist: false,
            isTriggerAllowed: true,
            hasChannelCooldownOverride: false,
          }),
          spyOn(serverRepository, "loadManagedWebhookByChannelAndWebhookId").mockResolvedValue({
            managed_webhook_id: 1,
            guild_disc_id: guild.id,
            channel_disc_id: channel.parentId,
            webhook_disc_id: "fixture-webhook",
            kind: "shared_channel",
            webhook_token: Buffer.from("fixture"),
            key_version: 1,
            avatar_fingerprint: null,
            discord_avatar_hash: null,
          }),
          spyOn(webhook, "getOrCreateWebhook").mockResolvedValue({
            webhook: {} as Awaited<ReturnType<typeof webhook.getOrCreateWebhook>>["webhook"],
          }),
          spyOn(webhook, "resolvePersonaWebhookIdentity").mockResolvedValue({
            username: selected.persona_nickname,
            avatarUrl: "https://example.com/avatar.png",
          }),
          spyOn(webhook, "dispatchWebhookWithIdentity").mockImplementation(async (_hook, identity, send) => {
            if (!identity) throw new Error("Expected persona identity");
            const selection = { webhook: _hook, identity, webhookId: "fixture-webhook" };
            return { result: await send(selection), ...selection };
          }),
          spyOn(sends, "sendChannelMessageOnce").mockImplementation(post),
          spyOn(sends, "sendSelectedWebhookMessageOnce").mockImplementation(post),
          spyOn(chat, "tomoriChat").mockResolvedValue("ignore"),
        ];
        for (const spy of spies) mockRestores.push(() => spy.mockRestore());

        await execute(client, interaction as unknown as ChatInputCommandInteraction, invoker, "en-US");

        expect(calls[0]).toMatchObject({ method: "deferReply", args: [{ flags: MessageFlags.Ephemeral }] });
        expect(outcomes).toEqual(["run"]);
        expect(chat.tomoriChat).not.toHaveBeenCalled();
        expect(getSelfReplyChainState(channel.id).originUserDiscId).toBe(interaction.user.id);
        expect(getSelfReplyChainState(channel.id).triggerCount).toBe(0);
      });
    }
  }
});
