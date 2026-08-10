import { chatProxyServiceRegistry, type ProxyServiceRegistry, type ProxyServiceId } from "@/utils/chatProxy/registry";

export type ParsedChatProxyIdentityUserId = {
  serviceId: ProxyServiceId;
  externalKey: string;
};

export function formatChatProxyIdentityUserId(serviceId: ProxyServiceId, externalKey: string): string {
  return formatChatProxyIdentityUserIdFromRegistry(serviceId, externalKey, chatProxyServiceRegistry);
}

export function formatChatProxyIdentityUserIdFromRegistry<TServiceId extends string>(
  serviceId: TServiceId,
  externalKey: string,
  registry: ProxyServiceRegistry<TServiceId>,
): string {
  const descriptor = registry.get(serviceId);
  if (!descriptor?.validateExternalKey(externalKey)) {
    throw new Error(`Invalid external key for chat-proxy service ${serviceId}`);
  }
  return `${descriptor.syntheticUserPrefix}${externalKey}`;
}

export function parseChatProxyIdentityUserId(userDiscId: string): ParsedChatProxyIdentityUserId | null {
  return parseChatProxyIdentityUserIdFromRegistry(userDiscId, chatProxyServiceRegistry);
}

export function parseChatProxyIdentityUserIdFromRegistry<TServiceId extends string>(
  userDiscId: string,
  registry: ProxyServiceRegistry<TServiceId>,
): { serviceId: TServiceId; externalKey: string } | null {
  for (const descriptor of registry.values()) {
    if (!userDiscId.startsWith(descriptor.syntheticUserPrefix)) continue;
    const externalKey = userDiscId.slice(descriptor.syntheticUserPrefix.length);
    if (!descriptor.validateExternalKey(externalKey)) return null;
    return { serviceId: descriptor.serviceId, externalKey };
  }
  return null;
}

export function isChatProxyIdentityUserId(userDiscId: string): boolean {
  return parseChatProxyIdentityUserId(userDiscId) !== null;
}
