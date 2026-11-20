// Fields stay flat at the top level because log queries and Grafana extract them via
// (fields->>'heap_used_mb')::float.

import type { Client } from "discord.js";
import { getVoiceTranscriptCacheSize } from "@/utils/audio/voiceTranscriptCache";
import { getChannelLlmCacheSize } from "@/utils/cache/channelLlmCacheStore";
import { getWhitelistCacheStats } from "@/utils/cache/channelWhitelistCache";
import { getEmojiStickerCacheStats } from "@/utils/cache/emojiStickerCache";
import { getGuildMcpConfigCacheStats } from "@/utils/cache/guildMcpConfigCache";
import { getLLMCacheSize } from "@/utils/cache/llmCache";
import { getNovelaiSubscriptionCacheSize } from "@/utils/cache/novelaiSubscriptionCache";
import { getOpenRouterCapabilityCacheSize } from "@/utils/cache/openrouterCapabilityCache";
import { getOpenRouterEmbeddingModelCacheSize } from "@/utils/cache/openrouterEmbeddingModelCache";
import { getOpenRouterImageModelCacheSize } from "@/utils/cache/openrouterImageModelCache";
import { getOpenRouterVideoModelCacheSize } from "@/utils/cache/openrouterVideoModelCache";
import { getPersonalSpotlightCacheStats } from "@/utils/cache/personalSpotlightCache";
import { getShortTermMemoryCacheStats } from "@/utils/cache/shortTermMemoryCache";
import { getStPresetCacheStats } from "@/utils/cache/stPresetCache";
import { getTomoriStateCacheStats } from "@/utils/cache/tomoriStateCache";
import { getUserCacheStats } from "@/utils/cache/userCache";
import { getWebhookIdentityCacheSize } from "@/utils/chat/webhookIdentity";
import { drainPoolEventCounters } from "@/utils/db/poolEvents";
import { metricSampleRepository, type MetricFields } from "@/utils/db/repositories/MetricSampleRepository";
import { getShardTopology } from "@/utils/discord/shardOwnership";
import { getWebhookCacheSizes } from "@/utils/discord/webhook/cache";
import { getPresetAvatarCacheSize } from "@/utils/image/avatarHelper";
import { eventLoopMonitor } from "@/utils/misc/eventLoopMonitor";
import { collectHostMemorySnapshot } from "@/utils/misc/hostMemory";
import { drainMemoryPressureCounters, installMemoryPressureListener } from "@/utils/misc/memoryPressureEvents";
import {
  evaluatePressure,
  initialPressureState,
  isPressureDetectorArmed,
  type PressureState,
  pressureSampleFromHostFields,
  pressureThresholdsFromEnv,
  pressureVerdictFields,
} from "@/utils/security/pressureDetector";
import { log } from "@/utils/misc/logger";
import { collectProcessMemorySnapshot } from "@/utils/misc/processMemory";
import { memoryGuard } from "@/utils/security/rateLimiter";
import { getMarkdownTableCacheSize } from "@/utils/text/markdownTableCache";
import { getPersonaSpriteCacheSize } from "@/utils/cache/personaSpriteCacheStore";
import { getPersonaSpriteMessageCacheSize } from "@/utils/cache/personaSpriteMessageCache";

// Default interval is 5 minutes because it balances CloudWatch log volume against correlating cache growth with
// observed 50% to 80% RSS drift.
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

let intervalId: NodeJS.Timeout | null = null;

// Detector state stays in memory across intervals because dwell and rate limiting span a sequence, and resetting on
// process restart matches container recovery.
let pressureState: PressureState = initialPressureState();
const processStartMs = Date.now();

function collectDiscordCacheSizes(client: Client): Record<string, number> {
  let members = 0;
  let channels = 0;
  let messages = 0;
  let threads = 0;
  let emojis = 0;
  let stickers = 0;
  let presences = 0;
  let voiceStates = 0;

  for (const guild of client.guilds.cache.values()) {
    try {
      members += guild.members.cache.size;
      channels += guild.channels.cache.size;
      emojis += guild.emojis.cache.size;
      stickers += guild.stickers.cache.size;
      presences += guild.presences.cache.size;
      voiceStates += guild.voiceStates.cache.size;

      for (const channel of guild.channels.cache.values()) {
        if ("messages" in channel) {
          const mgr = (channel as unknown as { messages?: { cache?: { size?: number } } }).messages;
          if (mgr?.cache?.size) messages += mgr.cache.size;
        }
        if ("threads" in channel) {
          const mgr = (channel as unknown as { threads?: { cache?: { size?: number } } }).threads;
          if (mgr?.cache?.size) threads += mgr.cache.size;
        }
      }
    } catch {}
  }

  return {
    discord_guilds: client.guilds.cache.size,
    discord_users: client.users.cache.size,
    discord_channels: channels,
    discord_members: members,
    discord_messages: messages,
    discord_threads: threads,
    discord_emojis: emojis,
    discord_stickers: stickers,
    discord_presences: presences,
    discord_voiceStates: voiceStates,
  };
}

export function collectCacheMetricsSnapshot(client: Client): MetricFields {
  const topology = getShardTopology();
  if (Array.isArray(client.options.shards) && client.options.shardCount !== undefined) {
    topology.resolveGatewayShardCount(client.options.shardCount);
  }
  const { totalShardCount, ownedShardIds } = topology.getResolvedTopology();
  const stm = getShortTermMemoryCacheStats();
  const tomoriState = getTomoriStateCacheStats();
  const user = getUserCacheStats();
  const whitelist = getWhitelistCacheStats();
  const emojiSticker = getEmojiStickerCacheStats();
  const guildMcp = getGuildMcpConfigCacheStats();
  const stPreset = getStPresetCacheStats();
  const webhook = getWebhookCacheSizes();
  const personalSpotlight = getPersonalSpotlightCacheStats();
  const memCheck = memoryGuard.checkMemory();
  const processMemory = collectProcessMemorySnapshot();

  return {
    process_label: topology.processLabel,
    // Shard IDs use ascending comma-separated decimal integers because metric fields are scalar.
    shard_ids: ownedShardIds.join(","),
    shard_count: totalShardCount,
    shortTermMemory: stm.size,
    tomoriState: tomoriState.cacheSize,
    userCache: user.cacheSize,
    channelWhitelist: whitelist.size,
    channelLlm: getChannelLlmCacheSize(),
    emojiSticker: emojiSticker.cacheSize,
    guildMcpConfig: guildMcp.cacheSize,
    personalSpotlight: personalSpotlight.size,
    stPreset: stPreset.size,
    presetAvatar: getPresetAvatarCacheSize(),
    voiceTranscript: getVoiceTranscriptCacheSize(),
    markdownTable: getMarkdownTableCacheSize(),
    personaSprite: getPersonaSpriteCacheSize(),
    personaSpriteMessage: getPersonaSpriteMessageCacheSize(),
    llmCache: getLLMCacheSize(),
    openrouterCapability: getOpenRouterCapabilityCacheSize(),
    openrouterEmbeddingCatalog: getOpenRouterEmbeddingModelCacheSize(),
    openrouterImageCatalog: getOpenRouterImageModelCacheSize(),
    openrouterVideoCatalog: getOpenRouterVideoModelCacheSize(),
    novelaiSubscription: getNovelaiSubscriptionCacheSize(),

    // Webhook caches have no TTL, so track them for unbounded growth.
    webhookChannel: webhook.webhookChannel,
    webhookManagedSlots: webhook.webhookManagedSlots,
    webhookMutationLocks: webhook.webhookMutationLocks,
    webhookAvatarState: webhook.webhookAvatarState,
    persistedManagedWebhookIds: webhook.persistedManagedWebhookIds,
    webhookFailure: webhook.webhookFailure,
    webhookIdentity: getWebhookIdentityCacheSize(),

    ...collectDiscordCacheSizes(client),

    rss_mb: Math.round(memCheck.rssUsedMB * 100) / 100,
    rss_pct: Math.round(memCheck.percentUsed * 10000) / 100,
    rss_limit_mb: memCheck.memoryLimitMB,

    // Native buffers live in external/arrayBuffers rather than the JS heap, so cache counts alone cannot explain spikes
    // when the kernel swaps.
    heap_used_mb: processMemory.heapUsedMb,
    heap_total_mb: processMemory.heapTotalMb,
    external_mb: processMemory.externalMb,
    array_buffers_mb: processMemory.arrayBuffersMb,

    // Peak interval lag is recorded because stalls between 5-minute ticks starve the event loop while Discord ping
    // stays green.
    event_loop_peak_lag_ms: eventLoopMonitor.takeIntervalPeakLagMs(),
  };
}

// Both sinks stay because JSONL survives outages for triage while Postgres feeds Grafana, and the insert stays
// unawaited so DB stalls never block the interval.
function emitSnapshot(client: Client): void {
  try {
    const snapshot = collectCacheMetricsSnapshot(client);
    log.metric("cache_sizes", snapshot);
    void metricSampleRepository.recordSample("cache_sizes", snapshot);
  } catch (error) {
    log.error("Failed to emit cache metrics snapshot", error, {
      errorType: "CacheMetricsLoggerError",
    });
  }

  void emitHostSnapshot();
}

// This omits log.metric() because tomoribot-oom-observer already writes host counters to disk every 15s, so only the
// queryable Postgres series is missing.
async function emitHostSnapshot(): Promise<void> {
  try {
    const snapshot = await collectHostMemorySnapshot();
    if (!snapshot) return;

    // Reuse this snapshot for evaluatePressure because collectHostMemorySnapshot differences swap_in_per_s against
    // the previous call.
    const now = Date.now();
    const { state, verdict } = evaluatePressure(
      pressureState,
      pressureSampleFromHostFields(snapshot, now),
      processStartMs,
      pressureThresholdsFromEnv(),
    );
    pressureState = state;

    const armed = isPressureDetectorArmed();
    if (verdict.wouldAct !== "none") {
      log.warn(
        `Host pressure ${verdict.level}: would ${verdict.wouldAct} (elevated duty ${verdict.elevatedDuty}, critical duty ${verdict.criticalDuty}, armed=${armed})`,
      );
    }

    // Include pool retirements on host_memory so cascades align with swap and PSI on one time axis.
    await metricSampleRepository.recordSample("host_memory", {
      ...snapshot,
      ...pressureVerdictFields(verdict, armed),
      ...drainPoolEventCounters(),
      ...drainMemoryPressureCounters(),
    });
  } catch (error) {
    log.error("Failed to emit host memory snapshot", error, {
      errorType: "CacheMetricsLoggerError",
    });
  }
}

/** @public Dynamically loaded by `src/init/timers.ts` on main and release. */
export function initializeCacheMetricsLogger(client: Client, intervalMs?: number): void {
  // Skip in non-production, so these snapshots are for CloudWatch, not local dev
  if (process.env.RUN_ENV !== "production") {
    return;
  }

  if (intervalId !== null) {
    log.warn("Cache metrics logger already initialized");
    return;
  }

  const resolved = intervalMs ?? Number.parseInt(process.env.CACHE_METRICS_INTERVAL_MS || "", 10);
  const finalInterval = Number.isFinite(resolved) && resolved > 0 ? resolved : DEFAULT_INTERVAL_MS;

  installMemoryPressureListener();

  // Emit an immediate sample so CloudWatch has a baseline right after boot
  emitSnapshot(client);

  intervalId = setInterval(() => emitSnapshot(client), finalInterval);

  log.success(`Cache metrics logger started (interval: ${finalInterval / 1000}s)`);
}

/** @public Dynamically loaded by `src/init/timers.ts` on main and release. */
export function stopCacheMetricsLogger(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    log.info("Cache metrics logger stopped");
  }
}
