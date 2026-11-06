import { ChannelType, Collection, Guild, Message, TextChannel } from "discord.js";
import { z } from "zod";
import { createDiscordClient } from "@/init/discord";
import { registerShutdown } from "@/init/shutdown";
import {
  initializeScheduledWorkCoordinator,
  runScheduledWorkNow,
  stopScheduledWorkCoordinator,
} from "@/timers/scheduledWorkCoordinator";
import { initializeShardTopology } from "@/utils/discord/shardOwnership";
import { acquireShardLeases, clusterHolderId, releaseShardLeases } from "@/utils/cluster/shardLeases";
import { startInvalidationBus, stopInvalidationBus } from "@/utils/cache/invalidationBus";
import { abortChannelTurns, runWithChannelLock } from "@/utils/chat/channelQueue";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import type { RunnableChatAdmission } from "@/utils/chat/types";
import { sql } from "@/utils/db/client";
import { statRepository } from "@/utils/db/repositories/StatRepository";
import { initializeLocalizer } from "@/utils/text/localizer";

const shard = z.enum(["0", "1"]).parse(Bun.argv[2]);
const topology = initializeShardTopology({ SHARD_COUNT: "2", SHARD_IDS: shard });
const guildId = shard === "0" ? "1200000000004194304" : "1200000000000000000";
const channelId = shard === "0" ? "1400000000000000000" : "1400000000004194304";
const lifetime = new AbortController();
const client = createDiscordClient(false, undefined, topology, lifetime.signal);
const guild: Guild = Reflect.construct(Guild, [client, { id: guildId, name: "Fixture", preferred_locale: "en-US" }]);
const channel: TextChannel = Reflect.construct(TextChannel, [
  guild,
  { id: channelId, type: ChannelType.GuildText, name: "fixture" },
  client,
]);
client.guilds.cache.set(guild.id, guild);
client.channels.cache.set(channel.id, channel);
let sequence = 0n;
const send = (type: string, details: Record<string, string | number> = {}) => {
  process.send?.({ type, guildId, ...details });
};
function message(): Message {
  return Reflect.construct(Message, [
    client,
    {
      id: String(1500000000000000000n + sequence++),
      channel_id: channelId,
      guild_id: guildId,
      type: 0,
      author: { id: "1300000000000000000", username: "Juno", discriminator: "0", avatar: null },
      content: "fixture",
    },
    channel,
  ]);
}
function admission(foreign = false): RunnableChatAdmission {
  const trigger = message();
  if (foreign)
    Object.defineProperty(trigger, "guildId", { value: shard === "0" ? "1200000000000000000" : "1200000000004194304" });
  return {
    incoming: normalizeChatInvocation({ client, message: trigger, isFromQueue: false }),
    disposition: "run",
    locale: "en-US",
    client,
    message: trigger,
    channel,
    referencedMessage: null,
  };
}
let channelFetches = 0;
Object.defineProperty(client.channels, "fetch", {
  value: async () => {
    if (++channelFetches % 2 === 1) throw new Error("Controlled reminder channel lookup failure");
    return channel;
  },
});
Object.defineProperty(channel.messages, "fetch", { value: async () => new Collection() });
Object.defineProperty(channel, "send", {
  value: async () => {
    send("delivery");
    return message();
  },
});
const shutdown = registerShutdown(client, {
  stopScheduledWork: () => {
    lifetime.abort();
    stopScheduledWorkCoordinator();
  },
  flushStats: () => statRepository.shutdown(),
  cleanupMcp: async () => {},
  cleanupCoordination: async () => {
    await Promise.all([stopInvalidationBus(), releaseShardLeases()]);
  },
});
send("acquiring", { holder: clusterHolderId });
if (
  !(await acquireShardLeases(
    {
      onLost: () => {
        void shutdown.shutdown({ immediate: true, exitCode: 1 });
      },
      onStateChange: (state) => {
        if (state === "uncertain") abortChannelTurns();
      },
    },
    lifetime.signal,
  ))
)
  throw new Error("Fixture acquisition failed");
await startInvalidationBus(sql, topology);
await initializeLocalizer();
send("ready", { holder: clusterHolderId });

const commands = z.object({ action: z.enum(["hold", "turn", "schedule", "foreign", "stop"]) });
process.on("message", (input: unknown) => {
  const command = commands.parse(input);
  void (async () => {
    if (command.action === "stop") {
      await shutdown.shutdown({ immediate: true });
      return;
    }
    if (command.action === "schedule") {
      initializeScheduledWorkCoordinator(client);
      await runScheduledWorkNow("two-process-exercise");
      stopScheduledWorkCoordinator();
      send("scheduled");
      return;
    }
    const accepted = await runWithChannelLock(
      admission(command.action === "foreign"),
      async () => {
        send("turn_started");
        if (command.action === "hold") await new Promise<void>(() => {});
        send("turn_done");
        return true;
      },
      { handleStopResponse: async () => {}, processQueuedMessage: async () => {} },
    );
    send("guarded", { accepted: accepted ? 1 : 0 });
  })().catch((error: unknown) => {
    send("failure", { name: error instanceof Error ? error.name : "unknown" });
    void shutdown.shutdown({ immediate: true, exitCode: 1 });
  });
});
