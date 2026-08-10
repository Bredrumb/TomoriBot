import { PrivacyLevel } from "@/types/db/schema";
import { getCachedBlacklistStatus, getCachedPrivacyLevel } from "@/utils/cache/userCache";
import { isChatProxyIdentityUserId } from "@/utils/chatProxy/identityUserId";
import { chatProxyRepository } from "@/utils/db/repositories/ChatProxyRepository";

export type ChatProxyHostProtection =
  | {
      protected: false;
      isChatProxyIdentity: boolean;
    }
  | {
      protected: true;
      isChatProxyIdentity: true;
      reason: "host_full_privacy" | "host_blacklisted";
      hostUserDiscId: string;
    };

/**
 * Checks host-account privacy/blacklist shields for a chat-proxy synthetic user.
 * The identity's own synthetic row is checked by normal memory code; this helper
 * adds the authorization side of the chat-proxy identity split.
 */
export async function getChatProxyHostProtection(
  targetUserDiscId: string,
  serverDiscId: string | null | undefined,
): Promise<ChatProxyHostProtection> {
  if (!isChatProxyIdentityUserId(targetUserDiscId)) {
    return { protected: false, isChatProxyIdentity: false };
  }

  const identityContext = await chatProxyRepository.getIdentityContextByUserDiscId(targetUserDiscId);
  const hostUserDiscIds = identityContext?.hostUserDiscIds ?? [];
  for (const hostUserDiscId of hostUserDiscIds) {
    if ((await getCachedPrivacyLevel(hostUserDiscId)) === PrivacyLevel.FULL) {
      return {
        protected: true,
        isChatProxyIdentity: true,
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
          isChatProxyIdentity: true,
          reason: "host_blacklisted",
          hostUserDiscId,
        };
      }
    }
  }

  return { protected: false, isChatProxyIdentity: true };
}
