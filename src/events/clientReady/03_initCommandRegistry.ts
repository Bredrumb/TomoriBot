import type { Client } from "discord.js";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { log } from "@/utils/misc/logger";

// Must run after 01_registercommands.ts so all application commands are registered before the command registry
// initializes.
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
  }
};
