const MAX_ENTRIES = 2000;
const messageIds = new Set<string>();

export function hasNegativeChatProxyMessageIdentity(messageDiscId: string): boolean {
  return messageIds.has(messageDiscId);
}

export function rememberNegativeChatProxyMessageIdentity(messageDiscId: string): void {
  if (messageIds.has(messageDiscId)) return;
  if (messageIds.size >= MAX_ENTRIES) {
    const oldest = messageIds.values().next().value;
    if (oldest !== undefined) messageIds.delete(oldest);
  }
  messageIds.add(messageDiscId);
}

export function forgetNegativeChatProxyMessageIdentity(messageDiscId: string): void {
  messageIds.delete(messageDiscId);
}

export function clearNegativeChatProxyMessageIdentityCacheForTests(): void {
  messageIds.clear();
}
