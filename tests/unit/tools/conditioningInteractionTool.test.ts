import { StreamUiUpdater } from "@/utils/discord/stream/uiUpdater";
import { createDefaultStreamState } from "@/types/stream/types";
import type { StreamContext } from "@/types/stream/interfaces";
import { ToolRegistry } from "@/tools/toolRegistry";
import type { LLMProvider, StreamResult } from "@/types/provider/interfaces";
import type { ToolResult } from "@/types/tool/interfaces";
import type { ChatTurnContext, ToolHistoryEntry } from "@/utils/chat/types";
import { createExpressionDeliveryState } from "@/utils/chat/expressionDelivery";
import { runToolLoop } from "@/utils/chat/toolLoop";
import { REST } from "discord.js";
import { afterEach, beforeAll, expect, it, mock, spyOn } from "bun:test";
import { Collection, MessageFlags, type EmbedBuilder, type Message, type Webhook } from "discord.js";
import { ConditioningInteractionTool } from "@/tools/functionCalls/conditioningInteractionTool";
import type { ToolContext } from "@/types/tool/interfaces";
import * as personaCache from "@/utils/cache/tomoriStateCache";
import * as targetResolver from "@/utils/discord/targetResolver";
import * as whitelistCache from "@/utils/cache/channelWhitelistCache";
import * as spotlightCache from "@/utils/cache/personalSpotlightCache";
import * as chat from "@/events/messageCreate/tomoriChat";
import { conditioningMemoryRepository } from "@/utils/db/repositories/ConditioningMemoryRepository";
import { isBuiltInToolAvailable } from "@/tools/availability";
import { getAutonomousDeliberateToolNames } from "@/utils/tools/deliberateToolMode";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";
import { localizedCopy } from "../../helpers/localeCases";
import * as lifecycle from "@/utils/discord/webhook/lifecycle";
import * as identity from "@/utils/discord/webhook/identity";
import { clearPersonaAppearances } from "@/utils/cache/personaAppearanceCacheStore";
import { clearPersonaSpriteCache, setPersonaSpriteCache } from "@/utils/cache/personaSpriteCacheStore";
import {
  clearAllChannelDeliveryContinuity,
  getChannelLastDelivery,
  recordChannelDeliveredWebhookIdentity,
} from "@/utils/discord/stream/channelDeliveryContinuity";

beforeAll(initializeLocalizer);
const spies: { mockRestore(): void }[] = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  clearAllChannelDeliveryContinuity();
  clearPersonaAppearances();
  clearPersonaSpriteCache();
});
function track<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy);
  return spy;
}

const CHANNEL = "channel";
const ACTOR_ID = 1;

function fixture(targetType: "persona" | "user" = "persona") {
  const actor = createPersona({
    persona_id: ACTOR_ID,
    persona_nickname: "Juno",
    webhook_avatar_url: "https://example.com/juno.png",
    config: { conditioning_interactions_enabled: true },
  });
  const target = createPersona({ persona_id: 2, persona_lineage_id: 102, persona_nickname: "Mirri", is_alter: true });
  const invoker = {
    id: "123456789012345678",
    user: { username: "Bau", bot: false },
    roles: { cache: new Collection() },
  };
  const guild = {
    id: "guild",
    members: { me: { id: "bot", displayAvatarURL: () => undefined }, fetch: async () => invoker },
  };
  const delivered: Message[] = [];
  const channel: Record<string, unknown> = {
    id: CHANNEL,
    client: { user: { id: "bot" }, rest: new REST() },
    guildId: guild.id,
    lastMessageId: null as string | null,
    guild,
    isThread: () => false,
    fetchWebhooks: mock(),
    createWebhook: mock(),
    permissionsFor: () => ({ has: () => true }),
    send: mock(async () => {
      const id = `14000000000000000${delivered.length + 10}`;
      const message = {
        id,
        channelId: CHANNEL,
        url: `https://discord.com/channels/guild/channel/${id}`,
        webhookId: null,
        channel,
        author: { id: "bot", bot: true },
      } as unknown as Message;
      delivered.push(message);
      return message;
    }),
  };
  channel.parent = channel;
  const context = {
    client: {},
    channel,
    guildId: guild.id,
    tomoriState: actor,
    activePersonaId: ACTOR_ID,
    deliveryMode: "persona",
    locale: "en-US",
    provider: "google",
    userId: invoker.id,
    streamContext: { disableYouTubeProcessing: false },
  } as unknown as ToolContext;
  track(spyOn(personaCache, "getCachedAllPersonas").mockResolvedValue([actor, target]));
  track(
    spyOn(targetResolver, "resolveIdentityTarget").mockResolvedValue(
      targetType === "persona"
        ? {
            status: "resolved",
            targetType: "persona",
            persona: { ...target, persona_id: 2 },
            displayLabel: target.persona_nickname,
          }
        : {
            status: "resolved",
            targetType: "user",
            targetId: "223456789012345678",
            displayLabel: "Mirri",
            isBridgeUser: false,
            source: "conversation",
          },
    ),
  );
  const whitelist = {
    isTriggerAllowed: true,
    hasActivePersonaWhitelist: false,
    whitelistedPersonaIds: [],
    restrictedPersonaIds: [],
    hasActiveWhitelist: false,
    hasActiveChannelWhitelist: false,
    isChannelWhitelisted: false,
    hasActiveRoleWhitelist: false,
    isRoleWhitelisted: false,
    hasChannelCooldownOverride: false,
  };
  const whitelistSpy = track(spyOn(whitelistCache, "getCachedWhitelistStatus").mockResolvedValue(whitelist));
  track(spyOn(spotlightCache, "getCachedPersonalSpotlightStatus").mockResolvedValue(null));
  const record = track(
    spyOn(conditioningMemoryRepository, "recordEvent").mockResolvedValue({
      server_id: actor.server_id,
      persona_lineage_id: 102,
      conditioning_type: "reward",
      action_key: "feed",
      reason_text: "sharing snacks",
      reason_normalized: "sharing snacks",
      user_id: null,
      actor_persona_id: 1,
      count: 1,
    }),
  );
  const queued = track(spyOn(chat, "tomoriChat").mockResolvedValue("queued"));
  track(spyOn(chat, "suppressNextSelfReply").mockImplementation(() => undefined));
  return {
    context,
    actor,
    target,
    channel: channel as unknown as {
      id: string;
      lastMessageId: string | null;
      isThread: () => boolean;
      send: ReturnType<typeof mock>;
    },
    message: delivered[0],
    delivered,
    record,
    queued,
    whitelistSpy,
    whitelist,
  };
}

function spriteRow(isIdentity = false) {
  return {
    sprite_id: 3,
    persona_id: ACTOR_ID,
    sprite_name: "shy",
    sprite_key: "shy",
    avatar_url: "https://example.com/shy.png",
    usage_instructions: "",
    is_identity: isIdentity,
  };
}

function webhookFixture() {
  const messages: Array<Record<string, unknown>> = [];
  const webhook = {
    id: "sprite-webhook",
    channelId: CHANNEL,
    guildId: "guild",
    token: "fixture",
    client: { rest: new REST() },
    send: mock(async (payload: Record<string, unknown>) => {
      messages.push(payload);
      return {
        id: `1400000000000000002`,
        channelId: CHANNEL,
        url: "https://discord.com/channels/guild/channel/1400000000000000002",
        webhookId: webhook.id,
        channel: {},
        author: {},
      };
    }),
  };
  track(spyOn(lifecycle, "getOrCreateWebhook").mockResolvedValue({ webhook: webhook as unknown as Webhook }));
  track(
    spyOn(identity, "resolvePersonaWebhookIdentity").mockImplementation(async (persona) => ({
      username: persona.persona_nickname,
      avatarUrl: persona.webhook_avatar_url ?? undefined,
    })),
  );
  return { webhook, messages };
}

function queuedEvent(queued: ReturnType<typeof spyOn>, call: number): string {
  const args = (queued.mock.calls[call][0] ?? {}) as unknown as Record<string, unknown>;
  const item = (args.injectedContextItems as Array<{ parts: Array<{ text?: string }> }>)[0];
  return item.parts[0].text ?? "";
}

it("saves persona-attributed feedback and queues the target with the exact interaction event", async () => {
  const f = fixture();
  const tool = new ConditioningInteractionTool();
  const result = await tool.execute(
    { target: "Mirri", action: "feed", reason: "sharing snacks", food: "a cookie" },
    f.context,
  );
  expect(result.success).toBe(true);
  expect(result.responseDelivered).toBe(true);
  expect(result.message).toContain("Continue without repeating the gesture.");
  expect((result.data as { message_id: string }).message_id).toBe(f.delivered[0].id);
  expect(f.record).toHaveBeenCalledWith(
    expect.objectContaining({ actorPersonaId: 1, personaLineageId: 102, actionKey: "feed", actionText: "a cookie" }),
  );
  expect(f.record.mock.calls[0][0].userId).toBeUndefined();
  const payload = f.channel.send.mock.calls[0][0] as { embeds: EmbedBuilder[]; flags: number };
  expect(payload.embeds[0].data.description).toBe(
    localizedCopy("en-US", "commands.reward.feed.embed_description_with_reason", {
      user: "Juno",
      bot: "Mirri",
      reason: "sharing snacks",
      food_text: " `a cookie`",
    }),
  );
  expect(payload.flags).toBe(MessageFlags.SuppressNotifications);
  expect(f.queued).toHaveBeenCalledWith(
    expect.objectContaining({
      message: f.delivered[0],
      selectedPersonaId: 2,
      isManuallyTriggered: true,
      textQuotaSource: "system",
      conditioningInteraction: { actorType: "persona", type: "reward" },
    }),
  );
  const event = queuedEvent(f.queued, 0);
  expect(event).toContain("Juno");
  expect(event).toContain("Mirri");
  expect(event).toContain("fed");
  expect(event).toContain("sharing snacks");
  expect(event).toContain("a cookie");
  expect(f.queued.mock.calls[0][0].injectedContextItems?.[0].messageId).toBe(f.delivered[0].id);
  expect(event).not.toMatch(/latest embed/i);
  const receiver = f.queued.mock.calls[0][0];
  expect(receiver.manualStreamingContextOverrides?.disableConditioningInteraction).not.toBe(true);
  expect(
    tool.isAvailableForContext("google", {
      ...f.context,
      streamContext: { disableYouTubeProcessing: false, ...receiver.manualStreamingContextOverrides },
    }),
  ).toBe(true);
  expect(tool.isAvailableForContext("google", f.context)).toBe(false);
  expect((await tool.execute({ target: "Mirri", action: "bonk", reason: "being silly" }, f.context)).success).toBe(
    false,
  );
  expect(f.channel.send).toHaveBeenCalledTimes(1);
});

it.each([
  undefined,
  "",
  "   ",
])("delivers a persona gesture with reason %j without saving conditioning", async (reason) => {
  const f = fixture();
  const result = await new ConditioningInteractionTool().execute(
    { target: "Mirri", action: "hug", ...(reason === undefined ? {} : { reason }) },
    f.context,
  );
  expect(result.success).toBe(true);
  expect(result.responseDelivered).toBe(true);
  expect(f.record).not.toHaveBeenCalled();
  const payload = f.channel.send.mock.calls[0][0] as { embeds: EmbedBuilder[] };
  expect(payload.embeds[0].data.description).toBe(
    localizedCopy("en-US", "commands.reward.hug.embed_description", { user: "Juno", bot: "Mirri" }),
  );
  expect(payload.embeds[0].data.footer).toBeUndefined();
  expect(f.queued).toHaveBeenCalledWith(expect.objectContaining({ selectedPersonaId: 2, message: f.delivered[0] }));
  const event = queuedEvent(f.queued, 0);
  expect(event).toContain("Juno");
  expect(event).toContain("Mirri");
  expect(event).not.toContain("undefined");
});

it("posts user interactions without writing conditioning or queueing a response", async () => {
  const f = fixture("user");
  const result = await new ConditioningInteractionTool().execute(
    { target: "Mirri", action: "bonk", reason: "stealing a cookie" },
    f.context,
  );
  expect(result.success).toBe(true);
  expect(f.record).not.toHaveBeenCalled();
  expect(f.queued).not.toHaveBeenCalled();
  const payload = f.channel.send.mock.calls[0][0] as { embeds: EmbedBuilder[] };
  expect(payload.embeds[0].data.description).toBe(
    localizedCopy("en-US", "commands.punish.bonk.embed_description_with_reason", {
      user: "Juno",
      bot: "<@223456789012345678>",
      reason: "stealing a cookie",
    }),
  );
});

it("keeps the invoking persona's committed sprite for main-persona and threaded alter embeds", async () => {
  const { webhook, messages } = webhookFixture();
  for (const isAlter of [false, true]) {
    for (const isIdentity of [false, true]) {
      clearAllChannelDeliveryContinuity();
      clearPersonaAppearances();
      clearPersonaSpriteCache();
      messages.length = 0;
      webhook.send.mockClear();
      const f = fixture("user");
      f.actor.is_alter = isAlter;
      f.channel.isThread = () => isAlter;
      f.channel.lastMessageId = "1400000000000009999";
      f.context.webhook = undefined;
      setPersonaSpriteCache(ACTOR_ID, [spriteRow(isIdentity)]);
      const updater = new StreamUiUpdater({
        hasStopRequest: () => false,
        requestStop: () => true,
        notifyStreamProgress: () => undefined,
      });
      await updater.sendSinglePayload(
        {
          content: "sprite text",
          identityOverride: { username: isIdentity ? "shy (Juno)" : "Juno", avatarUrl: "https://example.com/shy.png" },
          spriteRecord: { personaId: 1, spriteName: "shy", isIdentity: isIdentity },
        },
        "sprite text",
        {
          ...f.context,
          client: f.context.client,
          tomoriState: f.actor,
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

      const result = await new ConditioningInteractionTool().execute(
        { target: "Mirri", action: "kiss", reason: "being kind" },
        f.context,
      );

      expect(result.success).toBe(true);
      expect(f.channel.send).not.toHaveBeenCalled();
      expect(webhook.send).toHaveBeenCalledTimes(1);
      const payload = messages[0] as { username?: string; avatarURL?: string; threadId?: string };
      expect(payload.username).toBe(isIdentity ? "shy (Juno)" : "Juno");
      expect(payload.avatarURL).toBe("https://example.com/shy.png");
      expect(payload.threadId).toBe(isAlter ? CHANNEL : undefined);
      const embed = (messages[0] as { embeds: EmbedBuilder[] }).embeds[0];
      expect(embed.data.description).toBe(
        localizedCopy("en-US", "commands.reward.kiss.embed_description_with_reason", {
          user: "Juno",
          bot: "<@223456789012345678>",
          reason: "being kind",
        }),
      );
      expect(getChannelLastDelivery(CHANNEL)).toMatchObject({
        via: "webhook",
        webhookId: webhook.id,
        speaker: { personaId: ACTOR_ID },
      });
    }
  }
});

it("uses the actor's base identity instead of another persona's last sprite", async () => {
  const f = fixture("user");
  f.context.webhook = { id: "actor-webhook", channelId: CHANNEL } as Webhook;
  f.channel.lastMessageId = "1400000000000000001";
  recordChannelDeliveredWebhookIdentity(
    f.channel.id,
    { username: "Mirri", avatarUrl: "https://example.com/mirri.png" },
    f.channel.lastMessageId,
    { personaId: 2, kind: "appearance" },
    "other-webhook",
  );

  const result = await new ConditioningInteractionTool().execute(
    { target: "Mirri", action: "hug", reason: "being kind" },
    f.context,
  );

  expect(result.success).toBe(true);
  expect(f.channel.send).toHaveBeenCalledTimes(1);
  const payload = f.channel.send.mock.calls[0][0] as { embeds: EmbedBuilder[] };
  expect(payload.embeds[0].data.description).toBe(
    localizedCopy("en-US", "commands.reward.hug.embed_description_with_reason", {
      user: "Juno",
      bot: "<@223456789012345678>",
      reason: "being kind",
    }),
  );
});

it("queues two interactions with their own actors, actions, reasons, and source references", async () => {
  const f = fixture();
  const tool = new ConditioningInteractionTool();

  await tool.execute({ target: "Mirri", action: "hug", reason: "the first kind moment" }, f.context);
  f.context.streamContext = { disableYouTubeProcessing: false };
  await tool.execute({ target: "Mirri", action: "bonk", reason: "the second silly moment" }, f.context);

  expect(f.queued).toHaveBeenCalledTimes(2);
  const first = queuedEvent(f.queued, 0);
  const second = queuedEvent(f.queued, 1);
  expect(first).toContain("hugged");
  expect(first).toContain("the first kind moment");
  expect(first).not.toContain("the second silly moment");
  expect(second).toContain("bonked");
  expect(second).toContain("the second silly moment");
  expect(second).not.toContain("the first kind moment");
  for (const call of [0, 1]) {
    const args = (f.queued.mock.calls[call][0] ?? {}) as unknown as Record<string, unknown>;
    expect(args.selectedPersonaId).toBe(2);
    expect(args.textQuotaSource).toBe("system");
    expect(f.queued.mock.calls[call][0].injectedContextItems?.[0].messageId).toBe(f.delivered[call].id);
  }
});

it("does not queue a reaction or claim delivery when the post fails", async () => {
  const f = fixture();
  f.channel.send.mockRejectedValueOnce(new Error("socket hang up"));

  const result = await new ConditioningInteractionTool().execute(
    { target: "Mirri", action: "bonk", reason: "being silly" },
    f.context,
  );

  expect(result.success).toBe(true);
  expect(result.responseDelivered).toBe(false);
  expect(result.message).toContain("could not be posted");
  expect(f.queued).not.toHaveBeenCalled();
  expect(getChannelLastDelivery(CHANNEL)).toBeNull();
});

it("reports failure without queueing when a user interaction cannot be posted", async () => {
  const f = fixture("user");
  f.channel.send.mockRejectedValueOnce(new Error("socket hang up"));

  const result = await new ConditioningInteractionTool().execute(
    { target: "Mirri", action: "bonk", reason: "being silly" },
    f.context,
  );

  expect(result.success).toBe(false);
  expect(f.queued).not.toHaveBeenCalled();
});

it("keeps a completed conditioning write when delivery is cancelled afterwards", async () => {
  const f = fixture();
  f.record.mockImplementation(async () => {
    f.context.isExecutionCancelled = () => true;
    return {
      server_id: f.actor.server_id,
      persona_lineage_id: 102,
      conditioning_type: "reward",
      action_key: "bonk",
      reason_text: "being silly",
      reason_normalized: "being silly",
      user_id: null,
      actor_persona_id: ACTOR_ID,
      count: 1,
    };
  });

  const result = await new ConditioningInteractionTool().execute(
    { target: "Mirri", action: "bonk", reason: "being silly" },
    f.context,
  );

  expect(result.success).toBe(true);
  expect(f.channel.send).not.toHaveBeenCalled();
  expect(f.queued).not.toHaveBeenCalled();
});

it("rejects missing feed food and oversized input before any side effects", async () => {
  const f = fixture();
  const tool = new ConditioningInteractionTool();
  for (const args of [
    { target: "Mirri", action: "feed", reason: "sharing" },
    { target: "Mirri", action: "hug", reason: "x".repeat(251) },
    { target: "Mirri", action: "feed", reason: "sharing", food: "x".repeat(251) },
  ])
    expect((await tool.execute(args, f.context)).success).toBe(false);
  expect(f.record).not.toHaveBeenCalled();
  expect(f.channel.send).not.toHaveBeenCalled();
  expect(f.queued).not.toHaveBeenCalled();
});

it("checks cancellation and failed saves before posting or queueing", async () => {
  const f = fixture();
  const tool = new ConditioningInteractionTool();
  const args = { target: "Mirri", action: "bonk", reason: "being silly" };
  f.context.isExecutionCancelled = () => true;
  expect((await tool.execute(args, f.context)).success).toBe(false);
  expect(f.record).not.toHaveBeenCalled();
  f.context.isExecutionCancelled = () => false;
  f.record.mockResolvedValue(null);
  expect((await tool.execute(args, f.context)).success).toBe(false);
  expect(f.channel.send).not.toHaveBeenCalled();
  expect(f.queued).not.toHaveBeenCalled();
});

it("refuses inaccessible and ambiguous targets before saving, posting, or queueing", async () => {
  const f = fixture();
  f.whitelistSpy.mockResolvedValue({ ...f.whitelist, isTriggerAllowed: false });
  const tool = new ConditioningInteractionTool();
  expect((await tool.execute({ target: "Mirri", action: "bonk", reason: "being silly" }, f.context)).success).toBe(
    false,
  );
  track(
    spyOn(targetResolver, "resolveIdentityTarget").mockResolvedValue({
      status: "ambiguous",
      input: "Mirri",
      candidates: [],
    }),
  );
  expect((await tool.execute({ target: "Mirri", action: "bonk", reason: "being silly" }, f.context)).success).toBe(
    false,
  );
  expect(f.record).not.toHaveBeenCalled();
  expect(f.channel.send).not.toHaveBeenCalled();
  expect(f.queued).not.toHaveBeenCalled();
});

it("omits the disabled tool and permits it autonomously when enabled, independently of stickers", () => {
  const f = fixture();
  const tool = new ConditioningInteractionTool();
  f.context.tomoriState.config.conditioning_interactions_enabled = false;
  expect(isBuiltInToolAvailable(tool, "google", f.context)).toBe(false);
  expect(getAutonomousDeliberateToolNames(f.context.tomoriState)).not.toContain(tool.name);
  f.context.tomoriState.config.conditioning_interactions_enabled = true;
  f.context.tomoriState.config.sticker_usage_enabled = false;
  expect(isBuiltInToolAvailable(tool, "google", f.context)).toBe(true);
  expect(getAutonomousDeliberateToolNames(f.context.tomoriState)).toContain(tool.name);
});

it("keeps the queued interaction source and its continuation together through successful-call replay", async () => {
  const f = fixture();
  const tool = new ConditioningInteractionTool();
  let deliveredOutcome: ToolResult | undefined;
  const execute = track(
    spyOn(ToolRegistry, "executeTool").mockImplementation(async (_name, args, context) => {
      deliveredOutcome = await tool.execute(args, context);
      return deliveredOutcome;
    }),
  );
  const context = {
    ...f.context,
    currentPersona: f.actor,
    tomoriState: f.actor,
    guild: { id: "guild" },
    message: { id: "source", channelId: CHANNEL, channel: f.context.channel },
    streamingContext: f.context.streamContext,
    expressionDelivery: createExpressionDeliveryState(),
    contextItems: [],
    emojiStrings: [],
    messageIdMap: new Map(),
    deliberateToolTriggerMatchByToolName: new Map(),
    shouldSurfaceUserErrors: false,
    isDMChannel: false,
    turn: { lockedTurn: { channelId: CHANNEL, admission: { incoming: { retryCount: 0 } } } },
  } as unknown as ChatTurnContext;
  const args = { target: "Mirri", action: "feed", reason: "sharing snacks", food: "a cookie" };
  const results: StreamResult[] = [{ status: "function_call", data: { name: tool.name, args } }, { status: "error" }];
  const histories: ToolHistoryEntry[][] = [];
  const stream: LLMProvider["streamToDiscord"] = async (...params) => {
    histories.push([...(params[7] ?? [])]);
    const result = results.shift();
    if (!result) throw new Error("Missing stream result");
    return result;
  };
  const provider = { getInfo: () => ({ name: "google" }), streamToDiscord: stream } as unknown as LLMProvider;
  const params = {
    context,
    provider,
    providerConfig: { model: "fixture", apiKey: "fixture", temperature: 0.7 },
    tomoriState: f.actor,
  };
  await runToolLoop(params);
  expect(deliveredOutcome?.success).toBe(true);
  const event = queuedEvent(f.queued, 0);
  const original = f.delivered[0];
  expect(f.queued.mock.calls[0][0].injectedContextItems?.[0].messageId).toBe(original.id);
  expect(event).toContain(f.actor.persona_nickname);
  expect(event).toContain(f.target.persona_nickname);
  expect(event).toContain(args.reason);
  await f.channel.send({ content: "later unrelated embed" });
  results.push({ status: "function_call", data: { name: tool.name, args } }, { status: "completed" });
  await runToolLoop(params);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(f.queued).toHaveBeenCalledTimes(1);
  expect(queuedEvent(f.queued, 0)).toBe(event);
  const replay = histories.at(-1)?.[0]?.functionResponse as {
    functionResponse: { response: { result: unknown; message?: string } };
  };
  expect(replay.functionResponse.response).toEqual({
    result: deliveredOutcome?.data,
    message: deliveredOutcome?.message,
  });
  expect(replay.functionResponse.response.result).toMatchObject({
    message_id: original.id,
    action: args.action,
    target: f.target.persona_nickname,
  });
});
