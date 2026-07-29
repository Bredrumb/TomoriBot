import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { userRepository } from "@/utils/db/repositories";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import type { UserRow, ErrorContext } from "../../types/db/schema";
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
    // Persist through the repository layer, which validates the field,
    //    writes the row, and invalidates the user cache on success. A loaded
    //    user row always carries its PK; `?? -1` only narrows the optional type,
    //    and a -1 id simply yields a null (no-row) update → the failure path below.
    const updatedUser = await userRepository.update(userData.user_id ?? -1, {
      personal_deliberate_tool_mode: selectedMode,
    });

    // A null result means the write (or its validation) failed — surface the
    //    generic update-failed embed.
    if (!updatedUser) {
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
        new Error("Repository update returned null"),
        context,
      );

      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

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
