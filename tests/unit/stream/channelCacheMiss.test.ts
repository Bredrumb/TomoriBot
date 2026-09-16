import { describe, expect, it } from "bun:test";
import type { Message } from "discord.js";
import type { StreamContext } from "@/types/stream/interfaces";
import { createDefaultStreamState } from "@/types/stream/types";
import { StreamUiUpdater } from "@/utils/discord/stream/uiUpdater";

const CHANNEL_ID = "1382235263668846612";
const SOURCE_MESSAGE_ID = "1382235263668846613";

type StopCall = { channelId: string; requesterId: string | undefined };

/**
 * Builds a source `Message` whose `channel` behaves like discord.js: a live cache lookup that
 * returns null once the entry is not cached. `Message#reply` throws on that null before it builds
 * a request, which is the failure this file exists to prove the send path no longer depends on.
 */
function makeUncachedSourceMessage(): { message: Message; replyCalls: number } {
  const state = { replyCalls: 0 };
  const message = {
    id: SOURCE_MESSAGE_ID,
    channelId: CHANNEL_ID,
    get channel() {
      return null;
    },
    async reply() {
      state.replyCalls++;
      throw Object.assign(new Error("Could not find the channel where this message came from in the cache!"), {
        code: "ChannelNotCached",
      });
    },
  } as unknown as Message;

  return {
    message,
    get replyCalls() {
      return state.replyCalls;
    },
  };
}

function makeUpdater() {
  const stopCalls: StopCall[] = [];
  const updater = new StreamUiUpdater({
    hasStopRequest: () => false,
    requestStop: (channelId, requesterId) => {
      stopCalls.push({ channelId, requesterId });
      return true;
    },
    notifyStreamProgress: () => undefined,
  });
  return { updater, stopCalls };
}

describe("a reply whose source channel left the cache", () => {
  it("sends on the channel resolved by id and keeps the reply reference", async () => {
    const { updater, stopCalls } = makeUpdater();
    const replySends: unknown[] = [];
    const fetchedChannels: string[] = [];
    const source = makeUncachedSourceMessage();

    const context = {
      channel: {
        id: CHANNEL_ID,
        send: async (payload: unknown) => {
          replySends.push(payload);
          return {};
        },
      },
      client: {
        channels: {
          cache: new Map(),
          fetch: async (id: string) => {
            fetchedChannels.push(id);
            return {
              id,
              send: async (payload: unknown) => {
                replySends.push(payload);
                return {};
              },
            };
          },
        },
      },
      replyToMessage: source.message,
      locale: "en-US",
      suppressUserErrors: false,
      tomoriState: { is_alter: false, config: {} },
    } as unknown as StreamContext;

    const state = createDefaultStreamState();
    const sent = await updater.sendSinglePayload({ content: "hello" }, "hello", context, state);

    // The captured channel object is still usable, so the reply lands there rather than through a
    // fetch, and the reference is what makes it a reply at all.
    expect(sent).not.toBeNull();
    expect(replySends).toHaveLength(1);
    expect(replySends[0]).toMatchObject({
      content: "hello",
      reply: { messageReference: SOURCE_MESSAGE_ID, failIfNotExists: false },
    });
    expect(state.hasRepliedToOriginalMessage).toBe(true);
    expect(stopCalls).toEqual([]);
    expect(fetchedChannels).toEqual([]);
    // The cache-dependent path was never taken.
    expect(source.replyCalls).toBe(0);
  });

  it("falls back to a REST lookup when the captured channel cannot send", async () => {
    const { updater } = makeUpdater();
    const replySends: unknown[] = [];
    const fetchedChannels: string[] = [];
    const source = makeUncachedSourceMessage();

    const context = {
      // A partial channel: it exposes an id but no send surface.
      channel: { id: CHANNEL_ID },
      client: {
        channels: {
          cache: new Map(),
          fetch: async (id: string) => {
            fetchedChannels.push(id);
            return {
              id,
              send: async (payload: unknown) => {
                replySends.push(payload);
                return {};
              },
            };
          },
        },
      },
      replyToMessage: source.message,
      locale: "en-US",
      suppressUserErrors: false,
      tomoriState: { is_alter: false, config: {} },
    } as unknown as StreamContext;

    const sent = await updater.sendSinglePayload({ content: "hello" }, "hello", context, createDefaultStreamState());

    expect(sent).not.toBeNull();
    expect(fetchedChannels).toEqual([CHANNEL_ID]);
    expect(replySends[0]).toMatchObject({ reply: { messageReference: SOURCE_MESSAGE_ID } });
  });
});

describe("a deleted destination channel", () => {
  it("stops the stream quietly instead of throwing", async () => {
    const { updater, stopCalls } = makeUpdater();
    const source = makeUncachedSourceMessage();

    const context = {
      channel: { id: CHANNEL_ID },
      client: {
        channels: {
          cache: new Map(),
          fetch: async () => {
            throw Object.assign(new Error("Unknown Channel"), { code: 10003 });
          },
        },
      },
      replyToMessage: source.message,
      locale: "en-US",
      suppressUserErrors: false,
      tomoriState: { is_alter: false, config: {} },
    } as unknown as StreamContext;

    const sent = await updater.sendSinglePayload({ content: "hello" }, "hello", context, createDefaultStreamState());

    // Resolving null rather than throwing is what keeps one deletion from becoming an error burst
    // across the orchestrator, the generation turn, and the queue.
    expect(sent).toBeNull();
    expect(stopCalls).toEqual([{ channelId: CHANNEL_ID, requesterId: "channel_deleted" }]);
    expect(source.replyCalls).toBe(0);
  });
});
