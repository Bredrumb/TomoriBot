import type { Client } from "discord.js";
import { log } from "@/utils/misc/logger";
import { getShardTopology } from "@/utils/discord/shardOwnership";

export function assertBridgeTopology(): void {
  const configured = Boolean(
    process.env.MATRIX_HOMESERVER_URL &&
      process.env.MATRIX_ACCESS_TOKEN &&
      process.env.MATRIX_HS_TOKEN &&
      process.env.MATRIX_BOT_USER_ID &&
      process.env.MATRIX_SERVER_NAME,
  );
  if (configured && !getShardTopology().ownsAllShards()) {
    throw new Error("The Matrix bridge requires one process owning every shard; unset SHARD_IDS or disable the bridge");
  }
}

export async function stopBridges(): Promise<void> {
  const { getMatrixBridge, setMatrixBridge, setMatrixSettings } = await import("@/utils/bridges/matrix/state");
  const bridge = getMatrixBridge();
  setMatrixBridge(null);
  setMatrixSettings(null);
  await bridge?.close();
}

/**
 * Initializes optional integration bridges (currently: Matrix Appservice).
 * Silent no-op if credentials are not configured.
 *
 */
export async function initBridges(client: Client): Promise<void> {
  assertBridgeTopology();
  log.section("Initializing Matrix Bridge...");
  try {
    const { initializeMatrixClient } = await import("@/utils/bridges/matrix");
    await initializeMatrixClient(client);
  } catch (error) {
    // Extract message/stack before passing to logger, because the bridge error object
    // contains circular references that crash JSON serialization inside log.warn()
    const safeMsg = error instanceof Error ? error.message : String(error);
    const safeStack = error instanceof Error ? error.stack : undefined;
    log.warn(`Matrix bridge initialization failed (non-critical): ${safeMsg}\n${safeStack ?? ""}`);
  }
}
