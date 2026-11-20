import { StreamUiUpdater } from "@/utils/discord/stream/uiUpdater";
import { createDefaultStreamState } from "@/types/stream/types";
import type { StreamContext } from "@/types/stream/interfaces";
import { REST } from "discord.js";
import { afterEach, beforeAll, expect, it, mock, spyOn } from "bun:test";
import { type EmbedBuilder, MessageFlags, PermissionFlagsBits } from "discord.js";
import { RollDiceTool } from "@/tools/functionCalls/rollDiceTool";
import { getAvailableToolsForContext, isBuiltInToolAvailable, type ToolStateForContext } from "@/tools/availability";
import type { ToolContext } from "@/types/tool/interfaces";
import type { DiceRollResult } from "@/utils/dice/diceRoll";
import { clearPersonaAppearances } from "@/utils/cache/personaAppearanceCacheStore";
import { clearPersonaSpriteCache, setPersonaSpriteCache } from "@/utils/cache/personaSpriteCacheStore";
import {
  buildCapabilitiesManageConfigWritePlan,
  getCapabilitiesManagePermissionDefinitions,
} from "@/utils/discord/manageConfigMapping";
import {
  clearAllChannelDeliveryContinuity,
  getChannelLastDelivery,
} from "@/utils/discord/stream/channelDeliveryContinuity";
import * as lifecycle from "@/utils/discord/webhook/lifecycle";
import * as identity from "@/utils/discord/webhook/identity";
import * as channelQueue from "@/utils/chat/channelQueue";
import { log } from "@/utils/misc/logger";
import { initializeLocalizer } from "@/utils/text/localizer";
import { getDeliberateToolAllowedNames } from "@/utils/tools/deliberateToolMode";
import { createPersona } from "../../helpers/fixtures";
import { localizedCopy } from "../../helpers/localeCases";

beforeAll(initializeLocalizer);
afterEach(() => {
  mock.restore();
  clearAllChannelDeliveryContinuity();
  clearPersonaAppearances();
  clearPersonaSpriteCache();
});

const CHANNEL = "channel";

function fixture(options: { enabled?: boolean; isAlter?: boolean } = {}) {
  const sent: unknown[] = [];
  const send = mock(async (payload: unknown) => {
    sent.push(payload);
    return { id: `bot-message-${sent.length}`, channelId: CHANNEL, webhookId: null, author: { id: "bot" } };
  });
  const channel = {
    id: CHANNEL,
    client: { user: { id: "bot" }, rest: new REST() },
    guildId: "guild",
    lastMessageId: null as string | null,
    guild: { id: "guild", members: { me: { id: "bot", displayAvatarURL: () => undefined } } },
    isThread: () => false,
    parent: null as unknown,
    fetchWebhooks: mock(),
    createWebhook: mock(),
    send,
    permissionsFor: () => ({ has: () => true }),
  };
  const context = {
    client: { user: { id: "bot" } },
    channel,
    tomoriState: createPersona({
      persona_id: 1,
      persona_nickname: "Juno",
      is_alter: options.isAlter ?? false,
      webhook_avatar_url: "https://example.com/juno.png",
      config: { dice_rolling_enabled: options.enabled ?? true },
    }),
    deliveryMode: "persona",
    provider: "google",
    locale: "en-US",
  } as unknown as ToolContext;
  return { context, send, channel, sent };
}

function webhookFixture() {
  const messages: unknown[] = [];
  spyOn(identity, "resolvePersonaWebhookIdentity").mockImplementation(async (persona) => ({
    username: persona.persona_nickname,
    avatarUrl: persona.webhook_avatar_url ?? undefined,
  }));
  const webhook = {
    id: "webhook-1",
    channelId: CHANNEL,
    guildId: "guild",
    token: "fixture",
    client: { rest: new REST() },
    send: mock(async (payload: Record<string, unknown>) => {
      messages.push(payload);
      return { id: `webhook-message-${messages.length}`, channelId: CHANNEL, webhookId: "webhook-1", author: {} };
    }),
  };
  const spy = spyOn(lifecycle, "getOrCreateWebhook").mockResolvedValue({ webhook: webhook as never });
  return { webhook, messages, spy };
}

function spriteRow(isIdentity = false) {
  return {
    sprite_id: 3,
    persona_id: 1,
    sprite_name: "joy",
    sprite_key: "joy",
    avatar_url: "https://example.com/joy.png",
    usage_instructions: "",
    is_identity: isIdentity,
  };
}

it("advertises and executes dice rolls by default and respects disabled switch", async () => {
  const f = fixture();
  const tool = new RollDiceTool();
  const state: ToolStateForContext = {
    server_id: "server",
    activePersonaHasElevenlabsVoice: false,
    llm: f.context.tomoriState.llm,
    config: f.context.tomoriState.config,
  };
  expect(createPersona().config.dice_rolling_enabled).toBe(true);
  expect(getAvailableToolsForContext([tool], "google", state).map((entry) => entry.name)).toContain("roll_dice");
  expect(isBuiltInToolAvailable(tool, "google", f.context)).toBe(true);
  expect(getDeliberateToolAllowedNames("Please roll dice for this check")).toContain("roll_dice");

  f.context.tomoriState.config.dice_rolling_enabled = false;
  state.config = f.context.tomoriState.config;
  expect(getAvailableToolsForContext([tool], "google", state)).toEqual([]);
  expect(isBuiltInToolAvailable(tool, "google", f.context)).toBe(false);
  expect((await tool.execute({ dice: "d20" }, f.context)).success).toBe(false);
  expect(f.send).not.toHaveBeenCalled();
});

it("saves changes through the existing Available Tools write plan", () => {
  const config = { ...createPersona().config, dice_rolling_enabled: false };
  const selected = getCapabilitiesManagePermissionDefinitions({ page: "available-tools" })
    .filter((definition) => definition.getState(config))
    .map((definition) => definition.value);
  const plan = buildCapabilitiesManageConfigWritePlan(config, [...selected, "dicerolling"], {
    page: "available-tools",
  });
  expect(plan.patch.capabilities).toEqual({ dice_rolling_enabled: true });
  const disabled = buildCapabilitiesManageConfigWritePlan({ ...config, dice_rolling_enabled: true }, selected, {
    page: "available-tools",
  });
  expect(disabled.patch.capabilities).toEqual({ dice_rolling_enabled: false });
});

it("posts the persona's public embed and returns the same dice results to the model", async () => {
  const f = fixture();
  const suppress = spyOn(channelQueue, "suppressNextSelfReply").mockImplementation(() => undefined);
  const result = await new RollDiceTool().execute(
    { dice: "1d20+5", mode: "advantage", reason: "Stealth check" },
    f.context,
  );
  expect(result.success).toBe(true);
  const data = result.data as DiceRollResult & { message_id: string };
  expect(data.rolls).toHaveLength(2);
  expect(data.kept).toEqual([Math.max(...data.rolls)]);
  expect(data.total).toBe(data.kept[0] + 5);
  expect(data.message_id).toBe("bot-message-1");
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(suppress).toHaveBeenCalledWith(f.context.channel.id);
  const payload = f.send.mock.calls[0][0] as { embeds: EmbedBuilder[]; flags: number; allowedMentions: unknown };
  expect(payload.embeds[0].data.description).toContain(
    localizedCopy("en-US", "commands.roll.rolled_with_reason", {
      actor: "Juno",
      dice: data.dice,
      reason: "Stealth check",
    }),
  );
  expect(payload.embeds[0].data.footer?.text).toBe(localizedCopy("en-US", "commands.roll.footer_shared"));
  expect(payload.flags).toBe(MessageFlags.SuppressNotifications);
  expect(payload.allowedMentions).toEqual({ parse: [] });
  expect(getChannelLastDelivery(CHANNEL)).toEqual({
    via: "bot",
    speaker: { personaId: 1, kind: "appearance" },
  });
});

it("posts an alter persona's roll under that alter's webhook identity", async () => {
  const f = fixture({ isAlter: true });
  const { webhook, messages } = webhookFixture();

  const result = await new RollDiceTool().execute({ dice: "d20", reason: "Stealth check" }, f.context);

  expect(result.success).toBe(true);
  expect(f.send).not.toHaveBeenCalled();
  expect(webhook.send).toHaveBeenCalledTimes(1);
  const payload = messages[0] as {
    username?: string;
    avatarURL?: string;
    embeds: EmbedBuilder[];
    flags: number;
  };
  expect(payload.username).toBe("Juno");
  expect(payload.avatarURL).toBe("https://example.com/juno.png");
  expect(payload.embeds[0].data.description).toContain(
    localizedCopy("en-US", "commands.roll.rolled_with_reason", {
      actor: "Juno",
      dice: "1d20",
      reason: "Stealth check",
    }),
  );
  expect(payload.flags).toBe(MessageFlags.SuppressNotifications);
  expect(getChannelLastDelivery(CHANNEL)).toMatchObject({
    via: "webhook",
    webhookId: webhook.id,
    identity: { username: "Juno", avatarUrl: "https://example.com/juno.png" },
    speaker: { personaId: 1, kind: "appearance" },
  });
});

it("inherits a main persona's committed sprite across intervening messages", async () => {
  const f = fixture();
  const { webhook, messages } = webhookFixture();
  setPersonaSpriteCache(1, [spriteRow()]);
  const updater = new StreamUiUpdater({
    hasStopRequest: () => false,
    requestStop: () => true,
    notifyStreamProgress: () => undefined,
  });
  await updater.sendSinglePayload(
    {
      content: "sprite text",
      identityOverride: { username: "Juno", avatarUrl: "https://example.com/joy.png" },
      spriteRecord: { personaId: 1, spriteName: "joy", isIdentity: false },
    },
    "sprite text",
    {
      ...f.context,
      client: f.context.client,
      tomoriState: f.context.tomoriState,
      webhook,
      personaUsername: "Juno",
      deliveryMode: "persona",
      contextItems: [],
      currentTurnModelParts: [],
    } as unknown as StreamContext,
    createDefaultStreamState(),
  );
  messages.length = 0;
  webhook.send.mockClear();
  f.channel.lastMessageId = "1500000000000000000";
  f.channel.lastMessageId = "1500000000000000000";

  const result = await new RollDiceTool().execute({ dice: "d20" }, f.context);

  expect(result.success).toBe(true);
  expect(f.send).not.toHaveBeenCalled();
  const payload = messages[0] as { username?: string; avatarURL?: string; embeds: EmbedBuilder[] };
  expect(payload.username).toBe("Juno");
  expect(payload.avatarURL).toBe("https://example.com/joy.png");
  expect(payload.embeds[0].data.description).toContain(
    localizedCopy("en-US", "commands.roll.rolled", { actor: "Juno", dice: "1d20" }),
  );
  expect(getChannelLastDelivery(CHANNEL)).toMatchObject({
    via: "webhook",
    webhookId: webhook.id,
    identity: { username: "Juno", avatarUrl: "https://example.com/joy.png" },
    speaker: { personaId: 1, kind: "appearance" },
  });
});

it("does not repost as the bot when an alter roll's webhook outcome is unconfirmed", async () => {
  const f = fixture({ isAlter: true });
  spyOn(identity, "resolvePersonaWebhookIdentity").mockResolvedValue({
    username: "Juno",
    avatarUrl: "https://example.com/juno.png",
  });
  const webhook = {
    id: "webhook-1",
    channelId: CHANNEL,
    guildId: "guild",
    token: "fixture",
    client: { rest: new REST() },
    send: mock(async () => {
      throw new Error("socket hang up");
    }),
  };
  spyOn(lifecycle, "getOrCreateWebhook").mockResolvedValue({ webhook: webhook as never });

  const result = await new RollDiceTool().execute({ dice: "d20" }, f.context);

  expect(result.success).toBe(false);
  expect(webhook.send).toHaveBeenCalledTimes(1);
  expect(f.send).not.toHaveBeenCalled();
  expect(getChannelLastDelivery(CHANNEL)).toBeNull();
});

it("does not repost as the bot when an alter roll is definitely refused", async () => {
  const f = fixture({ isAlter: true });
  spyOn(identity, "resolvePersonaWebhookIdentity").mockResolvedValue({
    username: "Juno",
    avatarUrl: "https://example.com/juno.png",
  });
  const webhook = {
    id: "webhook-1",
    channelId: CHANNEL,
    guildId: "guild",
    token: "fixture",
    client: { rest: new REST() },
    send: mock(async () => {
      throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
    }),
  };
  spyOn(lifecycle, "getOrCreateWebhook").mockResolvedValue({ webhook: webhook as never });

  const result = await new RollDiceTool().execute({ dice: "d20" }, f.context);

  expect(result.success).toBe(false);
  expect(f.send).not.toHaveBeenCalled();
});

it("rejects invalid and cancelled rolls without posting and reports delivery failures", async () => {
  const f = fixture();
  const tool = new RollDiceTool();
  for (const args of [{}, { dice: "101d6" }, { dice: "2d6", mode: "advantage" }])
    expect((await tool.execute(args, f.context)).success).toBe(false);
  f.context.abortSignal = AbortSignal.abort();
  expect((await tool.execute({ dice: "d20" }, f.context)).success).toBe(false);
  expect(f.send).not.toHaveBeenCalled();
  f.context.abortSignal = undefined;
  f.send.mockRejectedValueOnce(new Error("delivery failed"));
  const logged = spyOn(log, "error").mockImplementation(async () => {});
  expect((await tool.execute({ dice: "d20" }, f.context)).success).toBe(false);
  expect(logged).toHaveBeenCalled();
});

it("requires embed access and uses thread send permission in threads", async () => {
  const f = fixture();
  const tool = new RollDiceTool();
  const has = mock((_permissions: readonly bigint[]) => false);
  Object.assign(f.context.client, { user: { id: "bot" } });
  Object.assign(f.context.channel, { permissionsFor: () => ({ has }), isThread: () => true });
  expect((await tool.execute({ dice: "d20" }, f.context)).success).toBe(false);
  expect(f.send).not.toHaveBeenCalled();
  expect(has.mock.calls[0][0]).toContain(PermissionFlagsBits.SendMessagesInThreads);
  has.mockReturnValue(true);
  expect((await tool.execute({ dice: "d20" }, f.context)).success).toBe(true);
  expect(f.send).toHaveBeenCalledTimes(1);
});
