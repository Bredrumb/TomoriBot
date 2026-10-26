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
import * as webhookDispatch from "@/utils/discord/webhook/personaDispatch";
import * as webhookFallback from "@/utils/discord/webhook/fallback";
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
});
function track<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy);
  return spy;
}

function fixture(targetType: "persona" | "user" = "persona") {
  const actor = createPersona({
    persona_id: 1,
    persona_nickname: "Juno",
    config: { conditioning_interactions_enabled: true },
  });
  const target = createPersona({ persona_id: 2, persona_lineage_id: 102, persona_nickname: "Mirri", is_alter: true });
  const invoker = {
    id: "123456789012345678",
    user: { username: "Bau", bot: false },
    roles: { cache: new Collection() },
  };
  const guild = { id: "guild", members: { me: { id: "bot" }, fetch: async () => invoker } };
  const channel = {
    id: "channel",
    lastMessageId: null as string | null,
    guild,
    isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: mock(async (_payload: unknown) => message),
  };
  const message = { id: "1400000000000000002", channel, author: { id: "bot", bot: true } };
  const context = {
    client: {},
    channel,
    guildId: guild.id,
    tomoriState: actor,
    activePersonaId: 1,
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
  return { context, actor, target, channel, message, record, queued, whitelistSpy, whitelist };
}

it("saves persona-attributed feedback and queues the target with interaction recursion disabled", async () => {
  const f = fixture();
  const tool = new ConditioningInteractionTool();
  const result = await tool.execute(
    { target: "Mirri", action: "feed", reason: "sharing snacks", food: "a cookie" },
    f.context,
  );
  expect(result.success).toBe(true);
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
      message: f.message,
      selectedPersonaId: 2,
      isManuallyTriggered: true,
      manualStreamingContextOverrides: { disableConditioningInteraction: true },
    }),
  );
  expect(tool.isAvailableForContext("google", f.context)).toBe(false);
  expect((await tool.execute({ target: "Mirri", action: "bonk", reason: "being silly" }, f.context)).success).toBe(
    false,
  );
  expect(f.channel.send).toHaveBeenCalledTimes(1);
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

it("keeps the invoking persona's latest sprite identity for main-persona and threaded alter embeds", async () => {
  const f = fixture("user");
  const sprite = { username: "Juno (shy)", avatarUrl: "https://example.com/shy.png" };
  const webhook = { id: "sprite-webhook" } as Webhook;
  const resolveWebhook = track(spyOn(webhookFallback, "resolveAuthoringWebhook").mockResolvedValue(webhook));
  const sendWebhook = track(
    spyOn(webhookDispatch, "sendWebhookMessageWithIdentityDelivery").mockImplementation(
      async (_webhook, _payload, identity) => ({
        result: f.message as unknown as Message,
        identity: identity ?? {},
        webhookId: webhook.id,
        webhook,
      }),
    ),
  );

  for (const isAlter of [false, true]) {
    clearAllChannelDeliveryContinuity();
    f.actor.is_alter = isAlter;
    f.channel.isThread = () => isAlter;
    f.channel.lastMessageId = "1400000000000000001";
    f.context.webhook = isAlter ? ({ id: "base-webhook" } as Webhook) : undefined;
    f.context.personaUsername = isAlter ? "Juno" : undefined;
    f.context.streamContext = { disableYouTubeProcessing: false };
    recordChannelDeliveredWebhookIdentity(
      f.channel.id,
      sprite,
      f.channel.lastMessageId,
      { personaId: 1, kind: "appearance" },
      webhook.id,
    );

    const result = await new ConditioningInteractionTool().execute(
      { target: "Mirri", action: "kiss", reason: "being kind" },
      f.context,
    );

    expect(result.success).toBe(true);
    expect(resolveWebhook).toHaveBeenLastCalledWith(f.context.channel, webhook.id, f.context.webhook);
    expect(sendWebhook).toHaveBeenLastCalledWith(
      webhook,
      expect.objectContaining({
        embeds: expect.any(Array),
        flags: MessageFlags.SuppressNotifications,
        ...(isAlter ? { threadId: f.channel.id } : {}),
      }),
      sprite,
    );
    expect(getChannelLastDelivery(f.channel.id)).toMatchObject({
      via: "webhook",
      identity: sprite,
      speaker: { personaId: 1 },
    });
  }
  expect(f.channel.send).not.toHaveBeenCalled();
});

it("uses the actor's base identity instead of another persona's last sprite", async () => {
  const f = fixture("user");
  const webhook = { id: "base-webhook" } as Webhook;
  f.context.webhook = webhook;
  f.context.personaUsername = "Juno";
  f.context.personaAvatarUrl = "https://example.com/juno.png";
  f.channel.lastMessageId = "1400000000000000001";
  recordChannelDeliveredWebhookIdentity(
    f.channel.id,
    { username: "Mirri", avatarUrl: "https://example.com/mirri.png" },
    f.channel.lastMessageId,
    { personaId: 2, kind: "appearance" },
    "other-webhook",
  );
  const sendWebhook = track(
    spyOn(webhookDispatch, "sendWebhookMessageWithIdentityDelivery").mockImplementation(
      async (_webhook, _payload, identity) => ({
        result: f.message as unknown as Message,
        identity: identity ?? {},
        webhookId: webhook.id,
        webhook,
      }),
    ),
  );

  expect(
    (
      await new ConditioningInteractionTool().execute(
        { target: "Mirri", action: "hug", reason: "being kind" },
        f.context,
      )
    ).success,
  ).toBe(true);
  expect(sendWebhook.mock.calls[0][2]).toMatchObject({ username: "Juno", avatarUrl: f.context.personaAvatarUrl });
  expect(f.channel.send).not.toHaveBeenCalled();
});

it("rejects missing feed food, blank reasons, and oversized input before any side effects", async () => {
  const f = fixture();
  const tool = new ConditioningInteractionTool();
  for (const args of [
    { target: "Mirri", action: "feed", reason: "sharing" },
    { target: "Mirri", action: "hug", reason: "  " },
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
