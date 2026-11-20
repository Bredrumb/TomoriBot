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
  allowed: boolean; // Whether user can trigger text generation
  reason?: "user_quota_exceeded" | "serverwide_quota_exceeded" | "disabled"; // Reason if denied
  userRemaining?: number; // User's remaining quota for the day
  serverwideRemaining?: number; // Server's remaining quota for the period
  resetTime?: Date; // When the quota resets (for error messages)
}

export interface TextQuotaClaim extends TextQuotaCheckResult {
  reservation: QuotaReservation | null;
}

/**
 * Get or create server's text quota configuration
 * Creates default config if not exists (unlimited by default)
 */
export async function getTextQuotaConfig(serverId: number): Promise<TextQuotaConfigRow> {
  return getOrCreateTextConfig(serverId);
}

/**
 * Claim one text generation on both counters or neither.
 * A database failure throws, so the caller refuses instead of spending an uncounted generation.
 */
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
