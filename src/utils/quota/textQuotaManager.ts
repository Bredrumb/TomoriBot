import { log } from "@/utils/misc/logger";
import type { TextQuotaConfigRow } from "@/types/db/schema";
import { QuotaUnavailableError } from "@/utils/quota/quotaErrors";
import {
  getOrCreateTextConfig,
  getTextConfigResult,
  reserveTextQuotaUnits,
  type QuotaReservation,
  type QuotaReservationOutcome,
} from "@/utils/db/repositories/QuotaRepository";

export { releaseTextQuotaUnits as releaseTextQuota } from "@/utils/db/repositories/QuotaRepository";

export interface TextQuotaCheckResult {
  allowed: boolean;
  reason?: "user_quota_exceeded" | "serverwide_quota_exceeded" | "disabled";
  userRemaining?: number;
  serverwideRemaining?: number;
  resetTime?: Date;
}

export interface TextQuotaClaim extends TextQuotaCheckResult {
  reservation: QuotaReservation | null;
}

export async function getTextQuotaConfig(serverId: number): Promise<TextQuotaConfigRow> {
  return getOrCreateTextConfig(serverId);
}

// Atomic reservation across both counters throws QuotaUnavailableError on DB failure, so callers fail closed instead
// of spending uncounted text quota.
export async function reserveTextQuota(serverId: number, userDiscId: string): Promise<TextQuotaClaim> {
  const read = await getTextConfigResult(serverId);
  if (read.status === "unavailable") throw new QuotaUnavailableError();
  if (!read.config) return { allowed: true, reservation: null };

  let outcome: QuotaReservationOutcome;
  try {
    outcome = await reserveTextQuotaUnits(serverId, userDiscId, read.config);
  } catch (error) {
    log.error("Failed to reserve text quota", error);
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
