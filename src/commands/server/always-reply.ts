import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { configRepository } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "../../utils/cache/tomoriStateCache";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import type { UserRow, ErrorContext } from "../../types/db/schema";

/**
 * Configures the `/server always-reply` subcommand.
 * Toggles whether the main persona always replies to user messages,
 * even when no trigger word is present.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("always-reply").setDescription(localizer("en-US", "commands.server.alwaysreply.description"));

/**
 * Toggles the always-reply mode for the main persona.
 * When enabled, the main persona replies to ALL user messages in guild channels (like DMs),
 * unless an alter persona's trigger is detected — in which case only the alter responds.
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
  // Guild is guaranteed by command loader's server category gate
  const guildId = interaction.guild?.id ?? "";

  // 1. Defer the reply before async work to prevent timeout
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // 2. Load the Tomori state for this server
    const tomoriState = await getCachedTomoriState(guildId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 3. Toggle the current value
    const newValue = !tomoriState.config.always_reply_enabled;

    // 4. Update the database
    const updated = await configRepository.updateTriggerBehaviorConfig(tomoriState.server_id, {
      always_reply_enabled: newValue,
    });

    if (!updated) {
      const context: ErrorContext = {
        tomoriId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "server alwaysreply",
          newValue,
          targetTable: "server_trigger_behavior_configs",
        },
      };
      await log.error(
        "Failed to update always_reply_enabled config",
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

    // 5. Invalidate cache after successful write
    invalidateTomoriStateCache(guildId);

    // 6. Send success message
    await replyInfoEmbed(interaction, locale, {
      titleKey: newValue ? "commands.server.alwaysreply.enabled_title" : "commands.server.alwaysreply.disabled_title",
      descriptionKey: newValue
        ? "commands.server.alwaysreply.enabled_description"
        : "commands.server.alwaysreply.disabled_description",
      descriptionVars: {
        persona_name: tomoriState.persona_nickname,
      },
      color: newValue ? ColorCode.SUCCESS : ColorCode.WARN,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: (await getCachedTomoriState(guildId))?.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server alwaysreply",
        options: interaction.options?.data,
      },
    };
    await log.error(`Error in /server always-reply command`, error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
