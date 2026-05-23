import { log } from "@/utils/misc/logger";
import type { ImageQuotaConfigRow } from "@/types/db/schema";
import {
  cleanupOldImageQuotas as repositoryCleanupOldImageQuotas,
  getOrCreateImageConfig,
  incrementImageQuota as repositoryIncrementImageQuota,
  resetServerwideImagePeriod,
  resetServerwideImageQuotaPool,
  touchServerwideImageQuota,
  touchUserImageQuota,
} from "@/utils/db/repositories/QuotaRepository";

/**
 * Result of quota check operations
 */
export interface QuotaCheckResult {
  allowed: boolean; // Whether user can generate image
  reason?: "user_quota_exceeded" | "serverwide_quota_exceeded" | "disabled"; // Reason if denied
  userRemaining?: number; // User's remaining quota for the day
  serverwideRemaining?: number; // Server's remaining quota for the period
  resetTime?: Date; // When the quota resets (for error messages)
}

/**
 * Get or create server's quota configuration
 * Creates default config if not exists (10 daily user quota, unlimited serverwide)
 */
export async function getQuotaConfig(serverId: number): Promise<ImageQuotaConfigRow> {
  return getOrCreateImageConfig(serverId);
}

/**
 * Check if user can generate an image based on daily quota
 * Returns remaining quota and whether generation is allowed
 */
export async function checkUserDailyQuota(
  serverId: number,
  userDiscId: string,
  config: ImageQuotaConfigRow,
): Promise<QuotaCheckResult> {
  // 1. If daily user quota is 0 (unlimited), allow
  if (config.daily_user_quota === 0) {
    return { allowed: true };
  }

  try {
    // 2. Get current date in YYYY-MM-DD format (server's local date)
    const today = new Date().toISOString().split("T")[0];

    // 3. Get or create user's quota record for today
    const userQuota = await touchUserImageQuota(serverId, userDiscId, today);

    // 4. Check if user has exceeded their daily quota
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

    // 5. User has remaining quota
    return {
      allowed: true,
      userRemaining: remaining,
    };
  } catch (error) {
    log.error("Failed to check user daily quota", error);
    // On error, allow (fail-open to prevent blocking legitimate usage)
    return { allowed: true };
  }
}

/**
 * Check if server has remaining server-wide quota
 * Returns remaining quota and whether generation is allowed
 */
export async function checkServerwideQuota(serverId: number, config: ImageQuotaConfigRow): Promise<QuotaCheckResult> {
  // 1. If serverwide quota is 0 (unlimited), allow
  if (config.serverwide_quota === 0) {
    return { allowed: true };
  }

  try {
    // 2. Get or create server-wide quota record
    const serverwideQuota = await touchServerwideImageQuota(serverId, config.serverwide_quota_resets_in);

    // 3. Check if quota period has expired (needs reset)
    const now = new Date();
    const periodEnd = new Date(serverwideQuota.quota_period_end);

    if (now >= periodEnd) {
      // Reset the server-wide quota
      const resetQuota = await resetServerwideImagePeriod(serverId, config.serverwide_quota_resets_in);

      return {
        allowed: true,
        serverwideRemaining: config.serverwide_quota,
        resetTime: new Date(resetQuota.quota_period_end),
      };
    }

    // 4. Check if server has exceeded its quota
    const remaining = config.serverwide_quota - serverwideQuota.usage_count;

    if (remaining <= 0) {
      return {
        allowed: false,
        reason: "serverwide_quota_exceeded",
        serverwideRemaining: 0,
        resetTime: periodEnd,
      };
    }

    // 5. Server has remaining quota
    return {
      allowed: true,
      serverwideRemaining: remaining,
      resetTime: periodEnd,
    };
  } catch (error) {
    log.error("Failed to check serverwide quota", error);
    // On error, allow (fail-open to prevent blocking legitimate usage)
    return { allowed: true };
  }
}

/**
 * Check all quotas (user daily + server-wide)
 * Returns combined result indicating if generation is allowed
 */
export async function checkImageQuota(serverId: number, userDiscId: string): Promise<QuotaCheckResult> {
  try {
    // 1. Get quota configuration
    const config = await getQuotaConfig(serverId);

    // 2. Check user daily quota first (most common limit)
    // Note: daily_user_quota === 0 means unlimited (handled inside checkUserDailyQuota)
    const userCheck = await checkUserDailyQuota(serverId, userDiscId, config);
    if (!userCheck.allowed) {
      return userCheck;
    }

    // 4. Check server-wide quota
    const serverwideCheck = await checkServerwideQuota(serverId, config);
    if (!serverwideCheck.allowed) {
      return serverwideCheck;
    }

    // 5. Both checks passed, combine remaining counts
    return {
      allowed: true,
      userRemaining: userCheck.userRemaining,
      serverwideRemaining: serverwideCheck.serverwideRemaining,
      resetTime: serverwideCheck.resetTime,
    };
  } catch (error) {
    log.error("Failed to check image quota", error);
    // On error, allow (fail-open to prevent blocking legitimate usage)
    return { allowed: true };
  }
}

/**
 * Increment both user daily and server-wide quotas after successful image generation
 * Should only be called AFTER image generation succeeds
 */
export async function incrementImageQuota(serverId: number, userDiscId: string): Promise<void> {
  try {
    await repositoryIncrementImageQuota(serverId, userDiscId);
    log.info("Incremented image quotas");
  } catch (error) {
    log.error("Failed to increment image quota", error);
    // Don't throw - quota increment failure shouldn't block user
  }
}

/**
 * Clean up old user quota records (older than 7 days)
 * Should be called periodically (e.g., on startup or via cron)
 */
export async function cleanupOldImageQuotas(): Promise<number> {
  try {
    const deletedCount = await repositoryCleanupOldImageQuotas();

    if (deletedCount > 0) {
      log.info("Cleaned up old image quota records");
    }

    return deletedCount;
  } catch (error) {
    log.error("Failed to cleanup old image quotas", error);
    return 0;
  }
}

/**
 * Manually reset server-wide quota (admin override)
 * Creates new quota period starting now
 */
export async function resetServerwideQuota(serverId: number): Promise<void> {
  try {
    await resetServerwideImageQuotaPool(serverId);
    log.info("Manually reset serverwide quota");
  } catch (error) {
    log.error("Failed to reset serverwide quota", error);
    throw error;
  }
}
