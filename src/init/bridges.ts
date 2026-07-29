import type { Client } from "discord.js";
import { log } from "@/utils/misc/logger";

/**
 * Initializes optional integration bridges (currently: Matrix Appservice).
 * Silent no-op if credentials are not configured.
 *
 */
export async function initBridges(client: Client): Promise<void> {
  log.section("Initializing Matrix Bridge...");
  try {
    const { initializeMatrixClient } = await import("@/utils/bridges/matrix");
    await initializeMatrixClient(client);
  } catch (error) {
    // Extract message/stack before passing to logger — the bridge error object
    // contains circular references that crash JSON serialization inside log.warn()
    const safeMsg = error instanceof Error ? error.message : String(error);
    const safeStack = error instanceof Error ? error.stack : undefined;
    log.warn(`Matrix bridge initialization failed (non-critical): ${safeMsg}\n${safeStack ?? ""}`);
  }
}
