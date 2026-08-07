import { ApplicationFlags, Client, GatewayIntentBits, Partials, REST, Routes } from "discord.js";
import { log } from "@/utils/misc/logger";
import type { AppEnvironment } from "@/types/config";

/**
 * Resolves whether the privileged GuildPresences intent should be requested,
 * preferring Discord's own approval state so the bot self-heals with no manual
 * configuration.
 *
 * GuildPresences is a privileged intent: requesting it without Discord's
 * approval makes the gateway reject the entire connection (DisallowedIntents /
 * WS close 4014). To avoid that (and a failed-then-retried connection), we ask
 * Discord up front whether the intent is enabled for this application.
 *
 * Resolution order:
 *   1. Live probe of the application's gateway flags via REST `GET /applications/@me`.
 *      `GatewayPresence` (approved for 100+ guild bots) or `GatewayPresenceLimited`
 *      (enabled for <100 guild bots) means the intent is safe to request. The moment
 *      Discord grants approval, so this flips on the next restart, no code change.
 *   2. On probe failure (e.g. network/REST error), fall back to the legacy default:
 *      enabled outside production, disabled in production.
 *
 * @param environment - Resolved runtime environment (used only for the fallback)
 * @returns true if the GuildPresences intent should be included
 */
export async function resolvePresenceIntentEnabled(environment: AppEnvironment): Promise<boolean> {
  // Legacy behavior is the safety net if we cannot reach Discord to probe.
  const legacyDefault = environment !== "production";

  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    log.warn("Cannot probe Presence Intent approval (DISCORD_TOKEN unset); using default");
    return legacyDefault;
  }

  // Ask Discord which privileged gateway intents this application is approved for.
  try {
    const rest = new REST().setToken(token);
    const application = (await rest.get(Routes.currentApplication())) as { flags?: number };
    const flags = application.flags ?? 0;
    // Either flag indicates the Presence Intent is enabled/approved for this bot.
    const presenceApproved =
      (flags & ApplicationFlags.GatewayPresence) !== 0 || (flags & ApplicationFlags.GatewayPresenceLimited) !== 0;
    log.info(
      `Presence Intent approval probe: ${presenceApproved ? "approved" : "not approved"} (application flags=${flags})`,
    );
    return presenceApproved;
  } catch (error) {
    // Probe failed, so degrade to the legacy default rather than risk a 4014.
    log.warn("Failed to probe Presence Intent approval; using default", error);
    return legacyDefault;
  }
}

/**
 * Creates and configures the Discord.js client with appropriate intents,
 * cache sweepers, and process-level error handlers.
 *
 * The privileged GuildPresences intent is included only when
 * {@link resolvePresenceIntentEnabled} reports it as enabled. Downstream
 * consumers (e.g. the context builder) detect its presence via
 * `client.options.intents.has(GatewayIntentBits.GuildPresences)` and degrade
 * gracefully when it is absent, so flipping it requires no other changes.
 *
 * @param includePresences - Whether to request the privileged GuildPresences intent
 * @returns Configured Discord.js Client (not yet logged in)
 */
export function createDiscordClient(includePresences: boolean): Client {
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

  // GuildPresences is privileged, so request it only when Discord has approved it
  // (or it is force-enabled). See resolvePresenceIntentEnabled.
  if (includePresences) {
    intents.push(GatewayIntentBits.GuildPresences);
  }

  const client = new Client({
    intents,
    partials: [Partials.Channel, Partials.Message],
    sweepers: {
      messages: {
        interval: 3600, // Run sweep every 1 hour (in seconds)
        lifetime: 1800, // Keep messages for 30 minutes (in seconds)
      },
      // Never sweep the client's own member: discord.js resolves permissions through it.
      // Voice paths read members synchronously with no fetch fallback.
      guildMembers: {
        interval: 3600,
        filter: () => (member) => member.id !== member.client.user.id && !member.voice.channelId,
      },
      users: {
        interval: 3600,
        filter: () => (user) => user.bot,
      },
      // Presence data is gateway-only with no REST fetch, so a swept entry stays missing until
      // that user's next presence change. Offline-with-no-activity is the only safe set to drop:
      // getUserPresenceDetails renders a cached offline presence as "Offline" and a missing one as
      // "Offline or status unknown", so the information lost is nil. Widening this filter to
      // idle/dnd or to entries carrying activities would silently degrade what Tomori can see.
      presences: {
        interval: 3600,
        filter: () => (presence) => presence.status === "offline" && presence.activities.length === 0,
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
    // Don't exit process for WebSocket errors, so let Discord.js reconnect
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
