import { PrivacyLevel } from "@/types/db/schema";
import { getCachedBlacklistStatus, getCachedPrivacyLevel } from "@/utils/cache/userCache";
import { isPluralKitUserId } from "@/utils/bridges";
import { pluralKitRepository } from "@/utils/db/repositories/PluralKitRepository";

export type PluralKitHostProtection =
  | {
      protected: false;
      isPluralKitUser: boolean;
    }
  | {
      protected: true;
      isPluralKitUser: true;
      reason: "host_full_privacy" | "host_blacklisted";
      hostUserDiscId: string;
    };

/**
 * Checks host-account privacy/blacklist shields for a PluralKit synthetic user.
 * The member's own synthetic row is checked by normal memory code; this helper
 * adds the authorization side of the PK identity split.
 */
export async function getPluralKitHostProtection(
  targetUserDiscId: string,
  serverDiscId: string | null | undefined,
): Promise<PluralKitHostProtection> {
  if (!isPluralKitUserId(targetUserDiscId)) {
    return { protected: false, isPluralKitUser: false };
  }

  const memberContext = await pluralKitRepository.getMemberContextByUserDiscId(targetUserDiscId);
  const hostUserDiscIds = memberContext?.hostUserDiscIds ?? [];
  for (const hostUserDiscId of hostUserDiscIds) {
    if ((await getCachedPrivacyLevel(hostUserDiscId)) === PrivacyLevel.FULL) {
      return {
        protected: true,
        isPluralKitUser: true,
        reason: "host_full_privacy",
        hostUserDiscId,
      };
    }
  }

  if (serverDiscId) {
    for (const hostUserDiscId of hostUserDiscIds) {
      if (await getCachedBlacklistStatus(serverDiscId, hostUserDiscId)) {
        return {
          protected: true,
          isPluralKitUser: true,
          reason: "host_blacklisted",
          hostUserDiscId,
        };
      }
    }
  }

  return { protected: false, isPluralKitUser: true };
}
