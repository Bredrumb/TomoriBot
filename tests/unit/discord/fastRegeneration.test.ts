import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import {
  ActionRowBuilder,
  Collection,
  ComponentType,
  MessageFlags,
  type Message,
  type MessageEditOptions,
  type Webhook,
} from "discord.js";
import * as chatHandler from "@/events/messageCreate/tomoriChat";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import { channelLocks, getOrCreateChannelLockEntry, runWithChannelLock } from "@/utils/chat/channelQueue";
import type { ChatTurn, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import {
  offerFastRegeneration,
  prepareFastRegeneration,
  resolveFastRegeneration,
} from "@/utils/discord/fastRegeneration";
import type { GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { dispatchGlobalInteraction } from "@/utils/discord/interactions/router";
import * as authoringWebhook from "@/utils/discord/webhook/fallback";
import * as messageDelivery from "@/utils/discord/webhook/singleAttemptMessage";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";
import { localizedProse } from "../../helpers/localeCases";
import { collectTextDisplays } from "../../helpers/panelLimits";
import { createRouteInteraction } from "../../helpers/routeInteraction";

beforeAll(initializeLocalizer);

const USER = "100000000000000001";
const BOT = "100000000000000002";
const CHANNEL = "200000000000000001";
const GUILD = "300000000000000001";

function message(id: string, authorId = BOT, webhookId: string | null = null) {
  const message = {
    id,
    guildId: GUILD,
    channelId: CHANNEL,
    author: { id: authorId, bot: authorId === BOT },
    content: "Hello",
    embeds: [],
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

function setupTurn(webhookId: string | null = null, inThread = false) {
  const original = message("400000000000000001");
  const trigger = message("400000000000000002", USER);
  const reply = message("400000000000000003");
  const tail = message("400000000000000004", webhookId ?? BOT, webhookId);
  const client = { user: { id: BOT } };
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
  const channel = {
    id: CHANNEL,
    isThread: () => inThread,
    isDMBased: () => false,
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
    },
  } as unknown as ChatTurnContext;
  const result: GenerationTurnResult = {
    status: "completed",
    personaResponses: [{ personaName: persona.persona_nickname, text: tail.content }],
    streamResults: [],
  };

  return { context, result, turn, original, trigger, reply, tail, latest };
}

afterEach(async () => {
  for (const id of ["400000000000000004", "400000000000000005", "400000000000000006"]) {
    for (const action of ["retry", "continue"] as const) {
      const selection = await resolveFastRegeneration(CHANNEL, id, USER, action);
      if (selection.status === "ready") selection.request.consume();
    }
  }
});

describe("Fast regeneration", () => {
  it("edits only the final streamed message and accepts one selection from the triggerer", async () => {
    const { context, result, reply, tail } = setupTurn();
    context.currentPersona = createPersona({ config: { fast_regeneration_continue_enabled: true } });
    await offerFastRegeneration(context, result);
    expect(reply.edit).not.toHaveBeenCalled();
    const payload = tail.edit.mock.calls[0]?.[0];
    const row = payload?.components?.[0];
    if (!(row instanceof ActionRowBuilder)) throw new Error("Expected an action row");
    expect(row.toJSON().components).toMatchObject([
      {
        custom_id: "reply-controls:v1:continue:en-US",
        label: "→",
      },
    ]);
    expect(payload).not.toHaveProperty("content");
    expect(await resolveFastRegeneration(CHANNEL, tail.id, BOT, "continue")).toMatchObject({ status: "denied" });
    expect(await resolveFastRegeneration(CHANNEL, tail.id, USER, "retry")).toMatchObject({ status: "stale" });
    const selection = await resolveFastRegeneration(CHANNEL, tail.id, USER, "continue");
    if (selection.status !== "ready") throw new Error("Expected controls for the last reply");
    expect(selection.request).toMatchObject({ action: "continue", replyId: tail.id, messageIds: [reply.id, tail.id] });
    expect(selection.request.consume()).toBe(true);
    expect(selection.request.consume()).toBe(false);
    expect(await resolveFastRegeneration(CHANNEL, tail.id, USER, "continue")).toMatchObject({ status: "stale" });
  });

  it("acknowledges authorized Retry clicks and reports a refusal privately", async () => {
    const { context, result, trigger, reply, tail } = setupTurn();
    await offerFastRegeneration(context, result);
    const row = tail.edit.mock.calls[0]?.[0]?.components?.[0];
    if (!(row instanceof ActionRowBuilder)) throw new Error("Expected an action row");
    expect(row.toJSON().components[0]).toMatchObject({
      custom_id: "reply-controls:v1:retry:en-US",
      label: "↻",
    });
    const interaction = Object.assign(
      createRouteInteraction({
        customId: "reply-controls:v1:retry:en-US",
        guildId: GUILD,
      }),
      {
        channelId: CHANNEL,
        message: tail,
        inCachedGuild: () => true,
        member: { id: USER },
      },
    );
    interaction.user = { ...interaction.user, id: BOT };
    const runChat = spyOn(chatHandler, "tomoriChat").mockImplementation(async () => {
      expect(interaction.deferred).toBe(true);
      return "run";
    });
    try {
      const button = interaction as unknown as GlobalRoutableInteraction;
      expect(await dispatchGlobalInteraction(context.client, button)).toBe(true);
      expect(runChat).not.toHaveBeenCalled();

      const authorized = Object.assign(
        createRouteInteraction({
          customId: interaction.customId,
          guildId: GUILD,
          overrides: { user: { ...interaction.user, id: USER } },
        }),
        {
          channelId: CHANNEL,
          message: tail,
          inCachedGuild: () => true,
          member: { id: USER },
        },
      );
      runChat.mockImplementation(async (input) => {
        expect(authorized.deferred).toBe(true);
        input.fastRegeneration?.onDecline?.("newer-messages");
        return "run";
      });
      expect(await dispatchGlobalInteraction(context.client, authorized as unknown as GlobalRoutableInteraction)).toBe(
        true,
      );
      expect(authorized.replies[0]).toMatchObject({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
      expect(collectTextDisplays(authorized.replies[0]).join("\n")).toMatch(
        localizedProse("en-US", "general.reply_controls.retry_newer_messages"),
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
    const { context, result, tail, latest } = setupTurn();
    await offerFastRegeneration(context, result);

    const newer = message("400000000000000005");
    latest.set(newer.id, newer);
    context.streamingContext.deliveredMessageRefs = [{ messageId: newer.id, channelId: CHANNEL, webhookId: null }];
    context.currentPersona = createPersona();
    await offerFastRegeneration(context, result);

    expect(await resolveFastRegeneration(CHANNEL, tail.id, USER, "retry")).toMatchObject({ status: "stale" });
    expect(tail.edit).toHaveBeenLastCalledWith({ components: [] });
    expect(newer.edit).not.toHaveBeenCalled();
  });

  it("edits and clears inline controls through the authoring webhook in a thread", async () => {
    const webhookId = "500000000000000001";
    const { context, result, tail } = setupTurn(webhookId, true);
    const editMessage = mock(
      async (_messageId: string, options: MessageEditOptions) => tail.applyComponents(options) as unknown as Message,
    );
    const resolve = spyOn(authoringWebhook, "resolveAuthoringWebhook").mockResolvedValue({
      applicationId: BOT,
      editMessage,
    } as unknown as Webhook);
    try {
      await offerFastRegeneration(context, result);
      expect(resolve).toHaveBeenCalledWith(context.channel, webhookId, undefined);
      expect(editMessage).toHaveBeenCalledWith(
        tail.id,
        expect.objectContaining({ threadId: CHANNEL, withComponents: true }),
      );
      expect(tail.edit).not.toHaveBeenCalled();
      const selection = await resolveFastRegeneration(CHANNEL, tail.id, USER, "continue");
      if (selection.status !== "ready") throw new Error("Expected active webhook controls");
      expect(selection.request.consume()).toBe(true);
      await new Promise<void>((done) => setImmediate(done));
      expect(editMessage).toHaveBeenLastCalledWith(tail.id, {
        threadId: CHANNEL,
        withComponents: true,
        components: [],
      });
    } finally {
      resolve.mockRestore();
    }
  });

  it("binds the bot-authored fallback row to the original reply and removes the row when used", async () => {
    const { context, result, turn, reply, tail, latest } = setupTurn("500000000000000001");
    const controls = message("400000000000000006");
    const resolve = spyOn(authoringWebhook, "resolveAuthoringWebhook").mockResolvedValue({
      applicationId: "500000000000000002",
    } as Webhook);
    const send = spyOn(messageDelivery, "sendChannelMessageOnce").mockResolvedValue(controls as unknown as Message);
    const config = spyOn(tomoriStateCache, "getCachedMainPersona").mockResolvedValue(persona);
    try {
      await offerFastRegeneration(context, result);
      expect(send).toHaveBeenCalledWith(
        context.channel,
        expect.objectContaining({
          reply: { messageReference: tail.id, failIfNotExists: true },
          allowedMentions: { repliedUser: false },
        }),
        expect.any(Function),
      );

      const humanMessage = message("400000000000000007", USER);
      latest.reverse().set(controls.id, controls).set(humanMessage.id, humanMessage).reverse();
      expect(await resolveFastRegeneration(CHANNEL, tail.id, USER, "continue")).toMatchObject({ status: "stale" });
      const selection = await resolveFastRegeneration(CHANNEL, controls.id, USER, "continue");
      if (selection.status !== "ready") throw new Error("Expected active fallback controls");
      expect(selection.request).toMatchObject({ replyId: tail.id, messageIds: [reply.id, tail.id] });
      expect(selection.request.relatedDeliveryIds).toEqual(new Set([controls.id]));
      expect(await prepareFastRegeneration(turn, selection.request)).toBe("ready");
      expect(controls.delete).toHaveBeenCalledTimes(1);
      expect(tail.delete).not.toHaveBeenCalled();
      expect(humanMessage.delete).not.toHaveBeenCalled();
    } finally {
      resolve.mockRestore();
      send.mockRestore();
      config.mockRestore();
    }
  });

  it("restores Retry eligibility when all newer chat is deleted without timing out the row", async () => {
    const { context, result, turn, original, trigger, reply, tail, latest } = setupTurn();
    const clock = spyOn(Date, "now");
    const timer = spyOn(globalThis, "setTimeout");
    const config = spyOn(tomoriStateCache, "getCachedMainPersona").mockResolvedValue(persona);
    try {
      const before = Date.now();
      const notice = message("400000000000000005");
      latest.reverse().set(notice.id, notice).reverse();
      context.streamingContext.deliveryReceipts = [
        { messageId: notice.id, channelId: CHANNEL, route: "bot", webhookId: null, identity: {}, speaker: null },
      ];
      await offerFastRegeneration(context, result);
      expect(timer.mock.calls).toHaveLength(0);
      clock.mockReturnValue(before + 60_000);

      const newer = message("400000000000000006", USER);
      const newest = message("400000000000000007", USER);
      latest.reverse().set(newer.id, newer).set(newest.id, newest).reverse();
      const selection = await resolveFastRegeneration(CHANNEL, tail.id, USER, "retry");
      if (selection.status !== "ready") throw new Error("Expected the latest persona's controls");
      expect(await prepareFastRegeneration(turn, selection.request)).toBe("newer-messages");
      expect(tail.delete).not.toHaveBeenCalled();

      latest.delete(newest.id);
      expect(await prepareFastRegeneration(turn, selection.request)).toBe("newer-messages");
      expect(reply.delete).not.toHaveBeenCalled();

      latest.delete(newer.id);
      const retry = await resolveFastRegeneration(CHANNEL, tail.id, USER, "retry");
      if (retry.status !== "ready") throw new Error("Expected the same row to remain active");
      expect(await prepareFastRegeneration(turn, retry.request)).toBe("ready");
      expect(reply.delete).toHaveBeenCalledTimes(1);
      expect(tail.delete).toHaveBeenCalledTimes(1);
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

  it("rejects a pending Retry when a new persona reply takes over before the click can claim the row", async () => {
    const { context, result, turn, reply, tail, latest } = setupTurn();
    const config = spyOn(tomoriStateCache, "getCachedMainPersona").mockResolvedValue(persona);
    try {
      await offerFastRegeneration(context, result);
      const selection = await resolveFastRegeneration(CHANNEL, tail.id, USER, "retry");
      if (selection.status !== "ready") throw new Error("Expected the original reply's controls");

      const newer = message("400000000000000005");
      latest.set(newer.id, newer);
      context.streamingContext.deliveredMessageRefs = [{ messageId: newer.id, channelId: CHANNEL, webhookId: null }];
      await offerFastRegeneration(context, result);

      expect(await prepareFastRegeneration(turn, selection.request)).not.toBe("ready");
      expect(reply.delete).not.toHaveBeenCalled();
      expect(tail.delete).not.toHaveBeenCalled();
      expect(await resolveFastRegeneration(CHANNEL, newer.id, USER, "retry")).toMatchObject({ status: "ready" });
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
