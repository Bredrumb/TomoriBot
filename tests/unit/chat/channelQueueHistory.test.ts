import { afterEach, describe, expect, it } from "bun:test";
import type { Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import {
  channelLocks,
  excludeMessagesAwaitingOwnTurn,
  getOrCreateChannelLockEntry,
  type QueuedMessage,
} from "@/utils/chat/channelQueue";

const CHANNEL_ID = "_rt_channel";
const BOT_USER_ID = "_rt_bot";

function makeMessage(id: string, authorId: string): Message {
  return {
    id,
    webhookId: null,
    interaction: null,
    author: { id: authorId, username: authorId },
    client: { user: { id: BOT_USER_ID } },
  } as unknown as Message;
}

function queueMessages(...messages: Message[]): void {
  const lockEntry = getOrCreateChannelLockEntry(CHANNEL_ID, "_rt_server");
  lockEntry.messageQueue.push(...messages.map((message): QueuedMessage => ({ message })));
}

function historyIds(history: Message[], triggerId: string): string[] {
  return excludeMessagesAwaitingOwnTurn(history, CHANNEL_ID, triggerId, [] as TomoriState[]).map(
    (message) => message.id,
  );
}

describe("excludeMessagesAwaitingOwnTurn", () => {
  afterEach(() => {
    channelLocks.delete(CHANNEL_ID);
  });

  it("hides a message from another user that is queued for its own turn", () => {
    const chris = makeMessage("100", "_rt_chris");
    const eoj = makeMessage("101", "_rt_eoj");
    queueMessages(eoj);

    expect(historyIds([chris, eoj], chris.id)).toEqual(["100"]);
  });

  it("keeps the trigger even when persona jobs queue it again", () => {
    const trigger = makeMessage("100", "_rt_chris");
    queueMessages(trigger);

    expect(historyIds([trigger], trigger.id)).toEqual(["100"]);
  });

  it("keeps gap messages that have no queue entry", () => {
    const trigger = makeMessage("100", "_rt_chris");
    const continuation = makeMessage("101", "_rt_chris");
    const chatter = makeMessage("102", "_rt_eoj");
    queueMessages(makeMessage("103", "_rt_other"));

    expect(historyIds([trigger, continuation, chatter], trigger.id)).toEqual(["100", "101", "102"]);
  });

  it("keeps the bot's own message even when it is queued as a self-trigger", () => {
    const trigger = makeMessage("100", "_rt_chris");
    const botReply = makeMessage("101", BOT_USER_ID);
    queueMessages(botReply);

    expect(historyIds([trigger, botReply], trigger.id)).toEqual(["100", "101"]);
  });

  it("returns history unchanged when the channel has no queue", () => {
    const trigger = makeMessage("100", "_rt_chris");
    const other = makeMessage("101", "_rt_eoj");

    expect(historyIds([trigger, other], trigger.id)).toEqual(["100", "101"]);
  });
});
