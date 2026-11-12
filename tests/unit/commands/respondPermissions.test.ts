import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  Collection,
  DiscordAPIError,
  type EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Client,
  type Message,
} from "discord.js";
import { execute } from "@/commands/respond";
import * as chat from "@/events/messageCreate/tomoriChat";
import { invalidateWhitelistCache } from "@/utils/cache/channelWhitelistCache";
import { invalidatePersonalSpotlightCache } from "@/utils/cache/personalSpotlightCache";
import {
  cooldownRepository,
  llmModelRepo,
  personaRepository,
  userRepository,
  whitelistRepository,
} from "@/utils/db/repositories";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createLlmRow, createPersona, createUserRow } from "../../helpers/fixtures";
import { makeFakeInteraction, type FakeCall } from "../../helpers/fakeInteraction";
import { localizedCopy } from "../../helpers/localeCases";

const guildId = "100000000000000001";
const channelId = "100000000000000002";
const persona = createPersona({ persona_id: 1 });

beforeAll(initializeLocalizer);
beforeEach(() => {
  invalidateWhitelistCache(guildId);
  invalidateWhitelistCache("fake_user_id");
  invalidatePersonalSpotlightCache(persona.server_id);
  spyOn(personaRepository, "loadState").mockResolvedValue(persona);
  spyOn(personaRepository, "loadAllForServer").mockResolvedValue([persona]);
  spyOn(cooldownRepository, "checkMessageTriggerCooldownWithWhitelist").mockResolvedValue({
    isOnCooldown: false,
    remainingSeconds: 0,
    cooldownType: 0,
  });
  spyOn(userRepository, "serverHasPersonalSpotlights").mockResolvedValue(false);
  spyOn(chat, "tomoriChat").mockResolvedValue("ignore");
  spyOn(cooldownRepository, "setMessageTriggerCooldownWithWhitelist").mockResolvedValue(undefined);
  spyOn(whitelistRepository, "checkChannelWhitelist").mockResolvedValue({
    hasActiveWhitelist: false,
    hasActiveChannelWhitelist: false,
    isChannelWhitelisted: false,
    hasActiveRoleWhitelist: false,
    isRoleWhitelisted: false,
    hasActivePersonaWhitelist: false,
    isTriggerAllowed: true,
    hasChannelCooldownOverride: false,
  });
});
afterEach(() => {
  mock.restore();
  invalidateWhitelistCache(guildId);
  invalidateWhitelistCache("fake_user_id");
  invalidatePersonalSpotlightCache(persona.server_id);
});

function invocation(voice: boolean, connect: boolean, error?: Error) {
  const fetch = mock(async (): Promise<Collection<string, Message>> => {
    if (error) throw error;
    return new Collection();
  });
  const channel = {
    id: channelId,
    isThread: () => false,
    isVoiceBased: () => voice,
    permissionsFor: () => ({ has: (bit: bigint) => bit !== PermissionFlagsBits.Connect || connect }),
    messages: { fetch },
  };
  const fake = makeFakeInteraction({
    channel,
    channelId,
    guildId,
    guild: { id: guildId, members: { me: {} }, channels: { cache: new Map([[channelId, channel]]) } },
  });
  const editReply = fake.interaction.editReply;
  fake.interaction.editReply = async (...args) => {
    await editReply(...args);
    fake.interaction.replied = true;
  };
  const deleteReply = mock(async () => {
    fake.calls.push({ method: "deleteReply", args: [] });
  });
  return {
    ...fake,
    fetch,
    deleteReply,
    interaction: Object.assign(fake.interaction, { deleteReply }) as unknown as ChatInputCommandInteraction,
  };
}

function description(calls: FakeCall[]): string | undefined {
  const payload = calls.find((call) => call.method === "reply" || call.method === "editReply")?.args[0] as {
    embeds: EmbedBuilder[];
  };
  return payload?.embeds[0]?.toJSON().description;
}

describe("/respond history permissions", () => {
  it("explains missing Connect before fetching voice-channel history", async () => {
    const { interaction, calls, fetch } = invocation(true, false);
    await execute({} as Client, interaction, createUserRow(), "en-US");
    expect(fetch).not.toHaveBeenCalled();
    expect(description(calls)).toBe(localizedCopy("en-US", "general.errors.channel_missing_permissions_description"));
  });

  it("fetches text history without Connect and voice history with Connect", async () => {
    for (const voice of [false, true]) {
      const { interaction, calls, fetch } = invocation(voice, voice);
      await execute({} as Client, interaction, createUserRow(), "en-US");
      expect(fetch).toHaveBeenCalled();
      expect(description(calls)).toBe(localizedCopy("en-US", "commands.respond.no_messages_description"));
    }
  });

  it("explains REST access rejections even when cached permissions allow history", async () => {
    for (const code of [50001, 50013]) {
      const error = new DiscordAPIError(
        { code, message: "Rejected" },
        code,
        403,
        "GET",
        "https://discord.com/api/v10/channels/100000000000000002/messages",
        {},
      );
      const { interaction, calls } = invocation(true, true, error);
      await execute({} as Client, interaction, createUserRow(), "en-US");
      expect(description(calls)).toBe(localizedCopy("en-US", "general.errors.channel_missing_permissions_description"));
    }
  });

  it("leaves unrelated fetch failures to the command error handler", async () => {
    const error = new Error("Network failure");
    const { interaction } = invocation(false, false, error);
    await expect(execute({} as Client, interaction, createUserRow(), "en-US")).rejects.toBe(error);
  });
});

describe("/respond invocation options", () => {
  const alter = createPersona({ persona_id: 2, persona_nickname: "Juno", is_alter: true });
  const latestMessage = {
    id: "latest-message",
    author: { id: "bot", username: "Mirri", bot: true },
    content: "A reply to continue.",
    embeds: [],
    webhookId: null,
  } as unknown as Message;
  const client = { user: { id: "bot" } } as Client;

  function responseInvocation(strings: Record<string, string> = {}, reasoning: boolean | null = null) {
    const fixture = invocation(false, true);
    fixture.fetch.mockResolvedValue(new Collection([[latestMessage.id, latestMessage]]));
    Object.assign(fixture.interaction, {
      options: {
        getString: (name: string) => strings[name] ?? null,
        getBoolean: (name: string) => (name === "reasoning" ? reasoning : null),
      },
    });
    return fixture;
  }

  it("passes persona, prompt, prefill, and reasoning directly to the manual turn", async () => {
    const reasoningModel = createLlmRow({ llm_codename: "reasoning-model", is_smartest: true });
    spyOn(personaRepository, "loadAllForServer").mockResolvedValue([persona, alter]);
    const loadSmartestModel = spyOn(llmModelRepo, "loadSmartestModel").mockResolvedValue(reasoningModel);

    for (const personaOption of [String(alter.persona_id), "jUnO"]) {
      const { interaction, calls, deleteReply } = responseInvocation(
        {
          persona: personaOption,
          prompt: "  Focus on the mystery.  ",
          prefill: "  I suspect  ",
        },
        true,
      );
      spyOn(personaRepository, "loadState").mockImplementation(async () => {
        expect(calls[0]?.method).toBe("deferReply");
        return persona;
      });

      await execute(client, interaction, createUserRow(), "en-US");

      expect(loadSmartestModel).toHaveBeenCalledWith(persona.llm.llm_provider);
      expect(chat.tomoriChat).toHaveBeenLastCalledWith(
        expect.objectContaining({
          message: latestMessage,
          selectedPersonaId: alter.persona_id,
          isManuallyTriggered: true,
          forceReason: true,
          llmOverrideCodename: reasoningModel.llm_codename,
          reasoningQuery: "Focus on the mystery.",
          manualSystemPrompt: "Focus on the mystery.",
          manualPrefill: "I suspect",
          textQuotaUserDiscId: interaction.user.id,
          textQuotaTriggerKey: interaction.id,
          manualTriggerInvoker: expect.objectContaining({ userDiscId: interaction.user.id }),
        }),
      );
      expect(deleteReply).toHaveBeenCalled();
      expect(calls.findIndex((call) => call.method === "deleteReply")).toBeLessThan(
        calls.findIndex((call) => call.method === "followUp"),
      );
      expect(calls.find((call) => call.method === "followUp")?.args[0]).toMatchObject({
        flags: MessageFlags.SuppressNotifications,
      });
      expect(calls.some((call) => call.method === "showModal")).toBe(false);
    }
  });

  it("keeps automatic persona selection and notice visibility when options are omitted", async () => {
    const loadSmartestModel = spyOn(llmModelRepo, "loadSmartestModel");
    spyOn(personaRepository, "loadAllForServer").mockResolvedValue([persona, alter]);

    for (const hidden of [false, true]) {
      spyOn(personaRepository, "loadState").mockResolvedValue(
        createPersona({
          config: { tool_notice_hidden_keys: hidden ? ["respond_embed"] : [] },
        }),
      );
      const { interaction, calls, deleteReply } = responseInvocation({ prompt: "  ", prefill: "  " }, false);

      await execute(client, interaction, createUserRow(), "en-US");

      expect(chat.tomoriChat).toHaveBeenLastCalledWith(
        expect.objectContaining({
          message: latestMessage,
          selectedPersonaId: persona.persona_id,
          forceReason: undefined,
          llmOverrideCodename: undefined,
          manualSystemPrompt: undefined,
          manualPrefill: undefined,
        }),
      );
      expect(loadSmartestModel).not.toHaveBeenCalled();
      expect(calls[0]).toMatchObject({
        method: "deferReply",
        args: [{ flags: MessageFlags.Ephemeral | MessageFlags.SuppressNotifications }],
      });
      expect(calls.some((call) => call.method === "followUp")).toBe(!hidden);
      expect(deleteReply.mock.calls.length > 0).toBe(!hidden);
      expect(cooldownRepository.setMessageTriggerCooldownWithWhitelist).toHaveBeenCalled();
    }
  });

  it("rejects stale, malformed, partial, and ambiguous persona selections", async () => {
    spyOn(personaRepository, "loadAllForServer").mockResolvedValue([
      persona,
      alter,
      createPersona({ persona_id: 3, persona_nickname: alter.persona_nickname, is_alter: true }),
    ]);
    for (const value of ["999", "2junk", "Ju", "Juno"]) {
      const { interaction, calls, fetch } = responseInvocation({ persona: value });
      await execute(client, interaction, createUserRow(), "en-US");
      expect(description(calls)).toBe(localizedCopy("en-US", "commands.respond.invalid_persona_description"));
      expect(fetch).not.toHaveBeenCalled();
    }
    expect(chat.tomoriChat).not.toHaveBeenCalled();
    expect(cooldownRepository.setMessageTriggerCooldownWithWhitelist).not.toHaveBeenCalled();
  });

  it("rejects a selected persona excluded by a whitelist or personal spotlight", async () => {
    spyOn(personaRepository, "loadAllForServer").mockResolvedValue([persona, alter]);
    const whitelist = await whitelistRepository.checkChannelWhitelist(guildId, channelId);
    for (const restriction of ["whitelist", "spotlight"]) {
      invalidateWhitelistCache(guildId);
      invalidatePersonalSpotlightCache(persona.server_id);
      spyOn(whitelistRepository, "checkChannelWhitelist").mockResolvedValue({
        ...whitelist,
        hasActivePersonaWhitelist: restriction === "whitelist",
        restrictedPersonaIds: [2],
        whitelistedPersonaIds: [],
      });
      spyOn(userRepository, "serverHasPersonalSpotlights").mockResolvedValue(restriction === "spotlight");
      const user = createUserRow({ user_id: 1 });
      spyOn(userRepository, "getPersonalSpotlightStatus").mockResolvedValue({
        serverId: persona.server_id,
        userId: 1,
        channelDiscId: channelId,
        personaIds: [1],
        autoTriggerPersonaId: null,
        expiresAt: null,
        createdAt: null,
        updatedAt: null,
      });
      const { interaction, calls } = responseInvocation({ persona: String(alter.persona_id) });
      await execute(client, interaction, user, "en-US");
      expect(description(calls)).toBe(localizedCopy("en-US", "commands.respond.invalid_persona_description"));
    }
    expect(chat.tomoriChat).not.toHaveBeenCalled();
  });

  it("reports a missing reasoning model without triggering a turn", async () => {
    spyOn(llmModelRepo, "loadSmartestModel").mockResolvedValue(null);
    const { interaction, calls } = responseInvocation({}, true);
    await execute(client, interaction, createUserRow(), "en-US");
    expect(description(calls)).toBe(localizedCopy("en-US", "commands.respond.no_smart_model_description"));
    expect(chat.tomoriChat).not.toHaveBeenCalled();
    expect(cooldownRepository.setMessageTriggerCooldownWithWhitelist).not.toHaveBeenCalled();
  });

  it("settles the deferred reply when the shared cooldown sends a DM or falls back to a private reply", async () => {
    spyOn(cooldownRepository, "checkMessageTriggerCooldownWithWhitelist").mockResolvedValue({
      isOnCooldown: true,
      remainingSeconds: 3,
      cooldownType: 1,
    });
    for (const dmFails of [false, true]) {
      const { interaction, calls, deleteReply, fetch } = responseInvocation();
      Object.assign(interaction.user, {
        send: mock(async () => {
          if (dmFails) throw new Error("DM delivery rejected");
        }),
      });
      await execute(client, interaction, createUserRow(), "en-US");
      expect(calls[0]?.method).toBe("deferReply");
      if (dmFails) {
        expect(description(calls)).toBe(
          localizedCopy("en-US", "commands.respond.cooldown_active", {
            seconds: "3",
            botName: persona.persona_nickname,
          }),
        );
        expect(deleteReply).not.toHaveBeenCalled();
      } else {
        expect(deleteReply).toHaveBeenCalled();
      }
      expect(fetch).not.toHaveBeenCalled();
      expect(chat.tomoriChat).not.toHaveBeenCalled();
    }
  });

  it("uses the invoker's workspace for an explicit persona in DMs", async () => {
    const { interaction } = responseInvocation({ persona: String(persona.persona_id) });
    Object.assign(interaction, { guild: null, guildId: null });
    await execute(client, interaction, createUserRow(), "en-US");
    expect(personaRepository.loadAllForServer).toHaveBeenCalledWith(interaction.user.id);
    expect(chat.tomoriChat).toHaveBeenCalledWith(expect.objectContaining({ selectedPersonaId: persona.persona_id }));
  });
});
