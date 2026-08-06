/**
 * Shared bounds for Discord message history fetch limits.
 * Used by runtime context building and /config message-fetch-limit validation.
 */

export const MIN_MESSAGE_FETCH_LIMIT = 20;
export const MAX_MESSAGE_FETCH_LIMIT = 100;
export const DEFAULT_MESSAGE_FETCH_LIMIT = 80;

/**
 * Normalize a configured fetch limit to a safe integer within allowed bounds.
 *
 * @returns Clamped integer fetch limit
 */
export function normalizeMessageFetchLimit(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_MESSAGE_FETCH_LIMIT;
  }

  return Math.min(MAX_MESSAGE_FETCH_LIMIT, Math.max(MIN_MESSAGE_FETCH_LIMIT, Math.trunc(value)));
}
