import { isBridgeUserId } from "@/utils/bridges/bridgeUserId";
import { isMessageProxyIdentityUserId } from "@/utils/messageProxy/identityUserId";

export function isExternalUserId(id: string): boolean {
  return isBridgeUserId(id) || isMessageProxyIdentityUserId(id);
}
