import type { Client } from "discord.js";
import { statRepository } from "@/utils/db/repositories/StatRepository";
import { getCommandCatalogEntries, loadCommandData } from "@/utils/discord/commandLoader";
import { log } from "@/utils/misc/logger";
import { isPrimaryProcess } from "@/utils/cluster/shardLeases";

// Grafana unused-command joins require command_catalog because stat_counters omits unused commands, and
// loadCommandData reuses its single-flight cache.
export default async (_client: Client): Promise<void> => {
  if (!isPrimaryProcess()) return;
  try {
    log.section("Syncing command catalog...");

    const { executionMap } = await loadCommandData();

    const entries = getCommandCatalogEntries(executionMap);

    if (isPrimaryProcess()) await statRepository.syncCommandCatalog(entries);
  } catch (error) {
    log.error("Failed to sync command catalog (non-critical)", error as Error);
  }
};
