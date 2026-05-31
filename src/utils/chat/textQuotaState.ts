import type { TextQuotaCheckResult } from "@/utils/quota/textQuotaManager";
import { localizer } from "@/utils/text/localizer";

const TEXT_QUOTA_TRIGGER_TTL_MS = 10 * 60 * 1000;
export interface TextQuotaTriggerState {
  serverId: number;
  userDiscId: string;
  consumed: boolean;
  createdAt: number;
}

export const textQuotaTriggerStates = new Map<string, TextQuotaTriggerState>();
export function cleanupTextQuotaTriggerStates(): void {
  const now = Date.now();
  for (const [triggerKey, state] of textQuotaTriggerStates.entries()) {
    if (now - state.createdAt >= TEXT_QUOTA_TRIGGER_TTL_MS) {
      textQuotaTriggerStates.delete(triggerKey);
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
