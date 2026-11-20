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
  allowed: boolean;
  reason?: "user_quota_exceeded" | "serverwide_quota_exceeded" | "disabled";
  userRemaining?: number;
  serverwideRemaining?: number;
  resetTime?: Date;
}

export interface ImageQuotaClaim extends QuotaCheckResult {
  reservation: QuotaReservation | null;
}

export async function getQuotaConfig(serverId: number): Promise<ImageQuotaConfigRow> {
  return getOrCreateImageConfig(serverId);
}

async function checkUserDailyQuota(
  serverId: number,
  userDiscId: string,
  config: ImageQuotaConfigRow,
): Promise<QuotaCheckResult> {
  if (config.daily_user_quota === 0) {
    return { allowed: true };
  }

  const today = new Date().toISOString().split("T")[0];

  const userQuota = await touchUserImageQuota(serverId, userDiscId, today);

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

async function checkServerwideQuota(serverId: number, config: ImageQuotaConfigRow): Promise<QuotaCheckResult> {
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

// Atomic reservation across both counters throws QuotaUnavailableError on DB failure, so callers fail closed instead
// of spending uncounted image quota.
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
