import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { sql } from "@/utils/db/client";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { type ErrorContext, type UserRow, tomoriConfigSchema } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import {
  DEFAULT_MESSAGE_FETCH_LIMIT,
  MAX_MESSAGE_FETCH_LIMIT,
  MIN_MESSAGE_FETCH_LIMIT,
} from "@/utils/discord/messageFetchLimit";

// Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("message-fetch-limit")
    .setDescription(localizer("en-US", "commands.config.message-fetch-limit.description"))
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(localizer("en-US", "commands.config.message-fetch-limit.limit_description"))
        .setMinValue(MIN_MESSAGE_FETCH_LIMIT)
        .setMaxValue(MAX_MESSAGE_FETCH_LIMIT)
        .setRequired(true),
    );

/**
 * Configures how many recent messages are fetched for context building.
 * Applies per server (or DM pseudo-server) and affects chat context windows.
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
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const serverDiscId = interaction.guild?.id ?? interaction.user.id;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const limit = interaction.options.getInteger("limit", true);

    if (limit < MIN_MESSAGE_FETCH_LIMIT || limit > MAX_MESSAGE_FETCH_LIMIT) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.message-fetch-limit.limit.invalid_range_title",
        descriptionKey: "commands.config.message-fetch-limit.limit.invalid_range_description",
        descriptionVars: {
          min: MIN_MESSAGE_FETCH_LIMIT.toString(),
          max: MAX_MESSAGE_FETCH_LIMIT.toString(),
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    const tomoriState = await getCachedTomoriState(serverDiscId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const currentLimit = tomoriState.config.message_fetch_limit ?? DEFAULT_MESSAGE_FETCH_LIMIT;
    if (limit === currentLimit) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.message-fetch-limit.limit.already_set_title",
        descriptionKey: "commands.config.message-fetch-limit.limit.already_set_description",
        descriptionVars: {
          limit: limit.toString(),
        },
        color: ColorCode.WARN,
      });
      return;
    }

    const [updatedRow] = await sql`
			UPDATE tomori_configs
			SET message_fetch_limit = ${limit}
			WHERE server_id = ${tomoriState.server_id}
			RETURNING *
		`;

    if (!updatedRow) {
      const context: ErrorContext = {
        tomoriId: tomoriState.tomori_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "config message-fetch-limit limit",
          limit,
          targetTable: "tomori_configs",
        },
      };
      await log.error(
        "Failed to update message_fetch_limit config",
        new Error("Database update returned no rows"),
        context,
      );

      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const validatedConfig = tomoriConfigSchema.safeParse(updatedRow);
    if (!validatedConfig.success) {
      const context: ErrorContext = {
        tomoriId: tomoriState.tomori_id,
        serverId: tomoriState.server_id,
        errorType: "SchemaValidationError",
        metadata: {
          command: "config message-fetch-limit limit",
          validationErrors: validatedConfig.error.flatten(),
        },
      };
      await log.error("Failed to validate updated config", validatedConfig.error, context);

      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(serverDiscId);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.config.message-fetch-limit.limit.success_title",
      descriptionKey: "commands.config.message-fetch-limit.limit.success_description",
      descriptionVars: {
        limit: limit.toString(),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: (await getCachedTomoriState(serverDiscId))?.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config message-fetch-limit limit",
        options: interaction.options?.data,
      },
    };
    await log.error("Error in /config message-fetch-limit limit command", error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
