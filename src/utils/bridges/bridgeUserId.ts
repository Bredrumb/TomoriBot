/**
 * Bridge utilities for detecting and parsing bridged user IDs and webhook usernames.
 *
 * Bridges relay external platform users into Discord via webhooks using the
 * convention: "[BridgeName|userId] DisplayName" (e.g., "[Matrix|@user:host] Alice").
 *
 * Functions here are intentionally bridge-agnostic so future bridges (IRC, XMPP, etc.)
 * can be supported by extending the relevant checks without touching call sites.
 */

/**
 * Returns true if the given string is a bridge user ID rather than a Discord snowflake.
 * Currently handles the Matrix @localpart:homeserver format.
 * Extend this function to support additional bridge ID formats as needed.
 *
 * @param id - The string to test (e.g., "@alice:matrix.org" or "123456789012345678")
 * @returns true if the string is a recognised bridge user ID
 */
export function isBridgeUserId(id: string): boolean {
  // Matrix: @localpart:homeserver
  return /^@[^:]+:[^:]+/.test(id);
}

/**
 * Strips the bridge prefix from a webhook username, returning only the display name.
 * Bridge webhook usernames follow the format: "[BridgeName|userId] DisplayName"
 *
 * If the string is not a bridge webhook username, it is returned unchanged.
 *
 * @param username - The raw webhook username (e.g., "[Matrix|@alice:matrix.org] Alice")
 * @returns The display name portion (e.g., "Alice"), or the original string if not a bridge webhook
 */
export function stripBridgePrefix(username: string): string {
  if (!username.startsWith("[")) return username;
  const bracketEnd = username.indexOf("]");
  if (bracketEnd === -1) return username;
  // Skip the closing bracket and the space after it ("] ")
  return username.slice(bracketEnd + 2);
}

/**
 * Extracts the bridge user ID from a bridge webhook username.
 * Bridge webhook usernames follow the format: "[BridgeName|userId] DisplayName"
 * This function returns the userId portion from inside the brackets.
 *
 * Returns null if the username is not in bridge webhook format.
 *
 * @param username - The raw webhook username (e.g., "[Matrix|@alice:matrix.org] Alice")
 * @returns The bridge user ID (e.g., "@alice:matrix.org"), or null if not a bridge webhook username
 */
export function extractBridgeUserId(username: string): string | null {
  // Matches "[BridgeName|userId] ..." and captures the userId portion
  const match = username.match(/^\[[^|]+\|([^\]]+)\]/);
  return match ? match[1] : null;
}

/**
 * Returns true if the provided webhook username encodes a Matrix bridge user.
 * This is case-insensitive with respect to the bridge label (e.g., "[Matrix|",
 * "[matrix|") because it relies on extracting the bracket payload instead of a
 * hardcoded prefix match.
 *
 * @param username - The raw webhook username from Discord
 * @returns true if the username is a bridge webhook and the embedded ID is Matrix-style
 */
export function isMatrixBridgeWebhookUsername(username: string): boolean {
  const bridgeUserId = extractBridgeUserId(username);
  return bridgeUserId !== null && isBridgeUserId(bridgeUserId);
}
