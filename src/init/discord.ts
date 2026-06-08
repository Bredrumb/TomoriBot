import { Client, GatewayIntentBits, Partials } from "discord.js";
import { log } from "@/utils/misc/logger";
import type { AppEnvironment } from "@/types/config";

/**
 * Creates and configures the Discord.js client with appropriate intents,
 * cache sweepers, and process-level error handlers.
 *
 * GuildPresences intent is excluded in production (not approved for production bots).
 *
 * @param environment - Resolved runtime environment
 * @returns Configured Discord.js Client (not yet logged in)
 */
export function createDiscordClient(environment: AppEnvironment): Client {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildExpressions,
  ];

  // GuildPresences intent only available in non-production (rejected for production approval)
  if (environment !== "production") {
    intents.push(GatewayIntentBits.GuildPresences);
  }

  const client = new Client({
    intents,
    partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
    sweepers: {
      messages: {
        interval: 3600, // Run sweep every 1 hour (in seconds)
        lifetime: 1800, // Keep messages for 30 minutes (in seconds)
      },
      users: {
        interval: 3600,
        filter: () => (user) => user.bot,
      },
    },
  });

  client.on("error", (error) => {
    log.error("Discord client error occurred", error);
  });

  client.on("shardError", (error) => {
    log.error("Discord WebSocket shard error occurred", error);
  });

  process.on("uncaughtException", (error) => {
    log.error("Uncaught exception occurred", error);
    // Don't exit process for WebSocket errors — let Discord.js reconnect
    if (error.message?.includes("error is not an Object")) {
      log.warn("WebSocket error caught - Discord.js will attempt to reconnect");
      return;
    }
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    log.error("Unhandled promise rejection", reason, {
      errorType: "UnhandledPromiseRejection",
      metadata: { promise: promise.toString() },
    });
  });

  return client;
}
