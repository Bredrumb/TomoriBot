import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { configRepository } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "../../utils/cache/tomoriStateCache";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import type { UserRow, ErrorContext } from "../../types/db/schema";

const MIN_LIMIT = 0;
const MAX_LIMIT = 40;
const DEFAULT_LIMIT = 0;

// Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("send-limit")
    .setDescription(localizer("en-US", "commands.config.sendlimit.description"))
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(localizer("en-US", "commands.config.sendlimit.limit_description"))
        .setMinValue(MIN_LIMIT)
        .setMaxValue(MAX_LIMIT)
        .setRequired(true),
    );

/**
 * Configures the maximum number of Discord messages sent per AI response.
 * 0 disables the limit (responses are only bounded by the safety MAX_FLUSH_COUNT).
 * 1-40 caps messages at the specified count, producing clean cutoffs at sentence boundaries.
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
  // 1. Ensure command is run in a guild
  if (!interaction.guild || !interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // 2. Defer the interaction before async work to prevent timeout
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // 3. Get the limit value from options
    const limit = interaction.options.getInteger("limit", true);

    // 4. Validate range (redundant but safe)
    if (limit < MIN_LIMIT || limit > MAX_LIMIT) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.sendlimit.invalid_range_title",
        descriptionKey: "commands.config.sendlimit.invalid_range_description",
        descriptionVars: {
          min: MIN_LIMIT.toString(),
          max: MAX_LIMIT.toString(),
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    // 5. Load the Tomori state for this server
    const tomoriState = await getCachedTomoriState(interaction.guild.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 6. Check if this is the same as the current limit
    const currentLimit = tomoriState.config.send_message_limit ?? DEFAULT_LIMIT;
    if (limit === currentLimit) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.sendlimit.already_set_title",
        descriptionKey: "commands.config.sendlimit.already_set_description",
        descriptionVars: {
          limit: limit.toString(),
        },
        color: ColorCode.WARN,
      });
      return;
    }

    // 7. Update the limit in the database
    const updated = await configRepository.updateChatConfig(tomoriState.server_id, { send_message_limit: limit });

    if (!updated) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "config sendlimit",
          limit,
          targetTable: "server_chat_configs",
        },
      };
      await log.error("Failed to update send_message_limit config", new Error("Database update failed"), context);

      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 8. Invalidate cache so next message gets fresh config
    invalidateTomoriStateCache(interaction.guild.id);

    // 10. Success message - indicate disabled state if limit is 0
    const isEnabled = limit > 0;
    await replyInfoEmbed(interaction, locale, {
      titleKey: isEnabled
        ? "commands.config.sendlimit.success_title"
        : "commands.config.sendlimit.success_disabled_title",
      descriptionKey: isEnabled
        ? "commands.config.sendlimit.success_description"
        : "commands.config.sendlimit.success_disabled_description",
      descriptionVars: {
        limit: limit.toString(),
      },
      color: isEnabled ? ColorCode.SUCCESS : ColorCode.WARN,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: (await getCachedTomoriState(interaction.guild.id))?.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config sendlimit",
        options: interaction.options?.data,
      },
    };
    await log.error("Error in /config send-limit command", error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
