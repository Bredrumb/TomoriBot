import { log } from "@/utils/misc/logger";
import { z } from "zod";
import { DEFAULT_MESSAGE_FETCH_LIMIT } from "@/utils/discord/messageFetchLimit";
import {
  addProcessMemoryDeltaFields,
  addProcessMemorySnapshotFields,
  collectProcessMemorySnapshot,
  type ForcedGcRuntime,
  runForcedGc,
} from "@/utils/misc/processMemory";

const IS_PRODUCTION = process.env.RUN_ENV === "production";
export const GUARDS_ENABLED = IS_PRODUCTION;

const MESSAGE_RATE_LIMITS = {
  MAX_USER_ACTIVE_MESSAGES: GUARDS_ENABLED
    ? Number.parseInt(process.env.MAX_USER_ACTIVE_MESSAGES || "3", 10)
    : Number.POSITIVE_INFINITY,

  MAX_SERVER_ACTIVE_MESSAGES: GUARDS_ENABLED
    ? Number.parseInt(process.env.MAX_SERVER_ACTIVE_MESSAGES || "10", 10)
    : Number.POSITIVE_INFINITY,
} as const;

export const MEDIA_LIMITS = {
  MESSAGE_FETCH_LIMIT: DEFAULT_MESSAGE_FETCH_LIMIT,

  MEDIA_CONTEXT_WINDOW: Number.parseInt(process.env.MEDIA_CONTEXT_WINDOW || "10", 10),

  MAX_MEDIA_SIZE_MB: Number.parseInt(process.env.MAX_MEDIA_SIZE_MB || "10", 10),

  MAX_GIF_SIZE_MB: Number.parseInt(process.env.MAX_GIF_SIZE_MB || "50", 10),
} as const;

export const PERSONA_LIMITS = {
  // Capped at 10 MB by default because that matches Discord's standard upload limit.
  MAX_AVATAR_SIZE_MB: Number.parseInt(process.env.MAX_AVATAR_SIZE_MB || "10", 10),
} as const;

export const IMPORT_LIMITS = {
  MAX_DATA_IMPORT_SIZE_MB: Number.parseInt(process.env.MAX_DATA_IMPORT_SIZE_MB || "2", 10),

  MAX_PERSONA_IMPORT_SIZE_MB: Number.parseInt(process.env.MAX_PERSONA_IMPORT_SIZE_MB || "10", 10),

  // Separate knob from PNG/JSON bounds because a compressed .charx archive carries an asset tree whose expanded size
  // the download bound cannot describe.
  MAX_CHARX_IMPORT_SIZE_MB: Number.parseInt(process.env.MAX_CHARX_IMPORT_SIZE_MB || "10", 10),

  // Decompressed card.json cap prevents zip bombs on extraction, because card.json is the only .charx archive entry
  // decompressed.
  MAX_CHARX_CARD_SIZE_MB: Number.parseInt(process.env.MAX_CHARX_CARD_SIZE_MB || "4", 10),

  // Header-scan cap on declared .charx assets, because assets are never imported and only the zip central directory
  // scan needs bounding.
  MAX_CHARX_ASSETS: Number.parseInt(process.env.MAX_CHARX_ASSETS || "500", 10),

  // Declared asset total is checked from the zip central directory, so a hostile asset tree is rejected without
  // decompressing entries.
  MAX_CHARX_ASSET_TOTAL_MB: Number.parseInt(process.env.MAX_CHARX_ASSET_TOTAL_MB || "256", 10),
} as const;

const PERSONA_RATE_LIMITS = {
  MAX_OPERATIONS_PER_DAY: GUARDS_ENABLED
    ? Number.parseInt(process.env.MAX_PERSONA_OPERATIONS_PER_DAY || "25", 10)
    : Number.POSITIVE_INFINITY,
} as const;

const IMPORT_RATE_LIMITS = {
  MAX_OPERATIONS_PER_DAY: GUARDS_ENABLED
    ? Number.parseInt(process.env.MAX_IMPORT_OPERATIONS_PER_DAY || "50", 10)
    : Number.POSITIVE_INFINITY,
} as const;

const DOCUMENT_RATE_LIMITS = {
  MAX_OPERATIONS_PER_DAY: GUARDS_ENABLED
    ? Number.parseInt(process.env.MAX_DOCUMENT_OPERATIONS_PER_DAY || "20", 10)
    : Number.POSITIVE_INFINITY,
} as const;

const AVATAR_RATE_LIMITS = {
  MAX_OPERATIONS_PER_DAY: GUARDS_ENABLED
    ? Number.parseInt(process.env.MAX_AVATAR_OPERATIONS_PER_DAY || "30", 10)
    : Number.POSITIVE_INFINITY,
} as const;

export const FETCH_LIMITS = {
  // NaN defeats both HEAD rejection and the streaming caps used by native fetch and Crawl4AI.
  MAX_FETCH_SIZE_MB: z.coerce
    .number()
    .int()
    .positive()
    .catch(GUARDS_ENABLED ? 5 : 50)
    .parse(process.env.MAX_FETCH_SIZE_MB ?? (GUARDS_ENABLED ? 5 : 50)),

  FETCH_CHAR_LIMIT: 50000,

  MEMORY_REDUCTION_WARNING: 0.3,
  MEMORY_REDUCTION_CRITICAL: 0.04,
} as const;

export const STREAMING_LIMITS = {
  MAX_FLUSH_COUNT: GUARDS_ENABLED ? 40 : Number.POSITIVE_INFINITY,
} as const;

// Kept as a lazy function rather than a module-level const because module evaluation runs before getAppSecrets()
// loads env overrides in index.ts.
function MEMORY_PROTECTION() {
  return {
    CONTAINER_MEMORY_LIMIT_MB: Number.parseInt(process.env.CONTAINER_MEMORY_LIMIT_MB || "1024", 10),

    MEMORY_WARNING_THRESHOLD: Number.parseFloat(process.env.MEMORY_WARNING_THRESHOLD || "0.75"),

    MEMORY_CRITICAL_THRESHOLD: Number.parseFloat(process.env.MEMORY_CRITICAL_THRESHOLD || "0.85"),

    EMERGENCY_COOLDOWN_MS: Number.parseInt(process.env.EMERGENCY_COOLDOWN_MS || "60000", 10),
  };
}

export type MemoryStatus = "safe" | "warning" | "critical";

export interface MemoryCheckResult {
  status: MemoryStatus;
  rssUsedMB: number;
  memoryLimitMB: number;
  percentUsed: number;
  shouldProcessMedia: boolean;
  reducedMediaWindow?: number;
}

interface MemoryEmergencyEvent {
  rssUsedMB: number;
  memoryLimitMB: number;
  percentUsed: number;
  cooldownMs: number;
  enteredAt: number;
}

export type MemoryEmergencyHandler = (event: MemoryEmergencyEvent) => void;

const memoryEmergencyHandlers = new Set<MemoryEmergencyHandler>();

export function registerMemoryEmergencyHandler(handler: MemoryEmergencyHandler): () => void {
  memoryEmergencyHandlers.add(handler);
  return () => {
    memoryEmergencyHandlers.delete(handler);
  };
}

function notifyMemoryEmergencyHandlers(event: MemoryEmergencyEvent): void {
  for (const handler of memoryEmergencyHandlers) {
    try {
      handler(event);
    } catch (error) {
      log.error("Memory emergency handler failed", error, {
        errorType: "memory_emergency_handler_failed",
      });
    }
  }
}

function forceGarbageCollection(): void {
  const beforeGc = collectProcessMemorySnapshot();
  let gcRuntime: ForcedGcRuntime = "unavailable";
  let failed = 0;

  try {
    gcRuntime = runForcedGc();
    if (gcRuntime === "unavailable") {
      log.warn("Garbage collection not available (Bun.gc or Node --expose-gc required for forced GC)");
    } else {
      log.info(`Forced ${gcRuntime} garbage collection`);
    }
  } catch (error) {
    failed = 1;
    log.error("Forced garbage collection failed", error, {
      errorType: "forced_gc_failed",
      metadata: { gcRuntime },
    });
  }

  const afterGc = collectProcessMemorySnapshot();
  const metricFields: Record<string, number | string> = {
    runtime: gcRuntime,
    available: gcRuntime === "unavailable" ? 0 : 1,
    failed,
  };
  addProcessMemorySnapshotFields(metricFields, "before_gc", beforeGc);
  addProcessMemorySnapshotFields(metricFields, "after_gc", afterGc);
  addProcessMemoryDeltaFields(metricFields, "gc", beforeGc, afterGc);
  log.metric("memory_forced_gc", metricFields);
}

class MemoryGuard {
  private isInEmergencyMode = false;
  private emergencyModeEnteredAt = 0;

  checkMemory(): MemoryCheckResult {
    const protection = MEMORY_PROTECTION();

    if (!GUARDS_ENABLED) {
      return {
        status: "safe",
        rssUsedMB: 0,
        memoryLimitMB: protection.CONTAINER_MEMORY_LIMIT_MB,
        percentUsed: 0,
        shouldProcessMedia: true,
      };
    }

    // Measure RSS rather than heap because the kernel OOM killer tracks total resident process memory.
    const rssBytes = process.memoryUsage().rss;
    const limitBytes = protection.CONTAINER_MEMORY_LIMIT_MB * 1024 * 1024;

    const rssUsedMB = rssBytes / (1024 * 1024);
    const percentUsed = rssBytes / limitBytes;

    if (this.isInEmergencyMode) {
      const timeSinceEmergency = Date.now() - this.emergencyModeEnteredAt;

      if (timeSinceEmergency < protection.EMERGENCY_COOLDOWN_MS) {
        log.warn(
          `Still in emergency cooldown (${Math.round(timeSinceEmergency / 1000)}s / ${protection.EMERGENCY_COOLDOWN_MS / 1000}s). Media processing disabled.`,
        );
        return {
          status: "critical",
          rssUsedMB,
          memoryLimitMB: protection.CONTAINER_MEMORY_LIMIT_MB,
          percentUsed,
          shouldProcessMedia: false,
        };
      }

      log.info("Emergency cooldown expired. Resuming normal operation.");
      this.isInEmergencyMode = false;
    }

    if (percentUsed >= protection.MEMORY_CRITICAL_THRESHOLD) {
      if (!this.isInEmergencyMode) {
        this.enterEmergencyMode(rssUsedMB, percentUsed);
      }

      return {
        status: "critical",
        rssUsedMB,
        memoryLimitMB: protection.CONTAINER_MEMORY_LIMIT_MB,
        percentUsed,
        shouldProcessMedia: false,
      };
    }

    if (percentUsed >= protection.MEMORY_WARNING_THRESHOLD) {
      log.warn(
        `Memory warning: ${rssUsedMB.toFixed(2)} MB / ${protection.CONTAINER_MEMORY_LIMIT_MB} MB (${(percentUsed * 100).toFixed(1)}%)`,
      );

      return {
        status: "warning",
        rssUsedMB,
        memoryLimitMB: protection.CONTAINER_MEMORY_LIMIT_MB,
        percentUsed,
        shouldProcessMedia: true,
        reducedMediaWindow: 5,
      };
    }

    return {
      status: "safe",
      rssUsedMB,
      memoryLimitMB: protection.CONTAINER_MEMORY_LIMIT_MB,
      percentUsed,
      shouldProcessMedia: true,
    };
  }

  private enterEmergencyMode(rssUsedMB: number, percentUsed: number): void {
    const protection = MEMORY_PROTECTION();
    this.isInEmergencyMode = true;
    this.emergencyModeEnteredAt = Date.now();
    const event: MemoryEmergencyEvent = {
      rssUsedMB,
      memoryLimitMB: protection.CONTAINER_MEMORY_LIMIT_MB,
      percentUsed,
      cooldownMs: protection.EMERGENCY_COOLDOWN_MS,
      enteredAt: this.emergencyModeEnteredAt,
    };

    log.error(
      `CRITICAL MEMORY PRESSURE: ${rssUsedMB.toFixed(2)} MB / ${protection.CONTAINER_MEMORY_LIMIT_MB} MB RSS (${(percentUsed * 100).toFixed(1)}%). Entering emergency mode.`,
      {
        errorType: "memory_critical",
        metadata: {
          rssUsedMB,
          percentUsed: percentUsed * 100,
          cooldownMs: protection.EMERGENCY_COOLDOWN_MS,
        },
      },
    );

    notifyMemoryEmergencyHandlers(event);

    // Kept even though the cache clearer collects before it measures: clearing can be turned
    // off by env, and no handler is registered at all until the memory monitor starts.
    forceGarbageCollection();
  }

  getMediaWindow(): number {
    const memCheck = this.checkMemory();

    if (memCheck.status === "critical") {
      return 0;
    }

    if (memCheck.status === "warning" && memCheck.reducedMediaWindow) {
      return memCheck.reducedMediaWindow;
    }

    return MEDIA_LIMITS.MEDIA_CONTEXT_WINDOW;
  }

  getFetchCharLimit(): number {
    const memCheck = this.checkMemory();

    if (memCheck.status === "critical") {
      return Math.floor(FETCH_LIMITS.FETCH_CHAR_LIMIT * FETCH_LIMITS.MEMORY_REDUCTION_CRITICAL);
    }

    if (memCheck.status === "warning") {
      return Math.floor(FETCH_LIMITS.FETCH_CHAR_LIMIT * FETCH_LIMITS.MEMORY_REDUCTION_WARNING);
    }

    return FETCH_LIMITS.FETCH_CHAR_LIMIT;
  }

  getStatus(): MemoryStatus {
    return this.checkMemory().status;
  }

  forceExitEmergencyMode(): void {
    log.warn("Manually forcing exit from emergency mode");
    this.isInEmergencyMode = false;
    this.emergencyModeEnteredAt = 0;
  }
}

export const memoryGuard = new MemoryGuard();

interface QuotaEntry {
  count: number;

  // Epoch milliseconds matching Date.now(), so expiry checks compare in the same unit.
  resetAt: number;
}

interface QuotaCheckResult {
  allowed: boolean;

  resetAt?: number;

  current?: number;

  max?: number;
}

const personaQuotaMap = new Map<string, QuotaEntry>();
const importQuotaMap = new Map<string, QuotaEntry>();
const documentQuotaMap = new Map<string, QuotaEntry>();
const avatarQuotaMap = new Map<string, QuotaEntry>();

const DAILY_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  currentCount?: number;
  maxLimit?: number;
}

export function checkUserRateLimit(userActiveCount: number): RateLimitResult {
  if (!GUARDS_ENABLED) {
    return { allowed: true };
  }

  const limit = MESSAGE_RATE_LIMITS.MAX_USER_ACTIVE_MESSAGES;

  if (userActiveCount >= limit) {
    return {
      allowed: false,
      reason: "user_rate_limit_exceeded",
      currentCount: userActiveCount,
      maxLimit: limit,
    };
  }

  return { allowed: true };
}

export function checkServerRateLimit(serverActiveCount: number): RateLimitResult {
  if (!GUARDS_ENABLED) {
    return { allowed: true };
  }

  const limit = MESSAGE_RATE_LIMITS.MAX_SERVER_ACTIVE_MESSAGES;

  if (serverActiveCount >= limit) {
    return {
      allowed: false,
      reason: "server_rate_limit_exceeded",
      currentCount: serverActiveCount,
      maxLimit: limit,
    };
  }

  return { allowed: true };
}

// Check and increment stay in one synchronous call so concurrent callers cannot both pass before the count updates.
function reserveDailyQuota(quotaMap: Map<string, QuotaEntry>, key: string, limit: number): QuotaCheckResult {
  if (!GUARDS_ENABLED) {
    return { allowed: true };
  }

  const now = Date.now();
  const quota = quotaMap.get(key);

  if (!quota || now >= quota.resetAt) {
    quotaMap.set(key, {
      count: 1,
      resetAt: now + DAILY_QUOTA_WINDOW_MS,
    });
    return { allowed: true };
  }

  if (quota.count >= limit) {
    return {
      allowed: false,
      resetAt: quota.resetAt,
      current: quota.count,
      max: limit,
    };
  }

  quota.count++;
  return { allowed: true };
}

export function reservePersonaQuota(userId: string): QuotaCheckResult {
  return reserveDailyQuota(personaQuotaMap, userId, PERSONA_RATE_LIMITS.MAX_OPERATIONS_PER_DAY);
}

export function reserveImportQuota(userId: string): QuotaCheckResult {
  return reserveDailyQuota(importQuotaMap, userId, IMPORT_RATE_LIMITS.MAX_OPERATIONS_PER_DAY);
}

export function reserveDocumentQuota(userId: string): QuotaCheckResult {
  return reserveDailyQuota(documentQuotaMap, userId, DOCUMENT_RATE_LIMITS.MAX_OPERATIONS_PER_DAY);
}

export function reserveAvatarQuota(guildId: string): QuotaCheckResult {
  return reserveDailyQuota(avatarQuotaMap, guildId, AVATAR_RATE_LIMITS.MAX_OPERATIONS_PER_DAY);
}

// Formats the caller's existing MemoryCheckResult rather than resampling, because emergency clearing can alter the
// next reading.
export function formatMemoryStatus(check: MemoryCheckResult): string {
  return `Memory (RSS): ${check.rssUsedMB.toFixed(2)} MB / ${check.memoryLimitMB} MB (${(check.percentUsed * 100).toFixed(1)}%) - Status: ${check.status.toUpperCase()}`;
}

// Must be called once at startup because it does not guard against duplicate intervals.
/** @public Dynamically loaded by `src/init/timers.ts` on main and release. */
export function initializeQuotaCleanup(): void {
  const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

  setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [userId, quota] of personaQuotaMap.entries()) {
      if (now >= quota.resetAt) {
        personaQuotaMap.delete(userId);
        cleanedCount++;
      }
    }

    for (const [userId, quota] of importQuotaMap.entries()) {
      if (now >= quota.resetAt) {
        importQuotaMap.delete(userId);
        cleanedCount++;
      }
    }

    for (const [userId, quota] of documentQuotaMap.entries()) {
      if (now >= quota.resetAt) {
        documentQuotaMap.delete(userId);
        cleanedCount++;
      }
    }

    for (const [guildId, quota] of avatarQuotaMap.entries()) {
      if (now >= quota.resetAt) {
        avatarQuotaMap.delete(guildId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      log.info(`Quota cleanup: Removed ${cleanedCount} expired entries`);
    }
  }, CLEANUP_INTERVAL_MS);

  log.info("Quota cleanup interval initialized (runs every 1 hour)");
}
