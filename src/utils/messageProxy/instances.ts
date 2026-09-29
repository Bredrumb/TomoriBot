export type MessageProxyInstanceId = string;
export type MessageProxyTokenRecordKey = MessageProxyInstanceId;

export type MessageProxyInstanceContext = Readonly<{
  serviceId: string;
  instanceId: MessageProxyInstanceId;
  origin: string;
}>;

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
