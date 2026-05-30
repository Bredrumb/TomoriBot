import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { updateTomoriConfig } from "@/utils/db/dbWrite";
import { clearFastRegenerationEntriesForGuild } from "@/utils/discord/fastRegeneration";
import { replyInfoEmbed } from "@/utils/discord/interactionHelper";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("fast-regeneration")
    .setDescription(localizer("en-US", "commands.server.fast-regeneration.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const guildId = interaction.guild?.id ?? "";

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const tomoriState = await getCachedTomoriState(guildId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const newValue = tomoriState.config.fast_regeneration_enabled === false;
    const updatedConfig = await updateTomoriConfig(tomoriState.server_id, {
      fast_regeneration_enabled: newValue,
    });

    if (!updatedConfig) {
      const context: ErrorContext = {
        tomoriId: tomoriState.tomori_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "server fast-regeneration",
          newValue,
          targetTable: "tomori_configs",
        },
      };
      await log.error(
        "Failed to update fast_regeneration_enabled config",
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

    invalidateTomoriStateCache(guildId);

    if (!newValue) {
      await clearFastRegenerationEntriesForGuild(guildId);
    }

    await replyInfoEmbed(interaction, locale, {
      titleKey: newValue
        ? "commands.server.fast-regeneration.enabled_title"
        : "commands.server.fast-regeneration.disabled_title",
      descriptionKey: newValue
        ? "commands.server.fast-regeneration.enabled_description"
        : "commands.server.fast-regeneration.disabled_description",
      color: newValue ? ColorCode.SUCCESS : ColorCode.WARN,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: (await getCachedTomoriState(guildId))?.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server fast-regeneration",
        options: interaction.options?.data,
      },
    };
    await log.error("Error in /server fast-regeneration command", error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
