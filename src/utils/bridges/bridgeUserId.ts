export function isBridgeUserId(id: string): boolean {
  // Matrix: @localpart:homeserver
  return /^@[^:]+:[^:]+/.test(id);
}

export function stripBridgePrefix(username: string): string {
  if (!username.startsWith("[")) return username;
  const bracketEnd = username.indexOf("]");
  if (bracketEnd === -1) return username;
  return username.slice(bracketEnd + 2);
}

export function extractBridgeUserId(username: string): string | null {
  const match = username.match(/^\[[^|]+\|([^\]]+)\]/);
  return match ? match[1] : null;
}

export function isMatrixBridgeWebhookUsername(username: string): boolean {
  const bridgeUserId = extractBridgeUserId(username);
  return bridgeUserId !== null && isBridgeUserId(bridgeUserId);
}
