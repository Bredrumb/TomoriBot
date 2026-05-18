import { MessageFlags, type Client, type Interaction } from "discord.js";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import { ColorCode, log } from "../../utils/misc/logger";
import type { UserRow, ErrorContext } from "../../types/db/schema";
import { cooldownRepository, userRepository } from "@/utils/db/repositories";
import { loadCommandData, type CommandExecutionMap, type CommandCooldownMap } from "../../utils/discord/commandLoader";
import { resolvePreferredDiscordDisplayName } from "../../utils/discord/displayName";

// Define constants at the top (Rule #20)
const DEFAULT_COOLDOWN = Number.parseInt(process.env.DEFAULT_COMMAND_COOLDOWN || "1600", 10); // Default cooldown for all commands in milliseconds

const COOLDOWN_MAP = new Map<string, number>([
  ["config", Number.parseInt(process.env.COOLDOWN_CONFIG || "3000", 10)],
  ["persona", Number.parseInt(process.env.COOLDOWN_PERSONA || "10000", 10)],
  [
    "memory",
    Number.parseInt(
      process.env.COOLDOWN_MEMORY || process.env.COOLDOWN_TEACH || process.env.COOLDOWN_FORGET || "3000",
      10,
    ),
  ],
  ["server", Number.parseInt(process.env.COOLDOWN_SERVER || "3000", 10)],
  ["personal", Number.parseInt(process.env.COOLDOWN_PERSONAL || "3000", 10)],
  ["scheduled-task", Number.parseInt(process.env.COOLDOWN_PERSONAL || "3000", 10)],
  ["conditioning", Number.parseInt(process.env.COOLDOWN_CONDITIONING || process.env.COOLDOWN_SERVER || "3000", 10)],
]);

// Cache for command execution maps - stored at module level
let executionMap: CommandExecutionMap | null = null;
let cooldownMap: CommandCooldownMap | null = null;

/**
 * Checks if a command is on cooldown for a user
 * @param userId - Discord user ID
 * @param category - Command category
 * @returns Boolean indicating if command is on cooldown
 */
async function checkCooldown(userId: string, category: string): Promise<boolean> {
  return cooldownRepository.hasCommandCategoryCooldown(userId, category);
}

/**
 * Gets the remaining cooldown time in seconds
 * @param userId - Discord user ID
 * @param category - Command category
 * @returns Remaining cooldown time in seconds
 */
async function getRemainingCooldown(userId: string, category: string): Promise<number> {
  return cooldownRepository.getRemainingCommandCategoryCooldownSeconds(userId, category);
}

/**
 * Sets a cooldown for a command category
 * @param userId - Discord user ID
 * @param category - Command category
 * @param duration - Cooldown duration in milliseconds
 */
async function setCooldown(userId: string, category: string, duration: number): Promise<void> {
  await cooldownRepository.setCommandCategoryCooldown(userId, category, duration);
}

const handler = async (client: Client, interaction: Interaction): Promise<void> => {
  if (!interaction.isChatInputCommand()) return;

  // Determine locale early for potential error messages
  const initialLocale = interaction.locale ?? interaction.guildLocale ?? "en-US";

  try {
    // 1. Load command data on first run if cache is empty
    if (!executionMap || !cooldownMap) {
      log.info("Initializing command execution maps...");
      const loadedData = await loadCommandData();
      executionMap = loadedData.executionMap;
      cooldownMap = loadedData.cooldownMap;

      // Use our existing cooldown values if none were provided from commands
      if (cooldownMap.size === 0) {
        for (const [category, duration] of COOLDOWN_MAP.entries()) {
          cooldownMap.set(category, duration);
        }
      }

      log.success("Command execution maps initialized.");
    }

    // 2. Get command, group, and subcommand names
    const commandName = interaction.commandName; // The top-level command (category)
    const groupName = interaction.options.getSubcommandGroup(false); // The subcommand group (null for flat commands)
    const subcommandName = interaction.options.getSubcommand(false); // The specific subcommand (may be null)

    // Guild-only subcommand restrictions are now handled at the Discord registration level
    // Commands in guild-only categories (like "server") are automatically restricted to guilds

    // 3. Find the execute function
    const subcommandMap = executionMap.get(commandName);
    if (!subcommandMap) {
      // Top-level command not found
      log.warn(`Command category not found: ${commandName}`);
      await replyInfoEmbed(
        interaction,
        initialLocale,
        {
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        },
        MessageFlags.Ephemeral,
      );
      return;
    }

    // If no subcommand was specified but we require one
    if (!subcommandName) {
      log.warn(`No subcommand specified for category: ${commandName}`);
      await replyInfoEmbed(
        interaction,
        initialLocale,
        {
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        },
        MessageFlags.Ephemeral,
      );
      return;
    }

    // Build execution key based on whether command is grouped or flat
    const executionKey = groupName ? `${groupName}.${subcommandName}` : subcommandName;

    // Get the execute function for this subcommand
    const executeFunction = subcommandMap.get(executionKey);
    if (!executeFunction) {
      const fullCommandPath = groupName
        ? `${commandName} ${groupName} ${subcommandName}`
        : `${commandName} ${subcommandName}`;
      log.warn(`Subcommand not found: ${fullCommandPath}`);
      await replyInfoEmbed(
        interaction,
        initialLocale,
        {
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        },
        MessageFlags.Ephemeral,
      );
      return;
    }

    // --- Start of main logic execution with timeout ---
    const mainLogicPromise = async () => {
      // 4. Check cooldowns based on the category (top-level command)
      // Use DEFAULT_COOLDOWN if no specific cooldown is defined for this category
      const cooldownDuration =
        // biome-ignore lint/style/noNonNullAssertion: We've checked it's not null before entering this block
        cooldownMap!.get(commandName) ?? DEFAULT_COOLDOWN;

      // Check if user is on cooldown for this command category
      const isOnCooldown = await checkCooldown(interaction.user.id, commandName);
      if (isOnCooldown) {
        const remainingSeconds = await getRemainingCooldown(interaction.user.id, commandName);
        await replyInfoEmbed(
          interaction,
          initialLocale,
          {
            titleKey: "general.cooldown_title",
            descriptionKey: "general.cooldown",
            descriptionVars: {
              seconds: remainingSeconds,
              category: commandName,
            },
            color: ColorCode.WARN,
          },
          MessageFlags.Ephemeral,
        );
        return;
      }

      // Set new cooldown for this command category
      await setCooldown(interaction.user.id, commandName, cooldownDuration);

      // 5. Get or create user data
      let userData: UserRow | undefined;
      const existingUser = await userRepository.loadByDiscordId(interaction.user.id);

      if (existingUser) {
        userData = existingUser;
      } else {
        // Get locale to use for new user (works for both guilds and DMs)
        const userLanguage = interaction.locale;
        const memberDisplayName =
          interaction.member && typeof interaction.member === "object"
            ? "displayName" in interaction.member
              ? interaction.member.displayName
              : "nick" in interaction.member && typeof interaction.member.nick === "string"
                ? interaction.member.nick
                : null
            : null;

        // Use the userRepository.register helper (Rule #17) - works for both guild and DM contexts
        const registeredUser = await userRepository.register(
          interaction.user.id,
          resolvePreferredDiscordDisplayName({
            memberDisplayName,
            user: interaction.user,
          }),
          userLanguage,
        );

        if (registeredUser) {
          userData = registeredUser;
        }
      }

      // Get the final locale once user data is potentially available
      const finalLocale = userData?.language_pref ?? interaction.guildLocale ?? "en-US";

      // 6. Execute command
      if (userData) {
        await executeFunction(client, interaction, userData, finalLocale);
      } else {
        // Handle case where user data couldn't be obtained
        const context: ErrorContext = {
          errorType: "UserDataError",
          metadata: {
            userDiscordId: interaction.user.id,
            command: `${commandName} ${subcommandName}`,
          },
        };
        await log.error("User data unavailable for command execution", undefined, context);

        await replyInfoEmbed(interaction, finalLocale, {
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        });
      }
    };

    // Execute main command logic
    // Discord handles interaction timeouts natively, and helper functions
    // (awaitModalSubmit, awaitMessageComponent) have their own timeouts
    await mainLogicPromise();
  } catch (error) {
    // Log error with structured context (Rule #22)
    const context: ErrorContext = {
      errorType: "CommandHandlingError",
      metadata: {
        commandName: interaction.commandName,
        groupName: interaction.options.getSubcommandGroup(false) ?? "none",
        subcommandName: interaction.options.getSubcommand(false),
        userDiscordId: interaction.user.id,
        guildDiscordId: interaction.guild?.id ?? "DM",
      },
    };
    await log.error(`Error in command handler for: ${interaction.commandName}`, error, context);

    // Reply to user with enhanced defensive error handling
    // The improved replyInfoEmbed function can now handle various interaction states more robustly
    try {
      // Always attempt to use the helper function - it will handle the interaction state internally
      await replyInfoEmbed(interaction, initialLocale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
    } catch (replyError) {
      // If helper function completely fails, log comprehensive error information
      log.error(
        "Command handler error reply failed completely:",
        {
          originalError: error,
          replyError: replyError,
          interactionState: {
            id: interaction.id,
            commandName: interaction.commandName,
            deferred: interaction.deferred,
            replied: interaction.replied,
            user: interaction.user.id,
          },
        },
        context,
      );
    }
  }
};

export default handler;
