import type { Client, Guild, TextChannel } from "discord.js";
import { log } from "../misc/logger";

async function getChannelActivity(channel: TextChannel): Promise<number> {
  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    return messages.filter((msg) => !msg.author.bot && msg.createdTimestamp > oneDayAgo).size;
  } catch {
    return 0;
  }
}

export async function findBestChannel(guild: Guild, client: Client): Promise<TextChannel | null> {
  try {
    const textChannels = guild.channels.cache
      .filter(
        (ch): ch is TextChannel =>
          ch.isTextBased() &&
          // biome-ignore lint/style/noNonNullAssertion: Client user is guaranteed to exist here
          !!ch.permissionsFor(client.user!)?.has(["ViewChannel", "SendMessages", "EmbedLinks"]),
      )
      .sort((a, b) => a.position - b.position);

    if (textChannels.size === 0) return null;

    const channelActivity = new Map<TextChannel, number>();
    for (const channel of textChannels.values()) {
      const activity = await getChannelActivity(channel);
      channelActivity.set(channel, activity);
    }

    return (
      [...channelActivity.entries()].sort(([ch1, act1], [ch2, act2]) => {
        if (act1 !== act2) return act2 - act1;
        return ch1.position - ch2.position;
      })[0]?.[0] ?? null
    );
  } catch (error) {
    log.error("Error finding best channel:", error);
    return null;
  }
}
