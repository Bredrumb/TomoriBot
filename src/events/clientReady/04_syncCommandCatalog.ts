import type { Client } from "discord.js";
import { statRepository } from "@/utils/db/repositories/StatRepository";
import { getCommandCatalogEntries, loadCommandData } from "@/utils/discord/commandLoader";
import { log } from "@/utils/misc/logger";

/**
 * Reconciles the `command_catalog` dimension table with the commands the bot
 * actually loaded this boot.
 *
 * This is what makes the Grafana "least-used / never-used commands" panel possible
 * without a hardcoded list: stat_counters only ever holds rows for commands that
 * have been used, so the full universe of commands has to be materialized somewhere
 * a SQL query can JOIN against. loadCommandData() already knows that universe, so we
 * flatten it to the same space-joined paths stat_counters stores and hand it to
 * StatRepository.syncCommandCatalog (upsert current + prune removed).
 *
 * loadCommandData() is single-flight cached, so re-calling it here (after
 * 01_registercommands already loaded it) is effectively free. Non-critical: a
 * failure only leaves the catalog stale for a boot; command handling is unaffected.
 */
export default async (_client: Client): Promise<void> => {
  try {
    log.section("Syncing command catalog...");

    // Pull the loaded command universe (cached from command registration).
    const { executionMap } = await loadCommandData();

    // Flatten to space-joined paths matching stat_counters.metric_key.
    const entries = getCommandCatalogEntries(executionMap);

    // Reconcile the catalog table (skips prune on an empty/failed load).
    await statRepository.syncCommandCatalog(entries);
  } catch (error) {
    log.error("Failed to sync command catalog (non-critical)", error as Error);
    // Non-critical, so the Grafana unused-command panel may be stale, but the bot
    // functions normally.
  }
};
