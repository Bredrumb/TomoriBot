import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { PassThrough } from "node:stream";
import { ChannelType, Client, DMChannel, Guild, Message, TextChannel, Webhook } from "discord.js";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import {
  abortChannelTurns,
  channelLocks,
  enqueueBusyChannelMessage,
  getChannelTurnAbortSignal,
  runWithChannelLock,
  setChannelStreamKill,
} from "@/utils/chat/channelQueue";
import type { RunnableChatAdmission } from "@/utils/chat/types";
import { ShardLeaseCoordinator } from "@/utils/cluster/shardLeases";
import * as leases from "@/utils/cluster/shardLeases";
import type { CoordinationClock, LeaseStore } from "@/utils/cluster/leaseKeeper";
import * as ownership from "@/utils/discord/shardOwnership";
import {
  runWithWebhookIdentity,
  sendWebhookMessagesWithIdentity,
  sendUserTranscriptViaWebhook,
} from "@/utils/discord/webhook/webhookCore";
import { stubLogMembers } from "../../helpers/mockSurface";
import { sendChannelMessageOnce } from "@/utils/discord/webhook/singleAttemptMessage";

stubLogMembers({ info: () => {}, warn: () => {}, metric: () => {}, error: async () => {} });
const restores: Array<() => void> = [];
const clients: Client[] = [];
const coordinators: ShardLeaseCoordinator[] = [];

afterEach(async () => {
  abortChannelTurns();
  channelLocks.clear();
  for (const coordinator of coordinators.splice(0)) await coordinator.stop();
  for (const restore of restores.splice(0).reverse()) restore();
  for (const client of clients.splice(0)) await client.destroy();
});

async function fixture(ids = "0") {
  let now = 0;
  let renewal: "ok" | "uncertain" | "lost" | "pending" = "ok";
  const timers = new Set<{ at: number; callback: () => void }>();
  const clock: CoordinationClock = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    schedule: (callback, ms) => {
      const timer = { at: now + ms, callback };
      timers.add(timer);
      return () => {
        timers.delete(timer);
      };
    },
  };
  const repository: LeaseStore = {
    takeIfExpired: async () => ({ token: "1" }),
    renew: async (_name, _holder, _token, _ttl, signal) => {
      if (renewal === "pending")
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      if (renewal === "uncertain") throw new Error("Controlled renewal failure");
      return renewal === "lost" ? null : { token: "1" };
    },
    release: async () => true,
  };
  const topology = ownership.parseShardTopology({ SHARD_COUNT: "2", SHARD_IDS: ids });
  const loss = mock(() => {});
  const coordinator = new ShardLeaseCoordinator(topology, { onLost: loss, onStateChange: () => {} }, repository, clock);
  coordinators.push(coordinator);
  const spies = [
    spyOn(ownership, "getShardTopology").mockReturnValue(topology),
    spyOn(leases, "hasShardLeaseOwnership").mockImplementation(() => coordinator.hasOwnership()),
    spyOn(leases, "getOwnerWorkSignal").mockImplementation(() => coordinator.workSignal),
  ];
  for (const spy of spies) restores.push(() => spy.mockRestore());
  await coordinator.acquire(new AbortController().signal);
  const client = new Client({ intents: [] });
  clients.push(client);
  const guild: Guild = Reflect.construct(Guild, [client, { id: "1200000000004194304", name: "Fixture" }]);
  const channel: TextChannel = Reflect.construct(TextChannel, [
    guild,
    { id: "1400000000000000000", type: ChannelType.GuildText, name: "chat" },
    client,
  ]);
  const foreign: Guild = Reflect.construct(Guild, [client, { id: "1200000000000000000", name: "Foreign" }]);
  const foreignChannel: TextChannel = Reflect.construct(TextChannel, [
    foreign,
    { id: "1400000000004194304", type: ChannelType.GuildText, name: "foreign" },
    client,
  ]);
  const dm: DMChannel = Reflect.construct(DMChannel, [client, { id: "1400000000008388608", type: ChannelType.DM }]);
  for (const target of [channel, foreignChannel, dm]) client.channels.cache.set(target.id, target);
  for (const target of [guild, foreign]) client.guilds.cache.set(target.id, target);
  function admission(target: TextChannel | DMChannel = channel, skipLock = false): RunnableChatAdmission {
    const message: Message = Reflect.construct(Message, [
      client,
      {
        id: "1500000000000000000",
        channel_id: target.id,
        guild_id: target instanceof TextChannel ? target.guildId : undefined,
        author: { id: "1300000000000000000", username: "Juno", discriminator: "0", avatar: null },
        content: "hello",
        type: 0,
      },
      target,
    ]);
    return {
      incoming: normalizeChatInvocation({ client, message, isFromQueue: false, skipLock }),
      disposition: "run",
      locale: "en-US",
      client,
      message,
      channel: target,
      referencedMessage: null,
    };
  }
  async function advance(mode: typeof renewal, ms = 10_000) {
    renewal = mode;
    now += ms;
    for (const timer of [...timers]) if (timer.at <= now && timers.delete(timer)) timer.callback();
    for (let index = 0; index < 12; index++) await Promise.resolve();
  }
  return { client, guild, channel, foreignChannel, dm, admission, advance, coordinator, loss };
}

const options = { handleStopResponse: async () => {}, processQueuedMessage: async () => {} };

describe("live shard ownership", () => {
  it("rejects foreign guilds and admits DMs only on shard zero", async () => {
    const f = await fixture("1");
    const callback = mock(async () => true);
    expect(await runWithChannelLock(f.admission(f.channel), callback, options)).toBeUndefined();
    expect(await runWithChannelLock(f.admission(f.dm), callback, options)).toBeUndefined();
    expect(await runWithChannelLock(f.admission(f.foreignChannel), callback, options)).toBe(true);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(() => sendChannelMessageOnce(f.dm, { content: "hello" }, () => {})).toThrow();
  });

  it("admits owned guilds and DMs while refusing re-entry without a live outer turn", async () => {
    const f = await fixture();
    const callback = mock(async () => true);
    expect(await runWithChannelLock(f.admission(f.channel, true), callback, options)).toBeUndefined();
    expect(await runWithChannelLock(f.admission(), callback, options)).toBe(true);
    expect(await runWithChannelLock(f.admission(f.dm), callback, options)).toBe(true);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it.each(["uncertain", "lost"] as const)("aborts active owner work and queued replay on %s renewal", async (state) => {
    const f = await fixture();
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const kill = mock(() => {});
    const replay = mock(async () => {});
    const work = runWithChannelLock(
      f.admission(),
      async () => {
        setChannelStreamKill(f.channel.id, kill);
        const entry = channelLocks.get(f.channel.id);
        if (!entry) throw new Error("Missing active turn");
        enqueueBusyChannelMessage({
          channelId: f.channel.id,
          lockEntry: entry,
          queuedMessage: { message: f.admission().message },
          simulatedAutochatCounterReset: false,
        });
        entered.resolve();
        await finish.promise;
      },
      { ...options, processQueuedMessage: replay },
    );
    await entered.promise;
    const turnSignal = getChannelTurnAbortSignal(f.channel.id);
    await f.advance(state);
    expect(turnSignal?.aborted).toBe(true);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(channelLocks.get(f.channel.id)?.messageQueue).toEqual([]);
    expect(await runWithChannelLock(f.admission(f.channel, true), async () => true, options)).toBeUndefined();
    finish.resolve();
    await work;
    expect(replay).not.toHaveBeenCalled();
    expect(f.loss.mock.calls.length).toBe(state === "lost" ? 1 : 0);
    if (state === "uncertain") {
      await f.advance("ok");
      expect(await runWithChannelLock(f.admission(), async () => true, options)).toBe(true);
    }
  });

  it("cancels a queued avatar continuation permanently through ownership recovery", async () => {
    const f = await fixture();
    const webhook: Webhook = Reflect.construct(Webhook, [
      f.client,
      {
        id: "1600000000000000000",
        type: 1,
        guild_id: f.guild.id,
        channel_id: f.channel.id,
        token: "fixture-token",
        avatar: null,
        name: "Fixture",
      },
    ]);
    const patch = Promise.withResolvers<Webhook>();
    const editing = Promise.withResolvers<void>();
    const edit = spyOn(webhook, "edit").mockImplementation(async () => {
      editing.resolve();
      return patch.promise;
    });
    restores.push(() => edit.mockRestore());
    const send = mock(async () => true);
    const outcome = runWithWebhookIdentity(webhook, { avatarDataUri: "data:image/png;base64,AAAA" }, send).then(
      () => "sent",
      () => "cancelled",
    );
    await editing.promise;
    await f.advance("uncertain");
    await f.advance("ok");
    patch.resolve(webhook);
    expect(await outcome).toBe("cancelled");
    expect(send).not.toHaveBeenCalled();
    expect(edit).toHaveBeenCalledTimes(1);
    expect(await runWithWebhookIdentity(webhook, { avatarUrl: "https://example.invalid/avatar.png" }, send)).toBe(true);
  });

  it("aborts an active turn at the local safety deadline while renewal remains pending", async () => {
    const f = await fixture();
    const finish = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const work = runWithChannelLock(
      f.admission(),
      async () => {
        entered.resolve();
        await finish.promise;
      },
      options,
    );
    await entered.promise;
    const signal = getChannelTurnAbortSignal(f.channel.id);
    await f.advance("pending");
    expect(signal?.aborted).toBe(false);
    await f.advance("pending", 15_000);
    expect(signal?.aborted).toBe(true);
    expect(f.coordinator.hasOwnership()).toBe(false);
    expect(f.loss).not.toHaveBeenCalled();
    finish.resolve();
    await work;
  });

  it("checks ownership between batch sends and rejects foreign transcript delivery", async () => {
    const f = await fixture();
    const webhook: Webhook = Reflect.construct(Webhook, [
      f.client,
      {
        id: "1600000000000000000",
        type: 1,
        guild_id: f.guild.id,
        channel_id: f.channel.id,
        token: "fixture-token",
        avatar: null,
        name: "Fixture",
      },
    ]);
    const send = spyOn(webhook, "send").mockImplementation(async () => {
      await f.advance("uncertain");
      const message = f.admission().message;
      if (!message.inGuild()) throw new Error("Missing fixture guild");
      return message;
    });
    restores.push(() => send.mockRestore());
    await expect(sendWebhookMessagesWithIdentity(webhook, [{ content: "one" }, { content: "two" }])).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
    await f.advance("ok");
    const fetch = spyOn(f.foreignChannel, "fetchWebhooks");
    restores.push(() => fetch.mockRestore());
    await expect(
      sendUserTranscriptViaWebhook(f.foreignChannel, "Juno", "https://example.invalid/avatar.png", "hello"),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks a bot POST whose attachment finishes after ownership was lost and recovered", async () => {
    const f = await fixture();
    const stream = new PassThrough();
    const reading = Promise.withResolvers<void>();
    const read = stream._read.bind(stream);
    const readingSpy = spyOn(stream, "_read").mockImplementation((size) => {
      reading.resolve();
      read(size);
    });
    restores.push(() => readingSpy.mockRestore());
    const post = spyOn(f.client.rest, "post").mockResolvedValue({
      id: "1700000000000000000",
      channel_id: f.channel.id,
      guild_id: f.guild.id,
      author: { id: "1800000000000000000", username: "Fixture", discriminator: "0", avatar: null },
      content: "hello",
      type: 0,
      timestamp: new Date().toISOString(),
      attachments: [],
      embeds: [],
    });
    restores.push(() => post.mockRestore());
    const pending = sendChannelMessageOnce(
      f.channel,
      { files: [{ attachment: stream, name: "fixture.txt" }] },
      () => {},
    ).then(
      () => null,
      (error: unknown) => error,
    );
    await reading.promise;
    await f.advance("uncertain");
    await f.advance("ok");
    stream.end("fixture");
    const error = await pending;
    expect(error).toMatchObject({ outcome: "pre_dispatch" });
    expect(post).not.toHaveBeenCalled();
    const delivered = await sendChannelMessageOnce(f.channel, { content: "hello" }, () => {});
    expect(delivered.id).toBe("1700000000000000000");
    expect(post).toHaveBeenCalledTimes(1);
  });
});
