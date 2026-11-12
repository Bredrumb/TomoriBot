import { config } from "dotenv";
import { Routes } from "discord.js";
import { z } from "zod";
import { resolveEnvironment } from "@/types/config";
import { loadSecrets } from "@/init/secrets";
import { createDiscordClient, isTransientGatewayError, resolvePresenceIntentEnabled } from "@/init/discord";
import { initializeShardTopology } from "@/utils/discord/shardOwnership";
import { log } from "@/utils/misc/logger";

export async function startBot(): Promise<void> {
  config({ quiet: true });
  const environment = resolveEnvironment();
  const { readRecordingRetentionDays } = await import("@/modules/conversation-recording/config");
  readRecordingRetentionDays();
  const { getPrivateNetworkStartupError } = await import("@/utils/security/remoteUrlSecurity");
  const privateNetworkError = getPrivateNetworkStartupError();
  if (privateNetworkError) throw new Error(privateNetworkError);

  const { startHealthServer } = await import("@/init/healthServer");
  const healthPort = Number.parseInt(process.env.PORT ?? "8080", 10);
  if (environment === "production") startHealthServer(healthPort);
  await loadSecrets(environment);
  const topology = initializeShardTopology();
  const { isDatabaseSchemaManagementEnabled, initDatabase } = await import("@/init/database");
  const { assertBridgeTopology, initBridges, stopBridges } = await import("@/init/bridges");
  if (!topology.ownsAllShards() && isDatabaseSchemaManagementEnabled()) {
    throw new Error(
      "Subset shard processes require DATABASE_SCHEMA_MANAGEMENT_ENABLED=false; run schema management separately",
    );
  }
  assertBridgeTopology();

  const { initStartupBackup } = await import("@/init/backup");
  if (isDatabaseSchemaManagementEnabled()) await initStartupBackup(environment);
  const { registerHeapSnapshotHandler } = await import("@/init/heapSnapshot");
  registerHeapSnapshotHandler();
  const { initMediaProcessing } = await import("@/init/media");
  initMediaProcessing();

  const includePresences = await resolvePresenceIntentEnabled(environment);
  const lifetime = new AbortController();
  const client = createDiscordClient(includePresences, undefined, topology, lifetime.signal);
  const [
    { registerShutdown },
    { initTimers, stopTimers },
    { initializeScheduledWorkCoordinator, stopScheduledWorkCoordinator },
    { initializeShutdownInteractionAdmission },
    { statRepository },
    { healthTracker },
    { acquireShardLeases, hasShardLeaseOwnership, releaseShardLeases },
    { startInvalidationBus, stopInvalidationBus },
    { abortChannelTurns },
    { sql },
  ] = await Promise.all([
    import("@/init/shutdown"),
    import("@/init/timers"),
    import("@/timers/scheduledWorkCoordinator"),
    import("@/utils/discord/ui/interactionCore"),
    import("@/utils/db/repositories/StatRepository"),
    import("@/utils/misc/healthTracker"),
    import("@/utils/cluster/shardLeases"),
    import("@/utils/cache/invalidationBus"),
    import("@/utils/chat/channelQueue"),
    import("@/utils/db/client"),
  ]);
  initializeShutdownInteractionAdmission(client);
  const shutdown = registerShutdown(client, {
    stopScheduledWork: () => {
      lifetime.abort();
      stopScheduledWorkCoordinator();
      stopTimers();
      healthTracker.stopWatchdog();
    },
    flushStats: () => statRepository.shutdown(),
    cleanupMcp: async () => {
      const { getGuildMcpManager } = await import("@/utils/mcp/guildMcpManager");
      await Promise.all([getGuildMcpManager().cleanup(), stopBridges()]);
    },
    cleanupCoordination: async () => {
      const results = await Promise.allSettled([stopInvalidationBus(), releaseShardLeases()]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
    },
  });
  healthTracker.startWatchdog(() => shutdown.shutdown({ exitCode: 1 }));

  try {
    await initDatabase(environment);
    lifetime.signal.throwIfAborted();
    const acquired = await acquireShardLeases(
      {
        onLost: () => {
          void shutdown.shutdown({ immediate: true, exitCode: 1 });
        },
        onStateChange: (state) => {
          if (state === "uncertain") {
            abortChannelTurns();
            stopScheduledWorkCoordinator();
          } else if (state === "active" && !lifetime.signal.aborted && client.isReady()) {
            initializeScheduledWorkCoordinator(client);
          }
        },
      },
      lifetime.signal,
    );
    if (!acquired) throw new Error("Could not acquire every selected shard lease; Discord login refused");
    lifetime.signal.throwIfAborted();
    await startInvalidationBus(sql, topology);
    lifetime.signal.throwIfAborted();

    const { getOAuthPublicBaseUrl } = await import("@/utils/oauth/settings");
    const oauthPublicBaseUrl = getOAuthPublicBaseUrl();
    if (oauthPublicBaseUrl) {
      const { initializeOAuthCallbackRoute } = await import("@/utils/oauth/callbackRoute");
      const { initializeMcpOAuthRoutes } = await import("@/utils/mcp/oauth/routes");
      initializeOAuthCallbackRoute();
      initializeMcpOAuthRoutes(oauthPublicBaseUrl);
      if (environment !== "production") startHealthServer(healthPort);
      const callbackOrigin = new URL(oauthPublicBaseUrl);
      if (callbackOrigin.protocol === "http:" && callbackOrigin.port !== String(healthPort)) {
        log.warn(
          `TOMORI_PUBLIC_BASE_URL uses port ${callbackOrigin.port}, but the callback server listens on PORT ${healthPort}`,
        );
      }
    }

    if (includePresences) {
      const { discordPresenceRetention } = await import("@/utils/cache/discordPresenceRetention");
      const pairs = await statRepository.getPresenceRetentionPairs(topology);
      lifetime.signal.throwIfAborted();
      for (const pair of pairs) discordPresenceRetention.retain(pair.server_disc_id, pair.user_disc_id);
      log.info(`Discord presence retention initialized for ${pairs.length} guild-user pairs`);
    }
    const { initLoaders } = await import("@/init/loaders");
    await initLoaders(client);
    lifetime.signal.throwIfAborted();
    if (!hasShardLeaseOwnership()) throw new Error("Shard ownership became unsafe during startup");
    await initBridges(client);
    lifetime.signal.throwIfAborted();
    await initTimers(client);
    lifetime.signal.throwIfAborted();

    const token = process.env.DISCORD_TOKEN;
    if (!token) throw new Error("DISCORD_TOKEN is required");
    client.rest.setToken(token);
    if (topology.totalShardCount === null) {
      const gateway = z
        .object({ shards: z.number().int().positive() })
        .parse(await client.rest.get(Routes.gatewayBot(), { signal: lifetime.signal }));
      topology.resolveGatewayShardCount(gateway.shards);
    }
    const { waitForSessionStarts } = await import("@/utils/cluster/identifyThrottler");
    await waitForSessionStarts(client.rest, topology.getResolvedTopology().ownedShardIds.length, lifetime.signal);
    lifetime.signal.throwIfAborted();
    if (!hasShardLeaseOwnership()) throw new Error("Shard ownership became unsafe before Discord login");
    await client.login(token);
  } catch (error) {
    const cancelled = lifetime.signal.aborted;
    if (!cancelled) {
      log.error(
        isTransientGatewayError(error)
          ? "Discord gateway startup failed; the runtime must restart with backoff"
          : "Bot startup failed",
        error,
      );
    }
    await shutdown.shutdown({ immediate: true, exitCode: cancelled ? undefined : 1 });
  }
}

if (import.meta.main) {
  try {
    await startBot();
  } catch (error) {
    await log.error("Bot startup configuration failed", error);
    process.exit(1);
  }
}
