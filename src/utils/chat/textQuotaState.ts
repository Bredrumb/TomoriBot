import type { QuotaReservation } from "@/utils/db/repositories/QuotaRepository";
import type { TextQuotaCheckResult } from "@/utils/quota/textQuotaManager";
import { releaseTextQuota } from "@/utils/quota/textQuotaManager";
import { localizer } from "@/utils/text/localizer";

const TEXT_QUOTA_TRIGGER_TTL_MS = 10 * 60 * 1000;
export interface TextQuotaTriggerState {
  serverId: number;
  userDiscId: string;
  consumed: boolean;
  reservation: QuotaReservation | null;
  reservationReleased: boolean;
  createdAt: number;
}

export const textQuotaTriggerStates = new Map<string, TextQuotaTriggerState>();

/**
 * Trigger keys whose server-side admission was refused, by the time it was refused.
 *
 * A refusal stores no quota state (nothing was granted), so without this a reply that runs several
 * persona turns against one trigger would take the check again and post one quota embed per turn.
 */
const refusedTextQuotaTriggers = new Map<string, number>();

export function markTextQuotaRefused(triggerKey: string): void {
  refusedTextQuotaTriggers.set(triggerKey, Date.now());
}

export function hasTextQuotaBeenRefused(triggerKey: string): boolean {
  return refusedTextQuotaTriggers.has(triggerKey);
}

/**
 * Trigger keys that have already shown one credential refusal, so later persona turns of the same
 * reply stay silent.
 */
const reportedCredentialRefusals = new Map<string, number>();

export function claimCredentialRefusalNotice(triggerKey: string): boolean {
  if (reportedCredentialRefusals.has(triggerKey)) return false;
  reportedCredentialRefusals.set(triggerKey, Date.now());
  return true;
}

/** Gives back the unit a trigger reserved when no turn in that trigger produced a reply. */
export async function releaseTextQuotaForTrigger(triggerKey: string): Promise<void> {
  const state = textQuotaTriggerStates.get(triggerKey);
  if (!state || state.consumed || !state.reservation) return;

  const reservation = state.reservation;
  // Cleared before the write so a second release for the same trigger cannot double-decrement.
  state.reservation = null;
  state.reservationReleased = true;
  textQuotaTriggerStates.set(triggerKey, state);
  await releaseTextQuota(state.serverId, state.userDiscId, reservation);
}

export function cleanupTextQuotaTriggerStates(): void {
  const now = Date.now();
  for (const [triggerKey, state] of textQuotaTriggerStates.entries()) {
    if (now - state.createdAt >= TEXT_QUOTA_TRIGGER_TTL_MS) {
      textQuotaTriggerStates.delete(triggerKey);
    }
  }
  for (const [triggerKey, refusedAt] of refusedTextQuotaTriggers.entries()) {
    if (now - refusedAt >= TEXT_QUOTA_TRIGGER_TTL_MS) {
      refusedTextQuotaTriggers.delete(triggerKey);
    }
  }
  for (const [triggerKey, reportedAt] of reportedCredentialRefusals.entries()) {
    if (now - reportedAt >= TEXT_QUOTA_TRIGGER_TTL_MS) {
      reportedCredentialRefusals.delete(triggerKey);
    }
  }
}

export function buildTextQuotaResetInfo(locale: string, quotaCheck: TextQuotaCheckResult): string {
  if (!quotaCheck.resetTime) {
    return "";
  }

  const resetTime = quotaCheck.resetTime;
  const now = new Date();
  const diffMs = resetTime.getTime() - now.getTime();
  const hoursUntilReset = Math.ceil(diffMs / (1000 * 60 * 60));

  if (hoursUntilReset <= 24) {
    return localizer(locale, "genai.text_quota_resets_in_hours", {
      hours: hoursUntilReset.toString(),
    });
  }

  const daysUntilReset = Math.ceil(hoursUntilReset / 24);
  return localizer(locale, "genai.text_quota_resets_in_days", {
    days: daysUntilReset.toString(),
  });
}
