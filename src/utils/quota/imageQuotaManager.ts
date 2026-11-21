import { log } from "@/utils/misc/logger";
import type { ImageQuotaConfigRow } from "@/types/db/schema";
import { QuotaUnavailableError } from "@/utils/quota/quotaErrors";
import {
  getImageConfigResult,
  getOrCreateImageConfig,
  reserveImageQuotaUnits,
  resetServerwideImagePeriod,
  touchServerwideImageQuota,
  touchUserImageQuota,
  type QuotaReservation,
  type QuotaReservationOutcome,
} from "@/utils/db/repositories/QuotaRepository";

export { releaseImageQuotaUnits as releaseImageQuota } from "@/utils/db/repositories/QuotaRepository";

export interface QuotaCheckResult {
  allowed: boolean; // Whether user can generate image
  reason?: "user_quota_exceeded" | "serverwide_quota_exceeded" | "disabled"; // Reason if denied
  userRemaining?: number; // User's remaining quota for the day
  serverwideRemaining?: number; // Server's remaining quota for the period
  resetTime?: Date; // When the quota resets (for error messages)
}

export interface ImageQuotaClaim extends QuotaCheckResult {
  reservation: QuotaReservation | null;
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
async function checkUserDailyQuota(
  serverId: number,
  userDiscId: string,
  config: ImageQuotaConfigRow,
): Promise<QuotaCheckResult> {
  // If daily user quota is 0 (unlimited), allow
  if (config.daily_user_quota === 0) {
    return { allowed: true };
  }

  const today = new Date().toISOString().split("T")[0];

  const userQuota = await touchUserImageQuota(serverId, userDiscId, today);

  const remaining = config.daily_user_quota - userQuota.usage_count;

  if (remaining <= 0) {
    const resetTime = new Date();
    resetTime.setHours(24, 0, 0, 0); // Next midnight

    return {
      allowed: false,
      reason: "user_quota_exceeded",
      userRemaining: 0,
      resetTime,
    };
  }

  return {
    allowed: true,
    userRemaining: remaining,
  };
}

/**
 * Check if server has remaining server-wide quota
 * Returns remaining quota and whether generation is allowed
 */
async function checkServerwideQuota(serverId: number, config: ImageQuotaConfigRow): Promise<QuotaCheckResult> {
  // If serverwide quota is 0 (unlimited), allow
  if (config.serverwide_quota === 0) {
    return { allowed: true };
  }

  const serverwideQuota = await touchServerwideImageQuota(serverId, config.serverwide_quota_resets_in);

  const now = new Date();
  const periodEnd = new Date(serverwideQuota.quota_period_end);

  if (now >= periodEnd) {
    const resetQuota = await resetServerwideImagePeriod(serverId, config.serverwide_quota_resets_in);

    return {
      allowed: true,
      serverwideRemaining: config.serverwide_quota,
      resetTime: new Date(resetQuota.quota_period_end),
    };
  }

  const remaining = config.serverwide_quota - serverwideQuota.usage_count;

  if (remaining <= 0) {
    return {
      allowed: false,
      reason: "serverwide_quota_exceeded",
      serverwideRemaining: 0,
      resetTime: periodEnd,
    };
  }

  return {
    allowed: true,
    serverwideRemaining: remaining,
    resetTime: periodEnd,
  };
}

/**
 * Check all quotas (user daily + server-wide)
 * Returns combined result indicating if generation is allowed
 */
export async function checkImageQuota(serverId: number, userDiscId: string): Promise<QuotaCheckResult> {
  const read = await getImageConfigResult(serverId);
  if (read.status === "unavailable") throw new QuotaUnavailableError();
  if (!read.config) return { allowed: true };

  try {
    const userCheck = await checkUserDailyQuota(serverId, userDiscId, read.config);
    if (!userCheck.allowed) {
      return userCheck;
    }

    const serverwideCheck = await checkServerwideQuota(serverId, read.config);
    if (!serverwideCheck.allowed) {
      return serverwideCheck;
    }

    return {
      allowed: true,
      userRemaining: userCheck.userRemaining,
      serverwideRemaining: serverwideCheck.serverwideRemaining,
      resetTime: serverwideCheck.resetTime,
    };
  } catch (error) {
    log.error("Failed to check image quota", error);
    throw new QuotaUnavailableError();
  }
}

/**
 * Claim one image generation on both counters or neither.
 * A database failure throws, so the caller refuses instead of spending an uncounted generation.
 */
export async function reserveImageQuota(serverId: number, userDiscId: string): Promise<ImageQuotaClaim> {
  const read = await getImageConfigResult(serverId);
  if (read.status === "unavailable") throw new QuotaUnavailableError();
  if (!read.config) return { allowed: true, reservation: null };

  let outcome: QuotaReservationOutcome;
  try {
    outcome = await reserveImageQuotaUnits(serverId, userDiscId, read.config);
  } catch (error) {
    log.error("Failed to reserve image quota", error);
    throw new QuotaUnavailableError();
  }

  if (outcome.status === "reserved") {
    return {
      allowed: true,
      reservation: outcome.reservation,
      ...(outcome.userRemaining !== undefined ? { userRemaining: outcome.userRemaining } : {}),
      ...(outcome.serverwideRemaining !== undefined ? { serverwideRemaining: outcome.serverwideRemaining } : {}),
      ...(outcome.serverwidePeriodEnd ? { resetTime: outcome.serverwidePeriodEnd } : {}),
    };
  }

  if (outcome.status === "user_quota_exceeded") {
    const resetTime = new Date();
    resetTime.setHours(24, 0, 0, 0); // Next midnight
    return { allowed: false, reason: "user_quota_exceeded", userRemaining: 0, resetTime, reservation: null };
  }

  return {
    allowed: false,
    reason: "serverwide_quota_exceeded",
    serverwideRemaining: 0,
    resetTime: outcome.periodEnd,
    reservation: null,
  };
}
