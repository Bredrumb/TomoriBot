import { ApplicationFlags, Client, GatewayIntentBits, Options, Partials, REST, Routes } from "discord.js";
import { log } from "@/utils/misc/logger";
import { setHistoryWindowGatewayConnected } from "@/utils/chat/historyWindow";
import { healthTracker } from "@/utils/misc/healthTracker";
import type { AppEnvironment } from "@/types/config";
import { shouldRejectWebhookRateLimit } from "@/utils/discord/webhook/avatarEditRateLimit";
import { discordPresenceRetention, type DiscordPresenceRetention } from "@/utils/cache/discordPresenceRetention";
import { initializeShardTopology, type ShardTopology } from "@/utils/discord/shardOwnership";
import { buildIdentifyThrottler } from "@/utils/cluster/identifyThrottler";

// Non-101 edge errors are retried because unhealthy gateway edges fail at transport, whereas rejected tokens or
// unapproved intents cannot self-heal.
export function isTransientGatewayError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  if (message.includes("expected 101 status code")) return true;
  if (message.includes("disallowed intents") || message.includes("privileged intent")) return false;
  if (message.includes("invalid token") || message.includes("unauthorized")) return false;

  const code = (error as { code?: unknown }).code;
  if (code === "DisallowedIntents" || code === "TokenInvalid" || code === "InvalidToken") return false;

  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return status >= 500 || status === 408 || status === 429;

  return (
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("socket hang up") ||
    message.includes("socket closed") ||
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("timeout") ||
    message.includes("websocket") ||
    message.includes("429")
  );
}

// Application flags are probed up front because requesting GuildPresences without Discord approval rejects the whole
// gateway connection (close 4014).
export async function resolvePresenceIntentEnabled(environment: AppEnvironment): Promise<boolean> {
  // Legacy behavior is the safety net if we cannot reach Discord to probe.
  const legacyDefault = environment !== "production";

  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    log.warn("Cannot probe Presence Intent approval (DISCORD_TOKEN unset); using default");
    return legacyDefault;
  }

  try {
    const rest = new REST().setToken(token);
    const application = (await rest.get(Routes.currentApplication())) as { flags?: number };
    const flags = application.flags ?? 0;
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

export function createDiscordClient(
  includePresences: boolean,
  presenceRetention: DiscordPresenceRetention = discordPresenceRetention,
  topology: ShardTopology = initializeShardTopology(),
  shutdownSignal: AbortSignal = new AbortController().signal,
): Client {
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

  // GuildPresences is privileged, so request it only when approved by Discord or force-enabled.
  if (includePresences) {
    intents.push(GatewayIntentBits.GuildPresences);
  }

  const client: Client = new Client({
    ...topology.getClientShardOptions(),
    ...(!topology.ownsAllShards() ? { ws: { buildIdentifyThrottler: buildIdentifyThrottler(shutdownSignal) } } : {}),
    intents,
    partials: [Partials.Channel, Partials.Message],
    rest: { rejectOnRateLimit: shouldRejectWebhookRateLimit },
    // Cache 50 messages per channel so recent reply targets avoid REST fetches; readers fall back to fetch on miss.
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 50,
      PresenceManager: {
        maxSize: 0,
        keepOverLimit: (presence) =>
          presence.guild !== null && presenceRetention.has(presence.guild.id, presence.userId),
      },
    }),
    sweepers: {
      // Intervals and lifetimes in discord.js sweepers are in seconds.
      messages: {
        interval: 3600,
        lifetime: 1800,
      },
      // Never sweep the client's own member (used for permission resolution) or voice-connected members (read
      // synchronously).
      guildMembers: {
        interval: 3600,
        filter: () => (member) => member.id !== member.client.user.id && !member.voice.channelId,
      },
      // A cached member holds its own User reference, so evicting a member's user frees nothing;
      // the users worth evicting are the ones presence updates cache for members never stored.
      users: {
        interval: 3600,
        filter: () => {
          const memberIds = new Set<string>();
          for (const guild of client.guilds.cache.values()) {
            for (const memberId of guild.members.cache.keys()) memberIds.add(memberId);
          }
          return (user) => user.id !== client.user?.id && !memberIds.has(user.id);
        },
      },
      // Presences have no REST fallback, so only sweep offline entries with no activities (rendered identically when
      // absent).
      presences: {
        interval: 3600,
        filter: () => (presence) => presence.status === "offline" && presence.activities.length === 0,
      },
    },
  });

  healthTracker.initialize(client, topology);

  client.on("error", (error) => {
    log.error("Discord client error occurred", error);
  });

  // Rate-limit gateway errors per outage so repeated reconnect failures stay at warn level instead of flooding
  // error_logs.
  const gatewayErrorReporter = createGatewayErrorReporter();
  client.on("shardError", (error, shardId) => {
    gatewayErrorReporter(error, shardId);
  });

  // Reset the error reporter only when a session connects (shardReady/shardResume), because resetting on disconnect
  // would re-arm errors mid-outage.
  client.on("shardReady", (shardId) => {
    setHistoryWindowGatewayConnected(shardId, true);
    gatewayErrorReporter.reset(shardId);
    healthTracker.recordGatewayConnected(shardId);
    log.rateLimit(`Discord gateway shard ready (shard ${shardId})`, { shardId });
  });

  client.on("shardResume", (shardId, replayedEvents) => {
    setHistoryWindowGatewayConnected(shardId, true);
    gatewayErrorReporter.reset(shardId);
    healthTracker.recordGatewayConnected(shardId);
    log.rateLimit(`Discord gateway session resumed (shard ${shardId})`, { shardId, replayedEvents });
  });

  client.on("shardDisconnect", (event, shardId) => {
    setHistoryWindowGatewayConnected(shardId, false);
    healthTracker.recordGatewayDisconnected(shardId);
    log.rateLimit(`Discord gateway disconnected (shard ${shardId})`, {
      code: event.code,
      reason: event.reason ?? "",
      wasClean: event.wasClean,
    });
  });

  client.on("shardReconnecting", (shardId) => {
    setHistoryWindowGatewayConnected(shardId, false);
    healthTracker.recordGatewayDisconnected(shardId);
    log.rateLimit(`Discord gateway reconnecting (shard ${shardId})`, { shardId });
  });

  client.on("invalidated", () => {
    log.warn("Discord session invalidated; discord.js will reconnect with a new session");
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

// Shard errors are logged once per outage because discord.js retries failed handshakes on its own and repeats the
// same error row.
function createGatewayErrorReporter(): ((error: unknown, shardId: number) => void) & {
  reset: (shardId: number) => void;
} {
  const reported = new Set<number>();

  const report = (error: unknown, shardId: number) => {
    healthTracker.recordGatewayFailure(shardId);
    const metadata = { shardId, reason: error instanceof Error ? error.message : String(error) };

    if (!reported.has(shardId)) {
      reported.add(shardId);
      log.error(
        `Discord WebSocket shard error occurred (shard ${shardId}); further attempts for this shard stay at warn level until it connects`,
        error,
      );
      return;
    }

    log.warn(`Discord WebSocket shard error repeated (shard ${shardId})`, error instanceof Error ? error : undefined, {
      errorType: "DiscordGatewayError",
      metadata,
    });
  };

  report.reset = (shardId: number) => {
    reported.delete(shardId);
  };

  return report;
}
