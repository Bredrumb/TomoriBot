import { log } from "@/utils/misc/logger";

// Discord codes 10062 (expired 3-second interaction token) and 40060 (already-acknowledged race) are expected in
// normal lifecycle, so they are silenced.
const EXPECTED_DISCORD_CODES = new Set([10062, 40060]);

export async function safeReply(promise: Promise<unknown>, context?: string): Promise<void> {
  try {
    await promise;
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code !== undefined && EXPECTED_DISCORD_CODES.has(code)) return;
    log.warn(`safeReply: unexpected Discord error${context ? ` (${context})` : ""}`, err);
  }
}
