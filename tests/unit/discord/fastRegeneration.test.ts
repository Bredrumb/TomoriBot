import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Collection, type Message } from "discord.js";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import { channelLocks, getOrCreateChannelLockEntry, runWithChannelLock } from "@/utils/chat/channelQueue";
import type { ChatTurn, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import { offerFastRegeneration, prepareFastRegeneration, takeFastRegeneration } from "@/utils/discord/fastRegeneration";
import { createPersona } from "../../helpers/fixtures";

const USER = "100000000000000001";
const BOT = "100000000000000002";
const CHANNEL = "200000000000000001";
const GUILD = "300000000000000001";

function message(id: string, authorId = BOT) {
  return {
    id,
    guildId: GUILD,
    channelId: CHANNEL,
    author: { id: authorId, bot: authorId === BOT },
    content: "Hello",
    embeds: [],
    webhookId: null,
    createdTimestamp: Date.now(),
    delete: mock(async () => {}),
  };
}

const persona = createPersona({
  config: { fast_regeneration_retry_enabled: true, fast_regeneration_continue_enabled: true },
});

function setupTurn() {
  const original = message("400000000000000001");
  const trigger = message("400000000000000002", USER);
  const reply = message("400000000000000003");
  const tail = message("400000000000000004");
  const latest = new Collection([
    [tail.id, tail],
    [reply.id, reply],
    [trigger.id, trigger],
    [original.id, original],
  ]);
  const remove = mock(async () => {});
  const react = mock(async (_emoji: string) => ({ client: { user: { id: BOT } }, users: { remove } }));
  const fetch = mock(async (options: string | { limit: number }) =>
    typeof options === "string" ? { ...tail, react } : latest,
  );
  const channel = {
    id: CHANNEL,
    isThread: () => false,
    messages: { fetch },
    permissionsFor: () => ({ has: () => true }),
  };
  const turn = {
    persona,
    allPersonas: [persona],
    lockedTurn: {
      admission: {
        client: { user: { id: BOT } },
        channel,
        guild: { id: GUILD, members: { me: { id: BOT } } },
        incoming: { textQuotaSource: "user" },
      },
    },
  } as unknown as ChatTurn;
  const context = {
    turn,
    message: trigger,
    channel,
    userDiscId: USER,
    currentPersona: persona,
    streamingContext: {
      deliveredMessageRefs: [reply, tail].map((item) => ({
        messageId: item.id,
        channelId: CHANNEL,
        webhookId: null,
      })),
    },
  } as unknown as ChatTurnContext;
  const result: GenerationTurnResult = {
    status: "completed",
    personaResponses: [{ personaName: persona.persona_nickname, text: tail.content }],
    streamResults: [],
  };

  return { context, result, turn, original, trigger, reply, tail, latest, react, remove };
}

afterEach(() => {
  // Consume any remaining controls from a failed assertion so subsequent tests start clean.
  takeFastRegeneration("400000000000000004", USER, "🔄");
  takeFastRegeneration("400000000000000004", USER, "➡");
});

describe("Fast regeneration", () => {
  it("offers only enabled reactions and accepts a single selection by the triggerer", async () => {
    const { context, result, tail, react, remove } = setupTurn();
    context.currentPersona = createPersona({ config: { fast_regeneration_continue_enabled: true } });
    await offerFastRegeneration(context, result);
    expect(react.mock.calls).toEqual([["➡️"]]);
    expect(takeFastRegeneration(tail.id, BOT, "➡")).toBeUndefined();
    expect(takeFastRegeneration(tail.id, USER, "🔄")).toBeUndefined();
    expect(takeFastRegeneration(tail.id, USER, "➡")?.request.action).toBe("continue");
    expect(takeFastRegeneration(tail.id, USER, "➡")).toBeUndefined();
    expect(remove).toHaveBeenCalledWith(BOT);
  });

  it("only deletes the selected turn's delivered messages", async () => {
    const { turn, original, trigger, reply, tail } = setupTurn();
    const config = spyOn(tomoriStateCache, "getCachedMainPersona").mockResolvedValue(persona);
    try {
      expect(
        await prepareFastRegeneration(turn, { action: "retry", replyId: tail.id, messageIds: [reply.id, tail.id] }),
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
    const target = { replyId: tail.id, messageIds: [reply.id, tail.id] };
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
        fastRegeneration: { action: "retry", replyId: tail.id, messageIds: [tail.id] },
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

  it("rejects reactions that were disabled after the reply was sent", async () => {
    const { turn, reply, tail } = setupTurn();
    const config = spyOn(tomoriStateCache, "getCachedMainPersona").mockResolvedValue(createPersona());
    try {
      expect(await prepareFastRegeneration(turn, { action: "retry", replyId: tail.id, messageIds: [tail.id] })).toBe(
        false,
      );
      expect(reply.delete).not.toHaveBeenCalled();
      expect(tail.delete).not.toHaveBeenCalled();
    } finally {
      config.mockRestore();
    }
  });
});
