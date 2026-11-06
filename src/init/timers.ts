import type { Client } from "discord.js";
import { measurePresetArtPhase, seedStorageBackedCatalogs } from "@/init/database";
import { log } from "@/utils/misc/logger";
import { hasShardLeaseOwnership, isPrimaryProcess } from "@/utils/cluster/shardLeases";
import { isDraining } from "@/utils/misc/shutdownState";

const PRESET_ART_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
let presetArtInterval: ReturnType<typeof setInterval> | null = null;

export function initializePresetArtReconciliation(client: Client): void {
  if (presetArtInterval) return;
  let running = false;
  let seeded = false;
  const reconcile = async (): Promise<void> => {
    if (running || !presetArtInterval || isDraining() || !hasShardLeaseOwnership()) return;
    running = true;
    try {
      if (!seeded && isPrimaryProcess()) {
        await seedStorageBackedCatalogs();
        seeded = true;
      }
      if (!presetArtInterval || isDraining() || !hasShardLeaseOwnership()) return;
      const { reconcilePresetMainAvatars } = await import("@/utils/persona/presetAvatarReconciler");
      await measurePresetArtPhase("fanout", () => reconcilePresetMainAvatars(client));
    } catch (error) {
      log.error("Preset art seed or avatar fan-out failed", error);
    } finally {
      running = false;
    }
  };
  presetArtInterval = setInterval(() => void reconcile(), PRESET_ART_RECONCILE_INTERVAL_MS);
  presetArtInterval.unref();
  void reconcile();
}

export function stopPresetArtReconciliation(): void {
  if (presetArtInterval) clearInterval(presetArtInterval);
  presetArtInterval = null;
}

let timerStops: Array<() => void> = [];

export function stopTimers(): void {
  stopPresetArtReconciliation();
  for (const stop of timerStops) stop();
  timerStops = [];
}

export async function initTimers(client: Client): Promise<void> {
  const [scheduled, memory, metrics, pruner, rag, catalog, stm, quota] = await Promise.all([
    import("@/timers/scheduledWorkCoordinator"),
    import("@/timers/memoryMonitor"),
    import("@/timers/cacheMetricsLogger"),
    import("@/timers/messageProxyIndexPruner"),
    import("@/timers/ragAvailabilityMonitor"),
    import("@/timers/openrouterCatalogRefresher"),
    import("@/timers/stmJanitor"),
    import("@/utils/security/rateLimiter"),
  ]);
  if (isDraining()) return;
  timerStops = [
    scheduled.stopScheduledWorkCoordinator,
    memory.stopMemoryMonitor,
    metrics.stopCacheMetricsLogger,
    pruner.stopMessageProxyIndexPruner,
    rag.stopRagAvailabilityMonitor,
    catalog.stopOpenRouterCatalogRefresher,
    stm.stopStmJanitor,
  ];
  client.once("clientReady", () => {
    if (isDraining()) return;
    if (hasShardLeaseOwnership()) scheduled.initializeScheduledWorkCoordinator(client);
    memory.initializeMemoryMonitor(client);
    metrics.initializeCacheMetricsLogger(client);
    pruner.initializeMessageProxyIndexPruner();
    initializePresetArtReconciliation(client);
  });
  quota.initializeQuotaCleanup();
  rag.initializeRagAvailabilityMonitor();
  catalog.initializeOpenRouterCatalogRefresher();
  stm.initializeStmJanitor();
}
