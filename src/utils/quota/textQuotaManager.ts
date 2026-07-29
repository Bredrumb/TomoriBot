import { log } from "@/utils/misc/logger";
import type { TextQuotaConfigRow } from "@/types/db/schema";
import {
  cleanupOldTextQuotas as repositoryCleanupOldTextQuotas,
  getOrCreateTextConfig,
  incrementTextQuota as repositoryIncrementTextQuota,
  resetServerwideTextPeriod,
  resetServerwideTextQuotaPool,
  touchServerwideTextQuota,
  touchUserTextQuota,
} from "@/utils/db/repositories/QuotaRepository";

/**
 * Result of text quota check operations
 */
export interface TextQuotaCheckResult {
  allowed: boolean; // Whether user can trigger text generation
  reason?: "user_quota_exceeded" | "serverwide_quota_exceeded" | "disabled"; // Reason if denied
  userRemaining?: number; // User's remaining quota for the day
  serverwideRemaining?: number; // Server's remaining quota for the period
  resetTime?: Date; // When the quota resets (for error messages)
}

/**
 * Get or create server's text quota configuration
 * Creates default config if not exists (unlimited by default)
 */
export async function getTextQuotaConfig(serverId: number): Promise<TextQuotaConfigRow> {
  return getOrCreateTextConfig(serverId);
}

/**
 * Check if user can trigger text generation based on daily quota
 * Returns remaining quota and whether trigger is allowed
 */
export async function checkUserDailyTextQuota(
  serverId: number,
  userDiscId: string,
  config: TextQuotaConfigRow,
): Promise<TextQuotaCheckResult> {
  // If daily user quota is 0 (unlimited), allow
  if (config.daily_user_quota === 0) {
    return { allowed: true };
  }

  try {
    // Get current date in YYYY-MM-DD format (server's local date)
    const today = new Date().toISOString().split("T")[0];

    // Get or create user's quota record for today
    const userQuota = await touchUserTextQuota(serverId, userDiscId, today);

    // Check if user has exceeded their daily quota
    const remaining = config.daily_user_quota - userQuota.usage_count;

    if (remaining <= 0) {
      // Calculate midnight tonight for reset time
      const resetTime = new Date();
      resetTime.setHours(24, 0, 0, 0); // Next midnight

      return {
        allowed: false,
        reason: "user_quota_exceeded",
        userRemaining: 0,
        resetTime,
      };
    }

    // User has remaining quota
    return {
      allowed: true,
      userRemaining: remaining,
    };
  } catch (error) {
    log.error("Failed to check user daily text quota", error);
    // On error, allow (fail-open to prevent blocking legitimate usage)
    return { allowed: true };
  }
}

/**
 * Check if server has remaining server-wide text quota
 * Returns remaining quota and whether trigger is allowed
 */
export async function checkServerwideTextQuota(
  serverId: number,
  config: TextQuotaConfigRow,
): Promise<TextQuotaCheckResult> {
  // If serverwide quota is 0 (unlimited), allow
  if (config.serverwide_quota === 0) {
    return { allowed: true };
  }

  try {
    // Get or create server-wide quota record
    const serverwideQuota = await touchServerwideTextQuota(serverId, config.serverwide_quota_resets_in);

    // Check if quota period has expired (needs reset)
    const now = new Date();
    const periodEnd = new Date(serverwideQuota.quota_period_end);

    if (now >= periodEnd) {
      // Reset the server-wide quota
      const resetQuota = await resetServerwideTextPeriod(serverId, config.serverwide_quota_resets_in);

      return {
        allowed: true,
        serverwideRemaining: config.serverwide_quota,
        resetTime: new Date(resetQuota.quota_period_end),
      };
    }

    // Check if server has exceeded its quota
    const remaining = config.serverwide_quota - serverwideQuota.usage_count;

    if (remaining <= 0) {
      return {
        allowed: false,
        reason: "serverwide_quota_exceeded",
        serverwideRemaining: 0,
        resetTime: periodEnd,
      };
    }

    // Server has remaining quota
    return {
      allowed: true,
      serverwideRemaining: remaining,
      resetTime: periodEnd,
    };
  } catch (error) {
    log.error("Failed to check serverwide text quota", error);
    // On error, allow (fail-open to prevent blocking legitimate usage)
    return { allowed: true };
  }
}

/**
 * Check all text quotas (user daily + server-wide)
 * Returns combined result indicating if trigger is allowed
 */
export async function checkTextQuota(serverId: number, userDiscId: string): Promise<TextQuotaCheckResult> {
  try {
    // Get quota configuration
    const config = await getTextQuotaConfig(serverId);

    // Check user daily quota first (most common limit)
    // Note: daily_user_quota === 0 means unlimited (handled inside checkUserDailyTextQuota)
    const userCheck = await checkUserDailyTextQuota(serverId, userDiscId, config);
    if (!userCheck.allowed) {
      return userCheck;
    }

    // Check server-wide quota
    const serverwideCheck = await checkServerwideTextQuota(serverId, config);
    if (!serverwideCheck.allowed) {
      return serverwideCheck;
    }

    // Both checks passed, combine remaining counts
    return {
      allowed: true,
      userRemaining: userCheck.userRemaining,
      serverwideRemaining: serverwideCheck.serverwideRemaining,
      resetTime: serverwideCheck.resetTime,
    };
  } catch (error) {
    log.error("Failed to check text quota", error);
    // On error, allow (fail-open to prevent blocking legitimate usage)
    return { allowed: true };
  }
}

/**
 * Increment both user daily and server-wide text quotas after successful generation.
 * Should only be called AFTER a text response succeeds.
 * Only increments counters that have an active limit -- skips writes when quota is unlimited (0)
 * so usage does not accumulate retroactively before limits are first configured.
 */
export async function incrementTextQuota(serverId: number, userDiscId: string): Promise<void> {
  try {
    await repositoryIncrementTextQuota(serverId, userDiscId);
    log.info("Incremented text quotas");
  } catch (error) {
    log.error("Failed to increment text quota", error);
    // Don't throw - quota increment failure shouldn't block user
  }
}

/**
 * Clean up old user text quota records (older than 7 days)
 * Should be called periodically (e.g., on startup or via cron)
 */
export async function cleanupOldTextQuotas(): Promise<number> {
  try {
    const deletedCount = await repositoryCleanupOldTextQuotas();

    if (deletedCount > 0) {
      log.info("Cleaned up old text quota records");
    }

    return deletedCount;
  } catch (error) {
    log.error("Failed to cleanup old text quotas", error);
    return 0;
  }
}

/**
 * Manually reset server-wide text quota (admin override)
 * Creates new quota period starting now
 */
export async function resetTextServerwideQuota(serverId: number): Promise<void> {
  try {
    await resetServerwideTextQuotaPool(serverId);
    log.info("Manually reset text serverwide quota");
  } catch (error) {
    log.error("Failed to reset text serverwide quota", error);
    throw error;
  }
}
