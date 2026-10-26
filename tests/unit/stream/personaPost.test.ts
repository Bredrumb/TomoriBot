import * as personaIdentity from "@/utils/discord/webhook/identity";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Client, Message, TextChannel, Webhook, WebhookMessageCreateOptions } from "discord.js";
import { REST, ChannelType } from "discord.js";
import type { PersonaSpriteRow } from "@/types/db/schema";
import type { StreamContext } from "@/types/stream/interfaces";
import { createDefaultStreamState } from "@/types/stream/types";
import {
  clearPersonaAppearances,
  getPersonaAppearance,
  getPersonaAppearanceCacheSize,
} from "@/utils/cache/personaAppearanceCacheStore";
import {
  clearPersonaSpriteCache,
  invalidatePersonaSpriteCache,
  setPersonaSpriteCache,
} from "@/utils/cache/personaSpriteCacheStore";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import { clearTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { personaSpriteMessageRepository } from "@/utils/db/repositories/PersonaSpriteMessageRepository";
import {
  clearAllChannelDeliveryContinuity,
  getChannelLastDelivery,
} from "@/utils/discord/stream/channelDeliveryContinuity";
import { StreamUiUpdater } from "@/utils/discord/stream/uiUpdater";
import {
  recordPersonaDelivery,
  resolvePersonaPostAuthor,
  sendPersonaPost,
  type PersonaPostContext,
} from "@/utils/discord/webhook/personaPost";
import * as lifecycle from "@/utils/discord/webhook/lifecycle";
import { GENERIC_WEBHOOK_AVATAR_URL } from "@/utils/discord/webhook/identity";
import { classifyDiscordDeliveryFailure } from "@/utils/discord/webhook/deliveryOutcome";
import { clearEmergencyCaches } from "@/utils/cache/emergencyCacheClearer";
import { createPersona } from "../../helpers/fixtures";

const CHANNEL = "1400000000000000000";
const BASE = "https://example.com/base.png";
const SPRITE = "https://example.com/joy.png";

function fixture(isAlter = false, isIdentity = false, channelId = CHANNEL) {
  const persona = createPersona({
    persona_id: 7,
    persona_nickname: "Juno",
    is_alter: isAlter,
    webhook_avatar_url: BASE,
  });
  const sprite: PersonaSpriteRow = {
    sprite_id: 3,
    persona_id: 7,
    sprite_name: "joy",
    sprite_key: "joy",
    avatar_url: SPRITE,
    usage_instructions: "",
    is_identity: isIdentity,
  };
  setPersonaSpriteCache(7, [sprite]);
  let serial = BigInt(CHANNEL);
  const author = { username: "Bot", displayAvatarURL: () => BASE };
  const channel = {
    id: channelId,
    guildId: "guild",
    lastMessageId: null as string | null,
    isThread: () => false,
    fetchWebhooks: mock(),
    createWebhook: mock(),
    client: { user: author, rest: new REST() },
    send: mock(async (_payload: unknown) => message(null)),
  };
  function message(webhookId: string | null, channelId = channel.id): Message {
    const id = String(++serial);
    channel.lastMessageId = id;
    return { id, channelId, webhookId, author } as unknown as Message;
  }
  const webhook = {
    id: "1400000000000000002",
    channelId,
    guildId: "guild",
    token: "fixture",
    client: channel.client,
    send: mock(async (payload: WebhookMessageCreateOptions) => message(webhook.id, payload.threadId)),
  };
  spyOn(lifecycle, "getOrCreateWebhook").mockResolvedValue({ webhook: webhook as unknown as Webhook });
  const context: PersonaPostContext = {
    channel: channel as unknown as TextChannel,
    persona,
    deliveryMode: "persona",
    deliveryReceipts: [],
  };
  const streamContext: StreamContext = {
    channel: context.channel,
    client: channel.client as unknown as Client,
    tomoriState: persona,
    contextItems: [],
    currentTurnModelParts: [],
    locale: "en-US",
    provider: "fixture",
    deliveryMode: "persona",
    webhook: webhook as unknown as Webhook,
    personaUsername: "Juno",
    personaAvatarUrl: BASE,
    deliveryReceipts: context.deliveryReceipts,
  };
  const updater = new StreamUiUpdater({
    hasStopRequest: () => false,
    requestStop: () => true,
    notifyStreamProgress: () => undefined,
  });
  const state = createDefaultStreamState();
  const deliverSprite = () =>
    updater.sendSinglePayload(
      {
        content: "sprite",
        identityOverride: { username: isIdentity ? "joy (Juno)" : "Juno", avatarUrl: SPRITE },
        spriteRecord: { personaId: 7, spriteName: "joy", isIdentity },
      },
      "sprite",
      streamContext,
      state,
    );
  return { context, streamContext, channel, webhook, updater, state, deliverSprite, sprite };
}

beforeEach(() => {
  clearAllChannelDeliveryContinuity();
  clearPersonaSpriteCache();
  spyOn(personaSpriteMessageRepository, "record").mockResolvedValue(true);
});
afterEach(() => {
  mock.restore();
  clearPersonaSpriteCache();
  clearAllChannelDeliveryContinuity();
});

describe("committed persona appearance", () => {
  it("keeps main and alter sprites across user, bot, and other-persona messages", async () => {
    for (const isAlter of [false, true]) {
      for (const isIdentity of [false, true]) {
        for (const intervening of ["user", "bot", "persona"] as const) {
          clearAllChannelDeliveryContinuity();
          clearPersonaAppearances();
          const f = fixture(isAlter, isIdentity);
          await f.deliverSprite();
          f.channel.lastMessageId = "1500000000000000000";
          if (intervening !== "user")
            recordPersonaDelivery({
              messageId: f.channel.lastMessageId,
              channelId: CHANNEL,
              route: intervening === "bot" ? "bot" : "webhook",
              webhookId: intervening === "bot" ? null : "1400000000000000003",
              identity: { username: "Mirri" },
              speaker: intervening === "bot" ? null : { personaId: 8, kind: "appearance" },
            });
          const result = await sendPersonaPost(f.context, { content: "artifact" });
          expect(result.status).toBe("sent");
          if (result.status !== "sent") throw new Error("Missing delivery");
          expect(result.receipt).toMatchObject({
            channelId: CHANNEL,
            route: "webhook",
            webhookId: f.webhook.id,
            identity: { username: isIdentity ? "joy (Juno)" : "Juno", avatarUrl: SPRITE },
            speaker: { personaId: 7, kind: isIdentity ? "identity_sprite" : "appearance" },
            sprite: { personaId: 7, spriteName: "joy", isIdentity },
          });
          expect(f.channel.send).not.toHaveBeenCalled();
          expect(f.webhook.send.mock.calls.at(-1)?.[0].avatarURL).toBe(SPRITE);
          expect(getPersonaAppearance(CHANNEL, 7)?.sprite?.spriteName).toBe("joy");
        }
      }
    }
  });

  it("uses the current base with no remembered appearance and ignores a main persona's webhook hint", async () => {
    for (const isAlter of [false, true]) {
      clearPersonaAppearances();
      const f = fixture(isAlter);
      if (!isAlter) f.context.webhook = { id: "foreign", channelId: "elsewhere" } as Webhook;
      const author = await resolvePersonaPostAuthor(f.context);
      expect(author.route).toBe(isAlter ? "webhook" : "bot");
      expect(author.identity).toMatchObject({ username: "Juno", avatarUrl: BASE });
      expect(author.sprite).toBeUndefined();
      const result = await sendPersonaPost(f.context, { content: "base" });
      expect(result.status).toBe("sent");
      expect(getPersonaAppearance(CHANNEL, 7)?.sprite).toBeUndefined();
    }
  });

  it("replaces each persona's sprite only after a delivered explicit base revert", async () => {
    for (const isAlter of [false, true]) {
      for (const isIdentity of [false, true]) {
        clearPersonaAppearances();
        const f = fixture(isAlter, isIdentity);
        await f.deliverSprite();
        if (!isAlter) {
          f.streamContext.webhook = undefined;
          f.streamContext.personaUsername = undefined;
        }
        await f.updater.sendSinglePayload({ content: "base" }, "base", f.streamContext, f.state);
        const author = await resolvePersonaPostAuthor(f.context);
        expect(author.sprite).toBeUndefined();
        expect(author.identity.avatarUrl).toBe(BASE);
        expect(author.route).toBe(isAlter ? "webhook" : "bot");
        expect(getChannelLastDelivery(CHANNEL)?.via).toBe(isAlter ? "webhook" : "bot");
      }
    }
  });

  it("excludes copied identities and explicit user impersonation from remembered appearance", async () => {
    for (const deliveryMode of ["persona", "user_impersonation"] as const) {
      const f = fixture(false, true);
      await f.deliverSprite();
      f.streamContext.deliveryMode = deliveryMode;
      await f.updater.sendSinglePayload(
        {
          content: "copied",
          identityOverride: { username: "Mirri (Juno)", avatarUrl: "https://example.com/mirri.png" },
        },
        "copied",
        f.streamContext,
        f.state,
      );
      expect(getChannelLastDelivery(CHANNEL)?.speaker?.kind).toBe("copied");
      expect((await resolvePersonaPostAuthor(f.context)).identity).toMatchObject({
        username: "joy (Juno)",
        avatarUrl: SPRITE,
      });
      expect(getPersonaAppearance(CHANNEL, 7)?.sprite?.isIdentity).toBe(true);
    }
  });

  it("publishes no appearance or receipt for held, cancelled, refused, or uncertain sends", async () => {
    for (const failure of ["held", "cancelled", "refused", "uncertain"] as const) {
      clearPersonaAppearances();
      clearAllChannelDeliveryContinuity();
      const f = fixture(true);
      if (failure === "held") f.context.holdResponseText = true;
      if (failure === "cancelled") f.context.isExecutionCancelled = () => true;
      if (failure === "refused")
        f.webhook.send.mockRejectedValue(Object.assign(new Error(), { status: 403, code: 50013 }));
      if (failure === "uncertain") f.webhook.send.mockRejectedValue(Object.assign(new Error(), { name: "AbortError" }));
      const result = await sendPersonaPost(f.context, { content: "pending" });
      expect(result.status).toBe(
        failure === "uncertain" ? "unconfirmed" : failure === "refused" ? "definite_refusal" : "pre_dispatch",
      );
      expect(f.webhook.send.mock.calls.length).toBe(failure === "held" || failure === "cancelled" ? 0 : 1);
      expect(f.channel.send).not.toHaveBeenCalled();
      expect(f.context.deliveryReceipts).toEqual([]);
      expect(getPersonaAppearance(CHANNEL, 7)).toBeUndefined();
      expect(getChannelLastDelivery(CHANNEL)).toBeNull();
    }
  });

  it("checks cancellation after asynchronous resolution immediately before POST", async () => {
    const f = fixture(true);
    let cancelled = false;
    spyOn(lifecycle, "getOrCreateWebhook").mockImplementation(async () => {
      cancelled = true;
      return { webhook: f.webhook as unknown as Webhook };
    });
    f.context.isExecutionCancelled = () => cancelled;
    expect((await sendPersonaPost(f.context, { content: "pending" })).status).toBe("pre_dispatch");
    expect(f.webhook.send).not.toHaveBeenCalled();
    expect(getPersonaAppearance(CHANNEL, 7)).toBeUndefined();
  });

  it("invalidates sprite and persona appearance without reviving stale adjacency", async () => {
    for (const invalidate of [
      () => invalidatePersonaSpriteCache(7),
      () => invalidateTomoriStateCache("guild"),
      clearPersonaSpriteCache,
      clearTomoriStateCache,
    ]) {
      const f = fixture(true);
      await f.deliverSprite();
      invalidate();
      expect(getPersonaAppearance(CHANNEL, 7)).toBeUndefined();
      expect((await resolvePersonaPostAuthor(f.context)).identity.avatarUrl).toBe(BASE);
    }
  });

  it("clears committed appearance through emergency cache clearing", async () => {
    const f = fixture(true);
    await f.deliverSprite();
    expect(getPersonaAppearance(CHANNEL, 7)?.sprite?.spriteName).toBe("joy");
    clearEmergencyCaches({ source: "fixture", clearDiscordVolatileCaches: false });
    expect(getPersonaAppearance(CHANNEL, 7)).toBeUndefined();
    expect((await resolvePersonaPostAuthor(f.context)).identity.avatarUrl).toBe(BASE);
  });

  it("requires explicit impersonation identity and destination binding without replacing own appearance", async () => {
    const f = fixture(false, true);
    await f.deliverSprite();
    f.context.deliveryMode = "user_impersonation";
    expect((await sendPersonaPost(f.context, { content: "copied" })).status).toBe("pre_dispatch");
    f.context.webhook = f.webhook as unknown as Webhook;
    f.context.impersonatedIdentity = { username: "Mirri", avatarUrl: "https://example.com/mirri.png" };
    const result = await sendPersonaPost(f.context, { content: "copied" });
    expect(result.status).toBe("sent");
    if (result.status !== "sent") throw new Error("Missing impersonation delivery");
    expect(result.receipt.identity).toEqual(f.context.impersonatedIdentity);
    expect(result.receipt.speaker?.kind).toBe("copied");
    expect(getPersonaAppearance(CHANNEL, 7)?.sprite?.isIdentity).toBe(true);
    f.context.webhook = { ...f.webhook, channelId: "elsewhere" } as unknown as Webhook;
    expect((await sendPersonaPost(f.context, { content: "copied" })).status).toBe("pre_dispatch");
  });

  it("keeps the committed sprite after a failed base revert and marks bot fallback authorship accurately", async () => {
    const f = fixture(true);
    await f.deliverSprite();
    f.webhook.send.mockRejectedValue(Object.assign(new Error(), { code: 50013, status: 403 }));
    await expect(f.updater.sendSinglePayload({ content: "base" }, "base", f.streamContext, f.state)).rejects.toThrow();
    expect(getPersonaAppearance(CHANNEL, 7)?.sprite?.spriteName).toBe("joy");
    f.state.hasRepliedToOriginalMessage = false;
    await f.updater.sendSinglePayload({ content: "base" }, "base", f.streamContext, f.state);
    expect(f.streamContext.deliveryReceipts?.at(-1)).toMatchObject({
      route: "bot",
      webhookId: null,
      speaker: { personaId: null },
      identity: { username: "Bot" },
    });
    expect(getChannelLastDelivery(CHANNEL)).toMatchObject({ via: "bot", speaker: { personaId: null } });
    expect(getPersonaAppearance(CHANNEL, 7)?.sprite?.spriteName).toBe("joy");
  });

  it("resolves remembered sprite references against fresh sprite data after adjacency ends", async () => {
    const f = fixture(true);
    await f.deliverSprite();
    f.channel.lastMessageId = "1500000000000000000";
    setPersonaSpriteCache(7, [{ ...f.sprite, avatar_url: "https://example.com/fresh.png" }]);
    expect((await resolvePersonaPostAuthor(f.context)).identity.avatarUrl).toBe("https://example.com/fresh.png");
    setPersonaSpriteCache(7, []);
    expect((await resolvePersonaPostAuthor(f.context)).identity.avatarUrl).toBe(BASE);
  });

  it("keeps thread appearance separate from its parent and sibling destinations", async () => {
    const f = fixture(true);
    await f.deliverSprite();
    const sibling = fixture(true, false, "1400000000000000009");
    expect((await resolvePersonaPostAuthor(sibling.context)).identity.avatarUrl).toBe(BASE);
    const parent = f.channel;
    const thread = { ...parent, id: "1400000000000000010", parent, parentId: parent.id, isThread: () => true };
    f.context.channel = thread as unknown as TextChannel;
    spyOn(lifecycle, "getOrCreateWebhook").mockResolvedValue({ webhook: f.webhook as unknown as Webhook });
    const result = await sendPersonaPost(f.context, { content: "thread" });
    expect(result.status).toBe("sent");
    if (result.status !== "sent") throw new Error("Missing thread delivery");
    expect(result.receipt.channelId).toBe(thread.id);
    expect(f.webhook.send.mock.calls.at(-1)?.[0].threadId).toBe(thread.id);
    expect(getPersonaAppearance(parent.id, 7)?.sprite?.spriteName).toBe("joy");
    expect(getPersonaAppearance(thread.id, 7)?.sprite).toBeUndefined();
  });

  it("retains the delivered generic avatar and identity-sprite kind across intervening messages", async () => {
    const f = fixture(true, true);
    recordPersonaDelivery({
      messageId: "1400000000000000004",
      channelId: CHANNEL,
      route: "webhook",
      webhookId: f.webhook.id,
      identity: { username: "joy (Juno)", avatarUrl: GENERIC_WEBHOOK_AVATAR_URL },
      speaker: { personaId: 7, kind: "identity_sprite" },
      sprite: { personaId: 7, spriteName: "joy", isIdentity: true },
    });
    f.channel.lastMessageId = "1500000000000000000";
    const result = await sendPersonaPost(f.context, { content: "artifact" });
    expect(result.status).toBe("sent");
    if (result.status !== "sent") throw new Error("Missing delivery");
    expect(result.receipt.identity).toEqual({ username: "joy (Juno)", avatarUrl: GENERIC_WEBHOOK_AVATAR_URL });
    expect(result.receipt.speaker?.kind).toBe("identity_sprite");
    expect(result.receipt.webhookId).toBe(f.webhook.id);
  });

  it("bounds memory across destinations and expires old committed appearances", () => {
    const clock = spyOn(Date, "now").mockReturnValue(1000);
    for (let index = 0; index < 2001; index++)
      recordPersonaDelivery({
        messageId: String(index),
        channelId: String(index),
        route: "bot",
        webhookId: null,
        identity: {},
        speaker: { personaId: 7, kind: "appearance" },
      });
    expect(getPersonaAppearanceCacheSize()).toBeLessThanOrEqual(2000);
    expect(getPersonaAppearance("0", 7)).toBeUndefined();
    expect(getPersonaAppearance("2000", 7)).toBeDefined();
    clock.mockReturnValue(1000 + 120 * 60 * 1000);
    expect(getPersonaAppearance("2000", 7)).toBeUndefined();
  });

  it("keeps main and alter mentions on their own committed appearance", async () => {
    const { sendPersonaMention } = await import("@/utils/discord/mentionHelper");
    spyOn(personaIdentity, "resolvePersonaWebhookIdentity").mockResolvedValue({ username: "Juno", avatarUrl: BASE });
    for (const isAlter of [false, true]) {
      const f = fixture(isAlter);
      await f.deliverSprite();
      Object.assign(f.channel, {
        guild: { id: "guild", members: { me: { displayAvatarURL: () => BASE } } },
        type: ChannelType.GuildText,
      });
      f.channel.lastMessageId = "1500000000000000000";
      expect(
        await sendPersonaMention(
          f.context.channel as TextChannel,
          f.context.persona,
          "123456789012345678",
          "<@123456789012345678>",
        ),
      ).toBe(true);
      expect(f.webhook.send.mock.calls.at(-1)?.[0]).toMatchObject({
        username: "Juno",
        avatarURL: SPRITE,
        allowedMentions: { users: ["123456789012345678"], parse: [] },
      });
      expect(getPersonaAppearance(CHANNEL, 7)?.sprite?.spriteName).toBe("joy");
    }
  });

  it("recovers one proven invalid webhook refusal and stops if its replacement is uncertain", async () => {
    for (const uncertain of [false, true]) {
      clearPersonaAppearances();
      clearAllChannelDeliveryContinuity();
      const f = fixture(true);
      f.context.deliveryState = { unconfirmed: false };
      f.webhook.send.mockRejectedValueOnce(Object.assign(new Error(), { code: 10015, status: 404 }));
      if (uncertain) f.webhook.send.mockRejectedValueOnce(Object.assign(new Error(), { name: "AbortError" }));
      const result = await sendPersonaPost(f.context, { content: "bounded recovery" });
      expect(result.status).toBe(uncertain ? "unconfirmed" : "sent");
      expect(f.webhook.send).toHaveBeenCalledTimes(2);
      expect(f.channel.send).not.toHaveBeenCalled();
      expect(f.context.deliveryReceipts).toHaveLength(uncertain ? 0 : 1);
      expect(f.context.deliveryState.unconfirmed).toBe(uncertain);
      if (uncertain) {
        expect((await sendPersonaPost(f.context, { content: "later artifact" })).status).toBe("pre_dispatch");
        expect(f.webhook.send).toHaveBeenCalledTimes(2);
        expect(getPersonaAppearance(CHANNEL, 7)).toBeUndefined();
      }
    }
  });

  it("preserves the own sprite for a fallback notice after another persona and after bot fallback", async () => {
    const { sendFallbackModelUsageNotice } = await import("@/utils/discord/fallbackModelNotice");
    for (const via of ["bot", "webhook"] as const) {
      const f = fixture(true, true);
      await f.deliverSprite();
      recordPersonaDelivery({
        messageId: "1500000000000000000",
        channelId: CHANNEL,
        route: via,
        webhookId: via === "webhook" ? "other" : null,
        identity: { username: "Mirri" },
        speaker: { personaId: via === "webhook" ? 8 : null, kind: "appearance" },
      });
      f.channel.lastMessageId = "1500000000000000000";
      const on = mock();
      const send = f.webhook.send.getMockImplementation();
      if (!send) throw new Error("Missing sender");
      f.webhook.send.mockImplementation(async (payload) =>
        Object.assign(await send(payload), { createMessageComponentCollector: () => ({ on }) }),
      );
      await sendFallbackModelUsageNotice({
        context: {
          client: f.streamContext.client,
          provider: "fixture",
          channel: f.context.channel,
          tomoriState: f.context.persona,
          locale: "en-US",
          streamContext: { disableYouTubeProcessing: false, deliveryReceipts: f.context.deliveryReceipts },
        },
        failures: [],
        successModel: f.context.persona.llm,
      });
      expect(f.webhook.send.mock.calls.at(-1)?.[0]).toMatchObject({ username: "joy (Juno)", avatarURL: SPRITE });
      expect(f.context.deliveryReceipts?.at(-1)).toMatchObject({
        route: "webhook",
        speaker: { personaId: 7, kind: "identity_sprite" },
      });
    }
  });

  it("does not retry or use a bot fallback after an unconfirmed streaming POST", async () => {
    const f = fixture(true);
    f.webhook.send.mockRejectedValue(Object.assign(new Error(), { name: "AbortError" }));
    let error: unknown;
    try {
      await f.updater.sendSinglePayload({ content: "pending" }, "pending", f.streamContext, f.state);
    } catch (caught) {
      error = caught;
    }
    expect(classifyDiscordDeliveryFailure(error)).toBe("unconfirmed");
    expect(f.webhook.send).toHaveBeenCalledTimes(1);
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.streamContext.deliveryReceipts).toEqual([]);
    expect(getPersonaAppearance(CHANNEL, 7)).toBeUndefined();
  });
});
