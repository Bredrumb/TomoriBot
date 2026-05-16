import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { sql } from "@/utils/db/client";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { type ErrorContext, type UserRow, tomoriConfigSchema } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";

// Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("self-debug")
    .setDescription(localizer("en-US", "commands.config.self-debug.description"))
    .addStringOption((option) =>
      option
        .setName("set")
        .setDescription(localizer("en-US", "commands.config.self-debug.set_description"))
        .setRequired(true)
        .addChoices(
          {
            name: localizer("en-US", "commands.config.options.enable"),
            value: "enable",
          },
          {
            name: localizer("en-US", "commands.config.options.disable"),
            value: "disable",
          },
        ),
    );

/**
 * Toggles whether Tomori includes her own error embeds in context as [System: ...].
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
    const setAction = interaction.options.getString("set", true);
    const isEnabled = setAction === "enable";

    const tomoriState = await getCachedTomoriState(serverDiscId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const currentSetting = tomoriState.config.self_debug_enabled ?? false;
    if (currentSetting === isEnabled) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.self-debug.already_set_title",
        descriptionKey: isEnabled
          ? "commands.config.self-debug.already_enabled_description"
          : "commands.config.self-debug.already_disabled_description",
        color: ColorCode.WARN,
      });
      return;
    }

    const [updatedRow] = await sql`
			UPDATE server_chat_configs
			SET self_debug_enabled = ${isEnabled}
			WHERE server_id = ${tomoriState.server_id}
			RETURNING server_id
		`;

    if (!updatedRow) {
      const context: ErrorContext = {
        tomoriId: tomoriState.tomori_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "config selfdebug",
          selfDebugEnabled: isEnabled,
          targetTable: "server_chat_configs",
        },
      };
      await log.error(
        "Failed to update self_debug_enabled config",
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
          command: "config selfdebug",
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
      titleKey: "commands.config.self-debug.success_title",
      descriptionKey: isEnabled
        ? "commands.config.self-debug.enabled_success"
        : "commands.config.self-debug.disabled_success",
      color: isEnabled ? ColorCode.SUCCESS : ColorCode.WARN,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: (await getCachedTomoriState(serverDiscId))?.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config selfdebug",
        options: interaction.options?.data,
      },
    };
    await log.error("Error in /config self-debug command", error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
