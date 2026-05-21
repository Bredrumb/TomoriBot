import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { sql } from "@/utils/db/client";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import { type UserRow, type ErrorContext, userSchema } from "../../types/db/schema";
import { invalidateUserCache } from "../../utils/cache/userCache";
import type { PersonalDeliberateToolMode } from "@/utils/tools/deliberateToolMode";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("deliberate-tool-mode")
    .setDescription(localizer("en-US", "commands.personal.deliberatetoolmode.description"))
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription(localizer("en-US", "commands.personal.deliberatetoolmode.mode_description"))
        .setRequired(true)
        .addChoices(
          {
            name: localizer("en-US", "commands.personal.deliberatetoolmode.off_option"),
            value: "off",
          },
          {
            name: localizer("en-US", "commands.personal.deliberatetoolmode.follow_option"),
            value: "follow",
          },
          {
            name: localizer("en-US", "commands.personal.deliberatetoolmode.on_option"),
            value: "on",
          },
        ),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const selectedMode = interaction.options.getString("mode", true) as PersonalDeliberateToolMode;

  try {
    const [updatedRow] = await sql`
      UPDATE users
      SET personal_deliberate_tool_mode = ${selectedMode}
      WHERE user_disc_id = ${userData.user_disc_id}
      RETURNING *
    `;

    if (!updatedRow) {
      const context: ErrorContext = {
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "personal deliberatetoolmode",
          selectedMode,
          targetTable: "users",
        },
      };
      await log.error(
        "Failed to update personal_deliberate_tool_mode for user",
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

    const validatedUser = userSchema.safeParse(updatedRow);
    if (!validatedUser.success) {
      const context: ErrorContext = {
        userId: userData.user_id,
        errorType: "SchemaValidationError",
        metadata: {
          command: "personal deliberatetoolmode",
          validationErrors: validatedUser.error.flatten(),
        },
      };
      await log.error(
        "Failed to validate updated user after personal deliberate tool mode change",
        validatedUser.error,
        context,
      );

      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateUserCache(userData.user_disc_id);

    const colorByMode: Record<PersonalDeliberateToolMode, ColorCode> = {
      off: ColorCode.WARN,
      follow: ColorCode.INFO,
      on: ColorCode.SUCCESS,
    };

    await replyInfoEmbed(interaction, locale, {
      titleKey: `commands.personal.deliberatetoolmode.${selectedMode}_title`,
      descriptionKey: `commands.personal.deliberatetoolmode.${selectedMode}_description`,
      color: colorByMode[selectedMode],
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "personal deliberatetoolmode",
        options: interaction.options?.data,
      },
    };
    await log.error("Error in /personal deliberate-tool-mode command", error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
