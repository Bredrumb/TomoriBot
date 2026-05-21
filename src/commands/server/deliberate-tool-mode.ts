import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { sql } from "@/utils/db/client";
import { getCachedTomoriState, invalidateTomoriStateCache } from "../../utils/cache/tomoriStateCache";
import { tomoriConfigSchema } from "../../types/db/schema";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import type { UserRow, ErrorContext } from "../../types/db/schema";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("deliberate-tool-mode")
    .setDescription(localizer("en-US", "commands.server.deliberatetoolmode.description"));

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

    const newValue = !tomoriState.config.deliberate_tool_mode;

    const [updatedRow] = await sql`
      UPDATE tomori_configs
      SET deliberate_tool_mode = ${newValue}
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
          command: "server deliberatetoolmode",
          newValue,
          targetTable: "tomori_configs",
        },
      };
      await log.error(
        "Failed to update deliberate_tool_mode config",
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
          command: "server deliberatetoolmode",
          validationErrors: validatedConfig.error.flatten(),
        },
      };
      await log.error(
        "Failed to validate updated config after deliberate_tool_mode change",
        validatedConfig.error,
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

    await replyInfoEmbed(interaction, locale, {
      titleKey: newValue
        ? "commands.server.deliberatetoolmode.enabled_title"
        : "commands.server.deliberatetoolmode.disabled_title",
      descriptionKey: newValue
        ? "commands.server.deliberatetoolmode.enabled_description"
        : "commands.server.deliberatetoolmode.disabled_description",
      descriptionVars: {
        persona_name: tomoriState.tomori_nickname,
      },
      color: newValue ? ColorCode.SUCCESS : ColorCode.WARN,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: (await getCachedTomoriState(guildId))?.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server deliberatetoolmode",
        options: interaction.options?.data,
      },
    };
    await log.error("Error in /server deliberate-tool-mode command", error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
