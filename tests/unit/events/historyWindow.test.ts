import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Client, GatewayDispatchPayload, Message } from "discord.js";
import { Collection, GatewayDispatchEvents } from "discord.js";
import recordDeletion from "@/events/messageDelete/00_historyWindow";
import recordBulkDeletion from "@/events/messageDeleteBulk/historyWindow";
import recordUpdate from "@/events/messageUpdate/historyWindow";
import recordReaction from "@/events/raw/historyWindow";
import { channelLocks, getOrCreateChannelLockEntry } from "@/utils/chat/channelQueue";
import { readChannelHistory } from "@/utils/chat/historyWindow";

const CHANNEL_ID = "fixture-history-events";

function createEventFixture() {
  const cached = { id: "100", channelId: CHANNEL_ID, content: "cached", partial: false } as Message;
  const uncached = { id: "101", channelId: CHANNEL_ID, content: "uncached", partial: false } as Message;
  const cache = new Collection([[cached.id, cached]]);
  const rest = new Collection([
    [uncached.id, uncached],
    [cached.id, cached],
  ]);
  const fetch = mock(async () => new Collection(rest));
  const channel = {
    id: CHANNEL_ID,
    isTextBased: () => true,
    messages: { cache, fetch },
  } as unknown as Message["channel"];
  const client = { channels: { cache: new Map([[CHANNEL_ID, channel]]) } } as unknown as Client;
  getOrCreateChannelLockEntry(CHANNEL_ID, "fixture-guild").isLocked = true;
  return { cached, uncached, cache, rest, fetch, channel, client };
}

describe("history gateway signals", () => {
  afterEach(() => {
    channelLocks.delete(CHANNEL_ID);
  });

  it("drops single and bulk deletions without REST when the channel has no older history", async () => {
    const fixture = createEventFixture();
    await readChannelHistory(fixture.channel, 80, false);
    fixture.cache.delete(fixture.cached.id);
    await recordDeletion(fixture.client, fixture.cached);
    expect((await readChannelHistory(fixture.channel, 80, true)).map((message) => message.id)).toEqual([
      fixture.uncached.id,
    ]);
    await recordBulkDeletion(fixture.client, new Collection([[fixture.uncached.id, fixture.uncached]]));
    expect(await readChannelHistory(fixture.channel, 80, true)).toEqual([]);
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
  });

  it("uses cached edits in place and refetches uncached edits", async () => {
    const fixture = createEventFixture();
    await readChannelHistory(fixture.channel, 80, false);
    fixture.cached.content = "edited";
    await recordUpdate(fixture.client, fixture.cached, fixture.cached);
    expect((await readChannelHistory(fixture.channel, 80, true))[0]).toBe(fixture.cached);
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
    await recordUpdate(fixture.client, fixture.uncached, fixture.uncached);
    await readChannelHistory(fixture.channel, 80, true);
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
  });

  it("remembers that an update was uncached before discord.js synthesized a cached partial", async () => {
    const fixture = createEventFixture();
    await readChannelHistory(fixture.channel, 80, false);
    await recordReaction(fixture.client, {
      op: 0,
      s: 1,
      t: GatewayDispatchEvents.MessageUpdate,
      d: {
        id: fixture.uncached.id,
        channel_id: CHANNEL_ID,
        content: "edited",
        author: { id: "fixture-juno", username: "Juno", discriminator: "0", avatar: null, global_name: null },
        timestamp: "2020-01-01T00:00:00.000Z",
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        mention_roles: [],
        attachments: [],
        embeds: [],
        pinned: false,
        type: 0,
      },
    });
    fixture.cache.set(fixture.uncached.id, fixture.uncached);
    await recordUpdate(fixture.client, fixture.uncached, fixture.uncached);
    await readChannelHistory(fixture.channel, 80, true);
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    "MESSAGE_REACTION_ADD",
    "MESSAGE_REACTION_REMOVE",
    "MESSAGE_REACTION_REMOVE_ALL",
    "MESSAGE_REACTION_REMOVE_EMOJI",
  ] as const)("observes %s even without typed reaction events for uncached messages", async (event) => {
    const fixture = createEventFixture();
    await readChannelHistory(fixture.channel, 80, false);
    const packet = (id: string) =>
      ({
        op: 0,
        s: 1,
        t: event,
        d: {
          channel_id: CHANNEL_ID,
          message_id: id,
          user_id: "fixture-user",
          emoji: { id: null, name: "❤" },
          burst: false,
          type: 0,
        },
      }) as GatewayDispatchPayload;
    await recordReaction(fixture.client, packet(fixture.cached.id));
    await readChannelHistory(fixture.channel, 80, true);
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
    await recordReaction(fixture.client, packet(fixture.uncached.id));
    await readChannelHistory(fixture.channel, 80, true);
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
  });
});
