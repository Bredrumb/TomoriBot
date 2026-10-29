import { log } from "@/utils/misc/logger";
import type { VideoQuotaConfigRow } from "@/types/db/schema";
import { QuotaUnavailableError } from "@/utils/quota/quotaErrors";
import {
  getOrCreateVideoConfig,
  getVideoConfigResult,
  reserveVideoQuotaUnits,
  resetServerwideVideoPeriod,
  touchServerwideVideoQuota,
  touchUserVideoQuota,
  type QuotaReservation,
  type QuotaReservationOutcome,
} from "@/utils/db/repositories/QuotaRepository";

export { releaseVideoQuotaUnits as releaseVideoQuota } from "@/utils/db/repositories/QuotaRepository";

/** Shares the same shape as image quota checks for consistency. */
export interface VideoQuotaCheckResult {
  allowed: boolean;
  reason?: "user_quota_exceeded" | "serverwide_quota_exceeded" | "disabled";
  userRemaining?: number;
  serverwideRemaining?: number;
  resetTime?: Date;
}

export interface VideoQuotaClaim extends VideoQuotaCheckResult {
  reservation: QuotaReservation | null;
}

/**
 * Get or create server's video quota configuration.
 * Creates default config if not exists (3 daily user quota, unlimited serverwide).
 * Lower default than image quotas because video generation is more expensive.
 */
export async function getVideoQuotaConfig(serverId: number): Promise<VideoQuotaConfigRow> {
  return getOrCreateVideoConfig(serverId);
}

/**
 * Check if user can generate a video based on daily quota.
 * Returns remaining quota and whether generation is allowed.
 */
async function checkUserDailyVideoQuota(
  serverId: number,
  userDiscId: string,
  config: VideoQuotaConfigRow,
): Promise<VideoQuotaCheckResult> {
  // If daily user quota is 0 (unlimited), allow
  if (config.daily_user_quota === 0) {
    return { allowed: true };
  }

  const today = new Date().toISOString().split("T")[0];

  const userQuota = await touchUserVideoQuota(serverId, userDiscId, today);

  const remaining = config.daily_user_quota - userQuota.usage_count;

  if (remaining <= 0) {
    const resetTime = new Date();
    resetTime.setHours(24, 0, 0, 0);

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
 * Check if server has remaining server-wide video quota.
 */
async function checkServerwideVideoQuota(
  serverId: number,
  config: VideoQuotaConfigRow,
): Promise<VideoQuotaCheckResult> {
  // If serverwide quota is 0 (unlimited), allow
  if (config.serverwide_quota === 0) {
    return { allowed: true };
  }

  const serverwideQuota = await touchServerwideVideoQuota(serverId, config.serverwide_quota_resets_in);

  const now = new Date();
  const periodEnd = new Date(serverwideQuota.quota_period_end);

  if (now >= periodEnd) {
    const resetQuota = await resetServerwideVideoPeriod(serverId, config.serverwide_quota_resets_in);

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
 * Check all video quotas (user daily + server-wide).
 * Returns combined result indicating if generation is allowed.
 */
export async function checkVideoQuota(serverId: number, userDiscId: string): Promise<VideoQuotaCheckResult> {
  const read = await getVideoConfigResult(serverId);
  if (read.status === "unavailable") throw new QuotaUnavailableError();
  if (!read.config) return { allowed: true };

  try {
    const userCheck = await checkUserDailyVideoQuota(serverId, userDiscId, read.config);
    if (!userCheck.allowed) {
      return userCheck;
    }

    const serverwideCheck = await checkServerwideVideoQuota(serverId, read.config);
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
    log.error("Failed to check video quota", error);
    throw new QuotaUnavailableError();
  }
}

/**
 * Claim one video generation on both counters or neither.
 * A database failure throws, so the caller refuses instead of spending an uncounted generation.
 */
export async function reserveVideoQuota(serverId: number, userDiscId: string): Promise<VideoQuotaClaim> {
  const read = await getVideoConfigResult(serverId);
  if (read.status === "unavailable") throw new QuotaUnavailableError();
  if (!read.config) return { allowed: true, reservation: null };

  let outcome: QuotaReservationOutcome;
  try {
    outcome = await reserveVideoQuotaUnits(serverId, userDiscId, read.config);
  } catch (error) {
    log.error("Failed to reserve video quota", error);
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
    resetTime.setHours(24, 0, 0, 0);
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
