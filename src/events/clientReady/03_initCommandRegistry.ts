import type { Client } from "discord.js";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { log } from "@/utils/misc/logger";

/**
 * Event handler for initializing the command registry after commands are registered.
 * This must run after 01_registercommands.ts to ensure all commands are available.
 */
export default async (client: Client): Promise<void> => {
  try {
    log.section("Initializing Command Registry...");

    await commandRegistry.initialize(client);

    if ((process.env.RUN_ENV || "development") !== "production") {
      const commands = commandRegistry.getRegisteredCommands();
      log.info(`Command registry entries: ${commands.join(", ")}`);
    }
  } catch (error) {
    log.error("Failed to initialize command registry (non-critical)", error as Error);
    // Non-critical - bot can still function, but command mentions won't work
  }
};
