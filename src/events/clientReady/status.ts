import { type ActivityOptions, ActivityType, type Client } from "discord.js";
// biome-ignore lint/correctness/noUnusedImports: For package version tagging in status
import _pkg from "../../../package.json";
import { log } from "@/utils/misc/logger";
import { isPrimaryProcess } from "@/utils/cluster/shardLeases";
import { getShardTopology } from "@/utils/discord/shardOwnership";
import { metricSampleRepository } from "@/utils/db/repositories/MetricSampleRepository";

const CYCLE_DELAY = 60000;

// Tomori's character birthday is May 11 (Date.getMonth is 0-indexed).
const BIRTHDAY_MONTH = 4;
const BIRTHDAY_DAY = 11;

function isTomoriBirthday(): boolean {
  const now = new Date();
  return now.getMonth() === BIRTHDAY_MONTH && now.getDate() === BIRTHDAY_DAY;
}

async function postTopggStats(client: Client, serverCount: number): Promise<boolean> {
  const isProduction = process.env.NODE_ENV === "production";
  const topggToken = process.env.TOPGG_TOKEN;

  if (!isProduction || !topggToken || !client.user || !isPrimaryProcess()) return false;

  const botId = client.user.id;

  try {
    const response = await fetch(`https://top.gg/api/bots/${botId}/stats`, {
      method: "POST",
      headers: {
        Authorization: topggToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ server_count: serverCount }),
    });

    if (!response.ok) {
      log.warn(`Top.gg stats update failed: HTTP ${response.status}`, {
        errorType: "TopggApiError",
        metadata: { status: response.status, botId, serverCount },
      });
    } else {
      log.info(`Top.gg stats updated: ${serverCount} server(s)`);
    }
  } catch (error) {
    log.warn("Top.gg stats update failed (non-critical)", {
      errorType: "TopggNetworkError",
      metadata: { error },
    });
  }
  return true;
}

const handler = async (client: Client): Promise<void> => {
  log.section(`Launching ${client.user?.tag} on Discord...`);

  log.success(`${client.user?.tag} up and running!`);

  log.section("Listening for error and info logs...");
  log.info(`Time started: [${new Date().toLocaleTimeString()}]`);

  const birthdayStatus: ActivityOptions = {
    name: "Celebrating my birthday!",
    type: ActivityType.Streaming,
    // Discord requires a YouTube or Twitch URL for ActivityType.Streaming.
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  };

  let topggPosted = false;
  let updating = false;
  async function updateStatus(): Promise<void> {
    if (!client.user || updating) return;

    const isProduction = process.env.NODE_ENV === "production";
    if (!isProduction) {
      return;
    }

    updating = true;
    try {
      const topology = getShardTopology();
      const serverCount = topology.ownsAllShards()
        ? client.guilds.cache.size
        : await metricSampleRepository.getClusterGuildCount(topology);
      if (!topggPosted && serverCount !== null && isPrimaryProcess()) {
        topggPosted = await postTopggStats(client, serverCount);
      }
      if (isTomoriBirthday()) {
        client.user.setActivity(birthdayStatus);
      } else {
        const normalStatus: ActivityOptions[] = [
          {
            name: "Optimized! /update",
            type: ActivityType.Playing,
          },
        ];
        if (serverCount !== null) {
          normalStatus.push({
            name: `Listening for /help in ${serverCount} servers`,
            type: ActivityType.Listening,
          });
        }
        const random = Math.floor(Math.random() * normalStatus.length);
        client.user.setActivity(normalStatus[random]);
      }
    } finally {
      updating = false;
    }
  }

  await updateStatus();

  setInterval(() => {
    void updateStatus();
  }, CYCLE_DELAY);
};

export default handler;
