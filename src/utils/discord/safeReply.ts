import { log } from "@/utils/misc/logger";

/**
 * Discord API error codes that are expected during normal interaction lifecycle
 * and should be silently ignored rather than logged as warnings.
 *
 * - 10062: Unknown Interaction — the 3-second reply token has expired
 * - 40060: Interaction has already been acknowledged — a double-ack race
 */
const EXPECTED_DISCORD_CODES = new Set([10062, 40060]);

/**
 * Wraps a Discord reply/edit/delete promise, silently ignoring expected
 * interaction-timeout error codes (10062, 40060) and logging everything else
 * as a structured warning.
 *
 * Use this wherever a Discord interaction reply might race against token expiry:
 * error catch blocks, component collector timeouts, and deferred cleanup paths.
 *
 * @param promise - The Discord API promise to guard (editReply, deleteReply, etc.).
 * @param context - Optional label appended to the log entry for easier filtering.
 */
export async function safeReply(promise: Promise<unknown>, context?: string): Promise<void> {
  try {
    await promise;
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code !== undefined && EXPECTED_DISCORD_CODES.has(code)) return;
    log.warn(`safeReply: unexpected Discord error${context ? ` (${context})` : ""}`, err);
  }
}
