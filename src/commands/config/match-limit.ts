import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { configRepository } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "../../utils/cache/tomoriStateCache";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import type { UserRow, ErrorContext } from "../../types/db/schema";

const MIN_LIMIT = 1;
const MAX_LIMIT = 10;
const DEFAULT_LIMIT = 3;

// Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("trigger-match-limit")
    .setDescription(localizer("en-US", "commands.config.trigger-match-limit.description"))
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(localizer("en-US", "commands.config.trigger-match-limit.limit_description"))
        .setMinValue(MIN_LIMIT)
        .setMaxValue(MAX_LIMIT)
        .setRequired(true),
    );

/**
 * Configures the maximum number of personas that can match a single message's triggers.
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database
 * @param locale - Locale of the interaction
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // Ensure command is run in a guild
  if (!interaction.guild || !interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // Defer the interaction before async work to prevent timeout
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Get the limit value from options
    const limit = interaction.options.getInteger("limit", true);

    // Validate range (redundant but safe)
    if (limit < MIN_LIMIT || limit > MAX_LIMIT) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.trigger-match-limit.limit.invalid_range_title",
        descriptionKey: "commands.config.trigger-match-limit.limit.invalid_range_description",
        descriptionVars: {
          min: MIN_LIMIT.toString(),
          max: MAX_LIMIT.toString(),
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    // Load the Tomori state for this server
    const tomoriState = await getCachedTomoriState(interaction.guild.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Check if this is the same as the current limit
    const currentLimit = tomoriState.config.match_limit ?? DEFAULT_LIMIT;
    if (limit === currentLimit) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.trigger-match-limit.limit.already_set_title",
        descriptionKey: "commands.config.trigger-match-limit.limit.already_set_description",
        descriptionVars: {
          limit: limit.toString(),
        },
        color: ColorCode.WARN,
      });
      return;
    }

    // Update the limit in the database
    const updated = await configRepository.updateChatConfig(tomoriState.server_id, { match_limit: limit });

    if (!updated) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "config trigger-match-limit limit",
          limit,
          targetTable: "server_chat_configs",
        },
      };
      await log.error("Failed to update match_limit config", new Error("Database update failed"), context);

      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Invalidate cache so next message gets fresh config
    invalidateTomoriStateCache(interaction.guild.id);

    // Success message
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.config.trigger-match-limit.limit.success_title",
      descriptionKey: "commands.config.trigger-match-limit.limit.success_description",
      descriptionVars: {
        limit: limit.toString(),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: (await getCachedTomoriState(interaction.guild.id))?.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config trigger-match-limit limit",
        options: interaction.options?.data,
      },
    };
    await log.error("Error in /config trigger-match-limit limit command", error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
