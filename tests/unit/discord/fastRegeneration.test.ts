import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import {
  ActionRowBuilder,
  ButtonStyle,
  Client,
  Collection,
  ComponentType,
  Message,
  MessageFlags,
  MessageFlagsBitField,
  REST,
  type MessageCreateOptions,
  type MessageEditOptions,
  type ModalBuilder,
  type Webhook,
} from "discord.js";
import * as chatHandler from "@/events/messageCreate/tomoriChat";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";
import * as userCache from "@/utils/cache/userCache";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import { channelLocks, getOrCreateChannelLockEntry, runWithChannelLock } from "@/utils/chat/channelQueue";
import type { ChatTurn, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import {
  clearReplyControls,
  observeReplyControlDeletions,
  observeReplyControlMessage,
  offerFastRegeneration,
  prepareFastRegeneration,
  resolveFastRegeneration,
} from "@/utils/discord/fastRegeneration";
import type { GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { dispatchGlobalInteraction } from "@/utils/discord/interactions/router";
import * as authoringWebhook from "@/utils/discord/webhook/fallback";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { localizedCopy, localizedProse } from "../../helpers/localeCases";
import { collectTextDisplays } from "../../helpers/panelLimits";
import { createRouteInteraction } from "../../helpers/routeInteraction";

beforeAll(initializeLocalizer);

const USER = "100000000000000001";
const BOT = "100000000000000002";
const CHANNEL = "200000000000000001";
const GUILD = "300000000000000001";
const WEBHOOK = "500000000000000001";
const fallbackNotice = {
  slot: 1,
  successModelCodename: "fallback-model",
  failures: [{ modelCodename: "primary-model", errorDetail: "rate_limit (429)" }],
  offerPersonalFallbackOptOut: false,
};

function message(id: string, authorId = BOT, webhookId: string | null = null) {
  const message = {
    id,
    guildId: GUILD,
    channelId: CHANNEL,
    author: { id: authorId, bot: authorId === BOT },
    content: "Hello",
    embeds: [],
    flags: new MessageFlagsBitField(),
    attachments: new Collection(),
    webhookId,
    components: [] as NonNullable<MessageEditOptions["components"]>,
    createdTimestamp: Date.now(),
    delete: mock(async () => {}),
  };
  function applyComponents({ components = [] }: MessageEditOptions) {
    message.components = components.map((component) => {
      if (!(component instanceof ActionRowBuilder)) return component;
      return {
        type: ComponentType.ActionRow,
        components: component.toJSON().components.map((button) => ({
          ...button,
          customId: "custom_id" in button ? button.custom_id : undefined,
        })),
      } as NonNullable<MessageEditOptions["components"]>[number];
    });
    return message;
  }

  return Object.assign(message, {
    applyComponents,
    edit: mock(async (options: MessageEditOptions) => applyComponents(options)),
  });
}

const persona = createPersona({
  config: { fast_regeneration_retry_enabled: true, fast_regeneration_continue_enabled: true },
});

function setupTurn({
  webhookId = null,
  inThread = false,
  guildId = GUILD,
}: {
  webhookId?: string | null;
  inThread?: boolean;
  guildId?: string | null;
} = {}) {
  const original = message("400000000000000001");
  const trigger = { ...message("400000000000000002", USER), guildId };
  const reply = message("400000000000000003");
  const tail = message("400000000000000004", webhookId ?? BOT, webhookId);
  const client = { user: { id: BOT }, rest: new REST() };
  const latest = new Collection([
    [tail.id, tail],
    [reply.id, reply],
    [trigger.id, trigger],
    [original.id, original],
  ]);
  const fetch = mock(async (options: string | { message?: string; limit?: number }) => {
    if (typeof options === "string") return latest.get(options);
    if (options.message) return latest.get(options.message);
    return new Collection([...latest.entries()].slice(0, options.limit));
  });
  const posted: ReturnType<typeof message>[] = [];
  const send = mock(async (options: MessageCreateOptions) => {
    const controls = message(String(410000000000000001n + BigInt(posted.length)));
    controls.content = "";
    controls.applyComponents({ components: options.components as MessageEditOptions["components"] });
    controls.delete.mockImplementation(async () => {
      latest.delete(controls.id);
    });
    posted.push(controls);
    latest.reverse().set(controls.id, controls).reverse();
    observeReplyControlMessage(controls as unknown as Message);
    return controls;
  });
  const channel = {
    id: CHANNEL,
    ...(guildId ? { guildId } : {}),
    client,
    send,
    isThread: () => inThread,
    isDMBased: () => !guildId,
    isSendable: () => true,
    messages: { fetch },
    permissionsFor: () => ({ has: () => true }),
  };
  const turn = {
    persona,
    allPersonas: [persona],
    lockedTurn: {
      admission: {
        client,
        channel,
        guild: { id: GUILD, members: { me: { id: BOT } } },
        incoming: { textQuotaSource: "user" },
      },
    },
  } as unknown as ChatTurn;
  const context = {
    turn,
    client,
    locale: "en-US",
    message: trigger,
    channel,
    userDiscId: USER,
    currentPersona: persona,
    streamingContext: {
      deliveredMessageRefs: [reply, tail].map((item) => ({
        messageId: item.id,
        channelId: CHANNEL,
        webhookId: item.webhookId,
      })),
      deliveryReceipts: [
        {
          messageId: tail.id,
          channelId: CHANNEL,
          webhookId,
          route: webhookId ? "webhook" : "bot",
          identity: { username: persona.persona_nickname, avatarUrl: "https://cdn.example.invalid/sprite.png" },
          speaker: { personaId: persona.persona_id, kind: "appearance" },
        },
      ],
    },
  } as unknown as ChatTurnContext;
  const result: GenerationTurnResult = {
    status: "completed",
    personaResponses: [{ personaName: persona.persona_nickname, text: tail.content }],
    streamResults: [],
  };

  function deliverNewerReply() {
    const newer = message("420000000000000001");
    latest.reverse().set(newer.id, newer).reverse();
    context.streamingContext.deliveredMessageRefs = [{ messageId: newer.id, channelId: CHANNEL, webhookId: null }];
    context.streamingContext.deliveryReceipts = [
      {
        messageId: newer.id,
        channelId: CHANNEL,
        route: "bot",
        webhookId: null,
        identity: {},
        speaker: null,
      },
    ];
    return newer;
  }

  return { context, result, turn, original, trigger, reply, tail, latest, fetch, send, posted, deliverNewerReply };
}

afterEach(async () => {
  clearReplyControls(CHANNEL);
  await new Promise<void>((done) => setImmediate(done));
});

describe("Fast regeneration", () => {
  it("posts below the final streamed message and accepts one selection from the triggerer", async () => {
    const { context, result, reply, tail, send, posted } = setupTurn();
    context.currentPersona = createPersona({ config: { fast_regeneration_continue_enabled: true } });
    await offerFastRegeneration(context, result);
    expect(reply.edit).not.toHaveBeenCalled();
    const payload = send.mock.calls[0]?.[0];
    const row = payload?.components?.[0];
    if (!(row instanceof ActionRowBuilder)) throw new Error("Expected an action row");
    expect(row.toJSON().components).toMatchObject([
      {
        custom_id: "reply-controls:v1:continue:en-US",
        label: "→",
      },
    ]);
    expect(payload).not.toHaveProperty("content");
    expect(payload?.reply).toBeUndefined();
    const [controls] = posted;
    expect(resolveFastRegeneration(CHANNEL, controls.id, BOT, "continue")).toMatchObject({ status: "denied" });
    expect(resolveFastRegeneration(CHANNEL, controls.id, USER, "retry")).toMatchObject({ status: "stale" });
    const selection = resolveFastRegeneration(CHANNEL, controls.id, USER, "continue");
    if (selection.status !== "ready") throw new Error("Expected controls for the last reply");
    expect(selection.request).toMatchObject({ action: "continue", replyId: tail.id, messageIds: [reply.id, tail.id] });
    expect(selection.request.consume()).toBe(true);
    expect(selection.request.consume()).toBe(false);
    await new Promise<void>((done) => setImmediate(done));
    expect(resolveFastRegeneration(CHANNEL, controls.id, USER, "continue")).toMatchObject({ status: "stale" });
    expect(controls.delete).toHaveBeenCalledTimes(1);
    expect(tail.edit).not.toHaveBeenCalled();
  });

  it.each([
    "retry",
    "continue",
  ] as const)("privately rejects %s from another member and keeps the row", async (action) => {
    const { context, result, posted } = setupTurn();
    await offerFastRegeneration(context, result);
    const [controls] = posted;
    const interaction = Object.assign(
      createRouteInteraction({ customId: `reply-controls:v1:${action}:en-US`, guildId: GUILD }),
      { channelId: CHANNEL, message: controls },
    );
    const reply = interaction.reply;
    interaction.reply = async (payload) => {
      const receipt = message("420000000000000001");
      receipt.flags.add(MessageFlags.Ephemeral);
      observeReplyControlMessage(receipt as unknown as Message);
      return reply(payload);
    };
    const runChat = spyOn(chatHandler, "tomoriChat").mockResolvedValue("run");
    try {
      expect(await dispatchGlobalInteraction(context.client, interaction as unknown as GlobalRoutableInteraction)).toBe(
        true,
      );
      expect(interaction.calls.map(({ method }) => method)).toEqual(["reply"]);
      expect(interaction.replies[0]).toMatchObject({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
      expect(collectTextDisplays(interaction.replies[0]).join("\n")).toMatch(
        localizedProse("en-US", "general.reply_controls.only_triggerer"),
      );
      expect(runChat).not.toHaveBeenCalled();
      expect(controls.delete).not.toHaveBeenCalled();
      expect(resolveFastRegeneration(CHANNEL, controls.id, USER, action)).toMatchObject({ status: "ready" });
    } finally {
      runChat.mockRestore();
    }
  });

  it("acknowledges authorized Retry clicks and reports a refusal privately", async () => {
    const { context, result, trigger, reply, tail, posted, send } = setupTurn();
    await offerFastRegeneration(context, result);
    const row = send.mock.calls[0]?.[0]?.components?.[0];
    if (!(row instanceof ActionRowBuilder)) throw new Error("Expected an action row");
    const button = row.toJSON().components[0];
    expect(button).toMatchObject({ custom_id: "reply-controls:v1:retry:en-US", label: "↻" });
    const authorized = Object.assign(
      createRouteInteraction({ customId: "reply-controls:v1:retry:en-US", guildId: GUILD }),
      { channelId: CHANNEL, message: posted[0], inCachedGuild: () => true, member: { id: USER } },
    );
    authorized.user = { ...authorized.user, id: USER };
    const runChat = spyOn(chatHandler, "tomoriChat").mockImplementation(async (input) => {
      expect(authorized.deferred).toBe(true);
      input.fastRegeneration?.onDecline?.("newer-messages");
      return "run";
    });
    try {
      expect(await dispatchGlobalInteraction(context.client, authorized as unknown as GlobalRoutableInteraction)).toBe(
        true,
      );
      expect(authorized.replies[0]).toMatchObject({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
      expect(collectTextDisplays(authorized.replies[0]).join("\n")).toMatch(
        localizedProse("en-US", "general.reply_controls.newer_messages"),
      );
      expect(runChat).toHaveBeenCalledWith(
        expect.objectContaining({
          client: context.client,
          message: trigger,
          selectedPersonaId: context.currentPersona.persona_id,
          fastRegeneration: expect.objectContaining({
            action: "retry",
            replyId: tail.id,
            messageIds: [reply.id, tail.id],
          }),
        }),
      );
    } finally {
      runChat.mockRestore();
    }
  });

  it("removes the previous row even when the next persona reply has its controls off", async () => {
    const { context, result, latest, posted, deliverNewerReply } = setupTurn();
    await offerFastRegeneration(context, result);

    const newer = deliverNewerReply();
    context.currentPersona = createPersona();
    await offerFastRegeneration(context, result);

    await new Promise<void>((done) => setImmediate(done));
    expect(resolveFastRegeneration(CHANNEL, posted[0].id, USER, "retry")).toMatchObject({ status: "stale" });
    expect(posted[0].delete).toHaveBeenCalledTimes(1);
    latest.delete(newer.id);
    await observeReplyControlDeletions(CHANNEL, [newer.id]);
    expect(posted).toHaveLength(1);
  });

  it("posts one row as the same persona in a thread and recognizes its early gateway event", async () => {
    const { context, result, tail, send } = setupTurn({ webhookId: WEBHOOK, inThread: true });
    result.fallbackNotice = fallbackNotice;
    const gatewayClient = new Client({ intents: [] });
    const deleteMessage = mock(async () => undefined);
    const sendWebhook = mock(async (options: MessageCreateOptions) => {
      const row = options.components?.[0];
      if (!(row instanceof ActionRowBuilder)) throw new Error("Expected an action row");
      const controls: Message = Reflect.construct(Message, [
        gatewayClient,
        {
          id: "410000000000000001",
          channel_id: CHANNEL,
          webhook_id: WEBHOOK,
          application_id: BOT,
          author: { id: WEBHOOK, username: persona.persona_nickname, discriminator: "0000", avatar: null, bot: true },
          content: "",
          components: [row.toJSON()],
        },
      ]);
      expect(controls.applicationId).toBe(BOT);
      observeReplyControlMessage(controls);
      return controls;
    });
    context.responseTarget = {
      webhook: {
        id: WEBHOOK,
        token: "fixture",
        guildId: GUILD,
        client: context.client,
        send: sendWebhook,
        deleteMessage,
      } as unknown as Webhook,
    };
    await offerFastRegeneration(context, result);

    expect(send).not.toHaveBeenCalled();
    expect(sendWebhook).toHaveBeenCalledTimes(1);
    const payload = sendWebhook.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      username: persona.persona_nickname,
      avatarURL: "https://cdn.example.invalid/sprite.png",
      threadId: CHANNEL,
    });
    expect(payload?.reply).toBeUndefined();
    const row = payload?.components?.[0];
    if (!(row instanceof ActionRowBuilder)) throw new Error("Expected an action row");
    expect(row.toJSON().components).toMatchObject([
      { label: "↻", style: ButtonStyle.Secondary },
      { label: "→", style: ButtonStyle.Secondary },
      { label: localizedCopy("en-US", "genai.fallback_used_details_button"), style: ButtonStyle.Secondary },
    ]);
    const selection = resolveFastRegeneration(CHANNEL, "410000000000000001", USER, "continue");
    if (selection.status !== "ready") throw new Error("Expected active webhook controls");
    expect(selection.request.consume()).toBe(true);
    await new Promise<void>((done) => setImmediate(done));
    expect(deleteMessage).toHaveBeenCalledWith("410000000000000001", CHANNEL);
    expect(tail.edit).not.toHaveBeenCalled();
  });

  it("posts a bot reply when the webhook row is refused and removes it on Continue", async () => {
    const { context, result, turn, reply, tail, latest, send, posted } = setupTurn({ webhookId: WEBHOOK });
    const resolve = spyOn(authoringWebhook, "resolveAuthoringWebhook").mockResolvedValue({
      id: WEBHOOK,
      guildId: GUILD,
      client: context.client,
      send: async () => {
        throw Object.assign(new Error(), { code: 50035, status: 400 });
      },
    } as unknown as Webhook);
    const config = spyOn(tomoriStateCache, "getCachedMainPersona").mockResolvedValue(persona);
    try {
      await offerFastRegeneration(context, result);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          reply: { messageReference: tail.id, failIfNotExists: true },
          allowedMentions: { repliedUser: false },
        }),
      );

      const [controls] = posted;
      const humanMessage = message("420000000000000001", USER);
      latest.reverse().set(humanMessage.id, humanMessage).reverse();
      expect(resolveFastRegeneration(CHANNEL, tail.id, USER, "continue")).toMatchObject({ status: "stale" });
      const selection = resolveFastRegeneration(CHANNEL, controls.id, USER, "continue");
      if (selection.status !== "ready") throw new Error("Expected active fallback controls");
      expect(selection.request).toMatchObject({ replyId: tail.id, messageIds: [reply.id, tail.id] });
      expect(selection.request.relatedDeliveryIds).toEqual(new Set([controls.id]));
      expect(await prepareFastRegeneration(turn, selection.request)).toBe("newer-messages");
      latest.delete(humanMessage.id);
      expect(await prepareFastRegeneration(turn, selection.request)).toBe("ready");
      expect(controls.delete).toHaveBeenCalledTimes(1);
      expect(tail.delete).not.toHaveBeenCalled();
      expect(humanMessage.delete).not.toHaveBeenCalled();
    } finally {
      resolve.mockRestore();
      config.mockRestore();
    }
  });

  it.each([GUILD, null])("offers fallback details without regeneration in workspace %s", async (guildId) => {
    const { context, result, posted, send } = setupTurn({ guildId });
    if (guildId) context.currentPersona = createPersona();
    context.locale = guildId ? "en-US" : "ja";
    result.fallbackNotice = fallbackNotice;

    await offerFastRegeneration(context, result);
    const row = send.mock.calls[0]?.[0]?.components?.[0];
    if (!(row instanceof ActionRowBuilder)) throw new Error("Expected an action row");
    expect(row.toJSON().components).toMatchObject([
      { label: localizedCopy(context.locale, "genai.fallback_used_details_button") },
    ]);
    clearReplyControls(CHANNEL);
    await new Promise<void>((done) => setImmediate(done));
    expect(posted[0].delete).toHaveBeenCalledTimes(1);
  });

  it("uses the viewer's locale and opens fallback details without deferring, then answers stale clicks privately", async () => {
    const { context, result, posted, latest } = setupTurn();
    result.fallbackNotice = fallbackNotice;
    const savedLocale = "ja";
    const lookupUser = spyOn(userCache, "getCachedUserRow").mockResolvedValue(
      createUserRow({ language_pref: savedLocale }),
    );
    try {
      await offerFastRegeneration(context, result);
      const [controls] = posted;
      const click = () =>
        Object.assign(createRouteInteraction({ customId: "reply-controls:v1:fallback:en-US" }), {
          channelId: CHANNEL,
          message: controls,
        });
      const open = click();
      expect(open.user.id).not.toBe(USER);
      expect(await dispatchGlobalInteraction(context.client, open as unknown as GlobalRoutableInteraction)).toBe(true);
      expect(open.calls.map(({ method }) => method)).toEqual(["showModal"]);
      const modal = open.calls[0]?.payload as ModalBuilder;
      expect(modal.toJSON().title).toBe(localizedCopy(savedLocale, "genai.fallback_used_title"));
      expect(collectTextDisplays(modal.toJSON()).join("\n")).toContain(fallbackNotice.successModelCodename);
      const reopen = click();
      expect(await dispatchGlobalInteraction(context.client, reopen as unknown as GlobalRoutableInteraction)).toBe(
        true,
      );
      expect(reopen.calls.map(({ method }) => method)).toEqual(["showModal"]);
      expect(controls.delete).not.toHaveBeenCalled();

      const newer = message("420000000000000001", USER);
      latest.reverse().set(newer.id, newer).reverse();
      observeReplyControlMessage(newer as unknown as Message);
      const hidden = click();
      expect(await dispatchGlobalInteraction(context.client, hidden as unknown as GlobalRoutableInteraction)).toBe(
        true,
      );
      latest.delete(newer.id);
      await observeReplyControlDeletions(CHANNEL, [newer.id]);
      const retired = Object.assign(click(), { message: posted[1] });
      clearReplyControls(CHANNEL);
      expect(await dispatchGlobalInteraction(context.client, retired as unknown as GlobalRoutableInteraction)).toBe(
        true,
      );
      for (const stale of [hidden, retired]) {
        expect(stale.calls.map(({ method }) => method)).toEqual(["reply"]);
        expect(stale.replies[0]).toMatchObject({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
        expect(collectTextDisplays(stale.replies[0]).join("\n")).toMatch(
          localizedProse(savedLocale, "general.reply_controls.stale"),
        );
      }
    } finally {
      lookupUser.mockRestore();
    }
  });

  it("hides and restores the whole row without editing the reply, then deletes it with Retry", async () => {
    const { context, result, turn, original, trigger, reply, tail, latest, posted } = setupTurn();
    result.fallbackNotice = fallbackNotice;
    const clock = spyOn(Date, "now");
    const timer = spyOn(globalThis, "setTimeout");
    const config = spyOn(tomoriStateCache, "getCachedMainPersona").mockResolvedValue(persona);
    try {
      const before = Date.now();
      const notice = message("400000000000000005");
      latest.reverse().set(notice.id, notice).reverse();
      context.streamingContext.deliveryReceipts?.push({
        messageId: notice.id,
        channelId: CHANNEL,
        route: "bot",
        webhookId: null,
        identity: {},
        speaker: null,
      });
      await offerFastRegeneration(context, result);
      const [initial] = posted;
      expect(timer.mock.calls).toHaveLength(0);
      clock.mockReturnValue(before + 60_000);

      const unknownWebhook = "500000000000000001";
      const newer = message("400000000000000006", unknownWebhook, unknownWebhook);
      const newest = message("400000000000000007", USER);
      latest.reverse().set(newer.id, newer).set(newest.id, newest).reverse();
      for (const action of ["retry", "continue"] as const) {
        const selection = resolveFastRegeneration(CHANNEL, initial.id, USER, action);
        if (selection.status !== "ready") throw new Error("Expected a click before the gateway updates the row");
        expect(await prepareFastRegeneration(turn, selection.request)).toBe("newer-messages");
      }

      observeReplyControlMessage(newer as unknown as Message);
      observeReplyControlMessage(newest as unknown as Message);
      await new Promise<void>((done) => setImmediate(done));
      expect(initial.delete).toHaveBeenCalledTimes(1);
      expect(resolveFastRegeneration(CHANNEL, initial.id, USER, "retry")).toMatchObject({ status: "stale" });
      expect(resolveFastRegeneration(CHANNEL, initial.id, USER, "continue")).toMatchObject({ status: "stale" });

      latest.delete(newest.id);
      await observeReplyControlDeletions(CHANNEL, [newest.id]);
      expect(posted).toHaveLength(1);
      expect(reply.delete).not.toHaveBeenCalled();

      latest.delete(newer.id);
      await observeReplyControlDeletions(CHANNEL, [newer.id]);
      expect(posted).toHaveLength(2);
      const restored = posted[1];
      expect(restored.components).toEqual(initial.components);
      expect(resolveFastRegeneration(CHANNEL, restored.id, USER, "continue")).toMatchObject({ status: "ready" });
      const retry = resolveFastRegeneration(CHANNEL, restored.id, USER, "retry");
      if (retry.status !== "ready") throw new Error("Expected the same row to be restored");
      expect(await prepareFastRegeneration(turn, retry.request)).toBe("ready");
      expect(reply.delete).toHaveBeenCalledTimes(1);
      expect(tail.delete).toHaveBeenCalledTimes(1);
      expect(restored.delete).toHaveBeenCalledTimes(1);
      expect(tail.edit).not.toHaveBeenCalled();
      expect(original.delete).not.toHaveBeenCalled();
      expect(trigger.delete).not.toHaveBeenCalled();
      expect(newer.delete).not.toHaveBeenCalled();
      expect(notice.delete).not.toHaveBeenCalled();
    } finally {
      config.mockRestore();
      timer.mockRestore();
      clock.mockRestore();
    }
  });

  it("does not restore a row cleared by a conversation reset", async () => {
    const { context, result, latest, posted } = setupTurn();
    await offerFastRegeneration(context, result);
    clearReplyControls(CHANNEL);
    const reset = message("400000000000000005");
    latest.reverse().set(reset.id, reset).reverse();
    observeReplyControlMessage(reset as unknown as Message);
    latest.delete(reset.id);
    await observeReplyControlDeletions(CHANNEL, [reset.id]);
    await new Promise<void>((done) => setImmediate(done));
    expect(posted).toHaveLength(1);
    expect(posted[0].delete).toHaveBeenCalledTimes(1);
    expect(resolveFastRegeneration(CHANNEL, posted[0].id, USER, "retry")).toMatchObject({ status: "stale" });
  });

  it("keeps both actions hidden if a new message arrives while deletion is being reconciled", async () => {
    const { context, result, tail, latest, fetch, posted } = setupTurn();
    await offerFastRegeneration(context, result);
    const newer = message("400000000000000005", USER);
    latest.reverse().set(newer.id, newer).reverse();
    observeReplyControlMessage(newer as unknown as Message);
    await new Promise<void>((done) => setImmediate(done));

    latest.delete(newer.id);
    const history = Promise.withResolvers<typeof latest>();
    fetch.mockImplementationOnce(() => history.promise);
    const reconcile = observeReplyControlDeletions(CHANNEL, [newer.id]);
    await Promise.resolve();
    const newest = message("400000000000000006", USER);
    latest.reverse().set(newest.id, newest).reverse();
    observeReplyControlMessage(newest as unknown as Message);
    history.resolve(new Collection([[tail.id, tail]]));
    await reconcile;
    expect(posted).toHaveLength(1);

    latest.delete(newest.id);
    await observeReplyControlDeletions(CHANNEL, [newest.id]);
    expect(posted).toHaveLength(2);
  });

  it("rejects a pending Retry when a new persona reply takes over before the click can claim the row", async () => {
    const { context, result, turn, reply, tail, posted, deliverNewerReply } = setupTurn();
    const config = spyOn(tomoriStateCache, "getCachedMainPersona").mockResolvedValue(persona);
    try {
      await offerFastRegeneration(context, result);
      const selection = resolveFastRegeneration(CHANNEL, posted[0].id, USER, "retry");
      if (selection.status !== "ready") throw new Error("Expected the original reply's controls");

      deliverNewerReply();
      await offerFastRegeneration(context, result);

      expect(await prepareFastRegeneration(turn, selection.request)).not.toBe("ready");
      expect(reply.delete).not.toHaveBeenCalled();
      expect(tail.delete).not.toHaveBeenCalled();
      expect(resolveFastRegeneration(CHANNEL, posted[1].id, USER, "retry")).toMatchObject({ status: "ready" });
    } finally {
      config.mockRestore();
    }
  });

  it("leaves active turns and pending queue replays alone at lock acquisition", async () => {
    const { turn, tail, trigger } = setupTurn();
    const { channel, client } = turn.lockedTurn.admission;
    const message = { ...trigger, channel } as unknown as Message;
    const admission = {
      ...turn.lockedTurn.admission,
      message,
      incoming: normalizeChatInvocation({
        client,
        message,
        isFromQueue: false,
        isManuallyTriggered: true,
        fastRegeneration: {
          action: "retry",
          replyId: tail.id,
          messageIds: [tail.id],
          relatedDeliveryIds: new Set(),
          consume: () => true,
        },
      }),
    };
    const entry = getOrCreateChannelLockEntry(CHANNEL, GUILD);
    const queued = { message };
    const callback = mock(async () => {});
    const processQueuedMessage = mock(async () => {});
    const options = { handleStopResponse: async () => {}, processQueuedMessage };
    try {
      entry.isLocked = true;
      entry.messageQueue.push(queued);
      await runWithChannelLock(admission, callback, options);
      expect(entry.isLocked).toBe(true);
      expect(entry.messageQueue).toEqual([queued]);

      entry.isLocked = false;
      entry.pendingHistoryReplay = entry.messageQueue.shift();
      await runWithChannelLock(admission, callback, options);
      expect(entry.pendingHistoryReplay).toBe(queued);
      expect(callback).not.toHaveBeenCalled();
      expect(processQueuedMessage).not.toHaveBeenCalled();
    } finally {
      channelLocks.delete(CHANNEL);
    }
  });

  it("rejects controls that were disabled after the reply was sent", async () => {
    const { turn, reply, tail } = setupTurn();
    const config = spyOn(tomoriStateCache, "getCachedMainPersona").mockResolvedValue(createPersona());
    try {
      expect(
        await prepareFastRegeneration(turn, {
          action: "retry",
          replyId: tail.id,
          messageIds: [tail.id],
          relatedDeliveryIds: new Set(),
          consume: () => true,
        }),
      ).toBe("unavailable");
      expect(reply.delete).not.toHaveBeenCalled();
      expect(tail.delete).not.toHaveBeenCalled();
    } finally {
      config.mockRestore();
    }
  });
});
