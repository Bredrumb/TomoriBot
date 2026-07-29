import { MessageFlags, type Client, type Interaction } from "discord.js";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import { ColorCode, log } from "../../utils/misc/logger";
import type { UserRow, ErrorContext } from "../../types/db/schema";
import { cooldownRepository, serverRepository, statRepository, userRepository } from "@/utils/db/repositories";
import {
  loadCommandData,
  ROOT_COMMAND_EXECUTION_KEY,
  type CommandExecutionMap,
  type CommandCooldownMap,
} from "../../utils/discord/commandLoader";
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
    // Load command data on first run if cache is empty.
    //    loadCommandData() is single-flight: if startup registration is still
    //    loading, this awaits that same shared evaluation instead of racing a
    //    second concurrent load (which previously caused command modules to be
    //    skipped via a Temporal Dead Zone error, leaving the bot "dead").
    if (!executionMap || !cooldownMap) {
      log.info("Initializing command execution maps...");
      const loadedData = await loadCommandData();

      // Only commit the maps to the module-level cache when the load actually
      // produced commands. An empty execution map signals a catastrophic load
      // failure; caching it would permanently brick every command, so we leave
      // the cache empty and let a subsequent interaction retry the load.
      if (loadedData.executionMap.size > 0) {
        executionMap = loadedData.executionMap;
        cooldownMap = loadedData.cooldownMap;

        // Use our existing cooldown values if none were provided from commands
        if (cooldownMap.size === 0) {
          for (const [category, duration] of COOLDOWN_MAP.entries()) {
            cooldownMap.set(category, duration);
          }
        }

        log.success("Command execution maps initialized.");
      } else {
        log.warn("Command load produced no commands; will retry on next interaction.");
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
    }

    // Get command, group, and subcommand names
    const commandName = interaction.commandName; // The top-level command (category)
    const groupName = interaction.options.getSubcommandGroup(false); // The subcommand group (null for flat commands)
    const subcommandName = interaction.options.getSubcommand(false); // The specific subcommand (may be null)

    // Guild-only subcommand restrictions are now handled at the Discord registration level
    // Commands in guild-only categories (like "server") are automatically restricted to guilds

    // Find the execute function
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

    // Build execution key based on whether command is grouped or flat
    const executionKey = subcommandName
      ? groupName
        ? `${groupName}.${subcommandName}`
        : subcommandName
      : ROOT_COMMAND_EXECUTION_KEY;

    // Get the execute function for this subcommand
    const executeFunction = subcommandMap.get(executionKey);
    if (!executeFunction) {
      const fullCommandPath = groupName
        ? `${commandName} ${groupName} ${subcommandName}`
        : subcommandName
          ? `${commandName} ${subcommandName}`
          : commandName;
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
      // Check cooldowns based on the category (top-level command)
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

      // Get or create user data
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

      // Execute command
      if (userData) {
        await executeFunction(client, interaction, userData, finalLocale);

        // Record command usage (fire-and-forget so stat tracking never adds
        // latency to the command response). command_used is persona-agnostic, so
        // it buffers under the lineage-0 sentinel. DM commands have no guild and
        // are skipped (stat_counters.server_id is a NOT NULL FK). The single
        // commandLoader dispatch path covers every slash command for free.
        const statUserId = userData.user_id;
        if (interaction.guildId && statUserId) {
          const guildId = interaction.guildId;
          // Record the full command path (category + optional group + subcommand,
          // space-joined) so stats distinguish subcommands like "config humanizer"
          // from "config message-fetch-limit" — top-level alone is too coarse for
          // underused-command detection.
          const fullCommandName = groupName
            ? `${commandName} ${groupName} ${subcommandName}`
            : subcommandName
              ? `${commandName} ${subcommandName}`
              : commandName;
          void (async () => {
            try {
              const internalServerId = await serverRepository.loadServerIdByDiscId(guildId);
              if (internalServerId) {
                statRepository.recordStat({
                  serverId: internalServerId,
                  userId: statUserId,
                  metric: "command_used",
                  metricKey: fullCommandName,
                });
              }
            } catch (statError) {
              log.warn(`Failed to record command_used stat for ${fullCommandName}: ${statError}`);
            }
          })();
        }
      } else {
        // Handle case where user data couldn't be obtained
        const context: ErrorContext = {
          errorType: "UserDataError",
          metadata: {
            userDiscordId: interaction.user.id,
            command: subcommandName ? `${commandName} ${subcommandName}` : commandName,
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
