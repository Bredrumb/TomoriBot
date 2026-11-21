import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import {
  ActionRowBuilder,
  Collection,
  ComponentType,
  type Message,
  type MessageEditOptions,
  type Webhook,
} from "discord.js";
import * as chatHandler from "@/events/messageCreate/tomoriChat";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import { channelLocks, getOrCreateChannelLockEntry, runWithChannelLock } from "@/utils/chat/channelQueue";
import type { ChatTurn, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import { offerFastRegeneration, prepareFastRegeneration, takeFastRegeneration } from "@/utils/discord/fastRegeneration";
import type { GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { dispatchGlobalInteraction } from "@/utils/discord/interactions/router";
import * as authoringWebhook from "@/utils/discord/webhook/fallback";
import * as messageDelivery from "@/utils/discord/webhook/singleAttemptMessage";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";
import { localizedCopy } from "../../helpers/localeCases";
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
    return options.message ? latest.get(options.message) : latest;
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
    await takeFastRegeneration(CHANNEL, id, USER, "retry");
    await takeFastRegeneration(CHANNEL, id, USER, "continue");
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
        label: localizedCopy("en-US", "general.reply_controls.continue"),
      },
    ]);
    expect(payload).not.toHaveProperty("content");
    expect(await takeFastRegeneration(CHANNEL, tail.id, BOT, "continue")).toMatchObject({ status: "denied" });
    expect(await takeFastRegeneration(CHANNEL, tail.id, USER, "retry")).toMatchObject({ status: "stale" });
    expect(await takeFastRegeneration(CHANNEL, tail.id, USER, "continue")).toMatchObject({
      status: "ready",
      request: { action: "continue", replyId: tail.id, messageIds: [reply.id, tail.id] },
    });
    expect(await takeFastRegeneration(CHANNEL, tail.id, USER, "continue")).toMatchObject({ status: "stale" });
  });

  it("acknowledges routed clicks before running chat as the triggering member", async () => {
    const { context, result, trigger, reply, tail } = setupTurn();
    await offerFastRegeneration(context, result);
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
      runChat.mockImplementation(async () => {
        expect(authorized.deferred).toBe(true);
        return "run";
      });
      expect(await dispatchGlobalInteraction(context.client, authorized as unknown as GlobalRoutableInteraction)).toBe(
        true,
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

    expect(await takeFastRegeneration(CHANNEL, tail.id, USER, "retry")).toMatchObject({ status: "stale" });
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
      expect(await takeFastRegeneration(CHANNEL, tail.id, USER, "continue")).toMatchObject({ status: "ready" });
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

  it("binds the bot-authored fallback row to the original reply and ignores its own message in freshness checks", async () => {
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

      latest.reverse().set(controls.id, controls).reverse();
      expect(await takeFastRegeneration(CHANNEL, tail.id, USER, "continue")).toMatchObject({ status: "stale" });
      const selection = await takeFastRegeneration(CHANNEL, controls.id, USER, "continue");
      if (selection.status !== "ready") throw new Error("Expected active fallback controls");
      expect(selection.request).toMatchObject({ replyId: tail.id, messageIds: [reply.id, tail.id] });
      expect(await prepareFastRegeneration(turn, selection.request)).toBe(true);
      expect(controls.delete).toHaveBeenCalledTimes(1);
      expect(tail.delete).not.toHaveBeenCalled();
    } finally {
      resolve.mockRestore();
      send.mockRestore();
      config.mockRestore();
    }
  });

  it("only deletes the selected turn's delivered messages", async () => {
    const { turn, original, trigger, reply, tail } = setupTurn();
    const config = spyOn(tomoriStateCache, "getCachedMainPersona").mockResolvedValue(persona);
    try {
      expect(
        await prepareFastRegeneration(turn, {
          action: "retry",
          replyId: tail.id,
          messageIds: [reply.id, tail.id],
          ignoredMessageIds: new Set(),
        }),
      ).toBe(true);
      expect(reply.delete).toHaveBeenCalledTimes(1);
      expect(tail.delete).toHaveBeenCalledTimes(1);
      expect(original.delete).not.toHaveBeenCalled();
      expect(trigger.delete).not.toHaveBeenCalled();
    } finally {
      config.mockRestore();
    }
  });

  it("preserves the reply for Continue and refuses a stale Retry", async () => {
    const { turn, reply, tail, latest } = setupTurn();
    const config = spyOn(tomoriStateCache, "getCachedMainPersona").mockResolvedValue(persona);
    const target = { replyId: tail.id, messageIds: [reply.id, tail.id], ignoredMessageIds: new Set<string>() };
    try {
      expect(await prepareFastRegeneration(turn, { action: "continue", ...target })).toBe(true);
      latest.reverse();
      expect(await prepareFastRegeneration(turn, { action: "retry", ...target })).toBe(false);
      expect(reply.delete).not.toHaveBeenCalled();
      expect(tail.delete).not.toHaveBeenCalled();
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
        fastRegeneration: { action: "retry", replyId: tail.id, messageIds: [tail.id], ignoredMessageIds: new Set() },
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
          ignoredMessageIds: new Set(),
        }),
      ).toBe(false);
      expect(reply.delete).not.toHaveBeenCalled();
      expect(tail.delete).not.toHaveBeenCalled();
    } finally {
      config.mockRestore();
    }
  });
});
