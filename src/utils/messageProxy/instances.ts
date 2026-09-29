import type { ProxyServiceId } from "@/utils/messageProxy/registry";

export type MessageProxyInstanceId = string;
export type MessageProxyTokenRecordKey = MessageProxyInstanceId;

export type MessageProxyInstanceContext = Readonly<{
  serviceId: ProxyServiceId;
  instanceId: MessageProxyInstanceId;
  origin: string;
}>;

export const OFFICIAL_MESSAGE_PROXY_INSTANCES = {
  pluralkit: { serviceId: "pluralkit", instanceId: "pluralkit:official", origin: "https://api.pluralkit.me" },
  pluralbuddy: { serviceId: "pluralbuddy", instanceId: "pluralbuddy:official", origin: "https://pluralbuddy.app" },
} as const satisfies Record<ProxyServiceId, MessageProxyInstanceContext>;

export function officialMessageProxyInstance(serviceId: ProxyServiceId): MessageProxyInstanceContext {
  return OFFICIAL_MESSAGE_PROXY_INSTANCES[serviceId];
}

export function canonicalMessageProxyOrigin(input: string): string | null {
  try {
    const url = new URL(input);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.hostname.endsWith(".")
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
