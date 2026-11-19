import { type Client, REST, Routes } from "discord.js";
import { log } from "@/utils/misc/logger";
import { loadCommandData } from "@/utils/discord/commandLoader";
import type { ErrorContext } from "@/types/db/schema";
import { isPrimaryProcess } from "@/utils/cluster/shardLeases";

export default async (client: Client): Promise<void> => {
  if (!isPrimaryProcess()) return;
  try {
    log.section("Registering application commands");

    const discordToken = process.env.DISCORD_TOKEN;
    const applicationId = client.user?.id || client.application?.id;

    if (!discordToken || !applicationId) {
      const context: ErrorContext = {
        errorType: "CommandRegistrationError",
        metadata: { stage: "environment" },
      };
      await log.error(
        "Missing required credentials for command registration",
        new Error("DISCORD_TOKEN or Client ID could not be determined"),
        context,
      );
      return;
    }

    const { registrationData } = await loadCommandData();

    if (registrationData.length === 0) {
      log.warn("No commands found to register");
      return;
    }

    log.info(`Preparing to register ${registrationData.length} top-level commands`);

    const rest = new REST().setToken(discordToken);

    // Guild-only commands enforce scope via InteractionContextType rather than guild-scoped registration.
    log.info("Registering commands globally");

    try {
      if (!isPrimaryProcess()) return;
      await rest.put(Routes.applicationCommands(applicationId), {
        body: registrationData,
      });
      log.success(`Successfully registered ${registrationData.length} commands globally`);
    } catch (error) {
      const context: ErrorContext = {
        errorType: "CommandRegistrationError",
        metadata: { scope: "global" },
      };
      await log.error("Failed to register commands globally:", error, context);
    }
  } catch (error) {
    const context: ErrorContext = {
      errorType: "CommandRegistrationError",
      metadata: { stage: "initialization" },
    };
    await log.error("Error during command registration process:", error, context);
  }
};
