import { type Client, REST, Routes } from "discord.js";
import { log } from "../../utils/misc/logger";
import { loadCommandData } from "../../utils/discord/commandLoader";
import type { ErrorContext } from "../../types/db/schema";
import { resolveEnvironment } from "@/types/config";

/**
 * Event handler for registering commands when the bot is ready
 */
export default async (client: Client): Promise<void> => {
  try {
    log.section("Registering application commands");

    // DYNAMIC FIX: Get the ID directly from the logged-in client
    // We still use process.env.DISCORD_TOKEN since we know it exists (bot wouldn't be running without it)
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

    // Register globally for both production and development
    // Guild-only restrictions are handled via InteractionContextType in command definitions
    log.info("Registering commands globally");

    try {
      await rest.put(Routes.applicationCommands(applicationId), {
        body: registrationData,
      });
      log.success(`Successfully registered ${registrationData.length} commands globally`);

      const testGuildId = process.env.TESTSRV_ID;
      if (resolveEnvironment() !== "production" && testGuildId) {
        await rest.put(Routes.applicationGuildCommands(applicationId, testGuildId), {
          body: registrationData,
        });
        log.success(`Successfully registered ${registrationData.length} commands in test guild ${testGuildId}`);
      }
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
