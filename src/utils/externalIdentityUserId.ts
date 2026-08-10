import { isBridgeUserId } from "@/utils/bridges/bridgeUserId";
import { isChatProxyIdentityUserId } from "@/utils/chatProxy/identityUserId";

/** Returns true when an identifier must never be sent to a Discord snowflake API. */
export function isExternalUserId(id: string): boolean {
  return isBridgeUserId(id) || isChatProxyIdentityUserId(id);
}
