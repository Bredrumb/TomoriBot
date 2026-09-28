import {
  messageProxyServiceRegistry,
  type ProxyServiceRegistry,
  type ProxyServiceId,
} from "@/utils/messageProxy/registry";

export type ParsedMessageProxyIdentityUserId = {
  serviceId: ProxyServiceId;
  externalKey: string;
};

export function formatMessageProxyIdentityUserId(serviceId: ProxyServiceId, externalKey: string): string {
  return formatMessageProxyIdentityUserIdFromRegistry(serviceId, externalKey, messageProxyServiceRegistry);
}

export function formatMessageProxyIdentityUserIdFromRegistry<TServiceId extends string>(
  serviceId: TServiceId,
  externalKey: string,
  registry: ProxyServiceRegistry<TServiceId>,
): string {
  const descriptor = registry.get(serviceId);
  if (!descriptor?.validateExternalKey(externalKey)) {
    throw new Error(`Invalid external key for message-proxy service ${serviceId}`);
  }
  return `${descriptor.syntheticUserPrefix}${externalKey}`;
}

export function parseMessageProxyIdentityUserId(userDiscId: string): ParsedMessageProxyIdentityUserId | null {
  return parseMessageProxyIdentityUserIdFromRegistry(userDiscId, messageProxyServiceRegistry);
}

export function parseMessageProxyIdentityUserIdFromRegistry<TServiceId extends string>(
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

export function isMessageProxyIdentityUserId(userDiscId: string): boolean {
  return parseMessageProxyIdentityUserId(userDiscId) !== null;
}
