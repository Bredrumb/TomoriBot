import type { Client, RateLimitData } from "discord.js";
import { log } from "@/utils/misc/logger";

export default async (_client: Client, rateLimitData: RateLimitData): Promise<void> => {
  log.rateLimit("Discord API rate limit hit", {
    timeToReset: `${rateLimitData.timeToReset}ms`,
    limit: rateLimitData.limit,
    method: rateLimitData.method,
    url: rateLimitData.url,
    route: rateLimitData.route,
    global: rateLimitData.global,
  });
};
