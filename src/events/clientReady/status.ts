import { type ActivityOptions, ActivityType, type Client } from "discord.js";
// biome-ignore lint/correctness/noUnusedImports: For package version tagging in status
import _pkg from "../../../package.json";
import { log } from "@/utils/misc/logger";
import { isPrimaryProcess } from "@/utils/cluster/shardLeases";
import { getShardTopology } from "@/utils/discord/shardOwnership";
import { metricSampleRepository } from "@/utils/db/repositories/MetricSampleRepository";

// Cycle delay in milliseconds (1 minute)
const CYCLE_DELAY = 60000;

// Tomori's birthday (May 11)
const BIRTHDAY_MONTH = 4; // 0-indexed (April = 3, May = 4)
const BIRTHDAY_DAY = 11;

/**
 * Checks if today is Tomori's birthday (May 11).
 * @returns {boolean} True if today is May 11, false otherwise.
 */
function isTomoriBirthday(): boolean {
  const now = new Date();
  return now.getMonth() === BIRTHDAY_MONTH && now.getDate() === BIRTHDAY_DAY;
}

/**
 * Posts the current Discord guild count to Top.gg once during startup.
 * Only runs in production and only when TOPGG_TOKEN is configured.
 * Non-critical, so failures are logged as warnings and do not affect startup.
 *
 * @param client - The Discord client instance (must be ready, provides bot ID and guild cache).
 */
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

/**
 * Sets the bot's status and logs startup information.
 */
const handler = async (client: Client): Promise<void> => {
  log.section(`Launching ${client.user?.tag} on Discord...`);

  log.success(`${client.user?.tag} up and running!`);

  log.section("Listening for error and info logs...");
  log.info(`Time started: [${new Date().toLocaleTimeString()}]`);

  const birthdayStatus: ActivityOptions = {
    name: "Celebrating my birthday!",
    type: ActivityType.Streaming,
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // Required for Streaming type
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
    void updateStatus(); // Use void to indicate intentional fire-and-forget
  }, CYCLE_DELAY);
};

export default handler;
