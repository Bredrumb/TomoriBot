import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { personalConfigOperations } from "@/utils/discord/interactions/personalConfigOperations";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode } from "@/utils/misc/logger";
import { getLocaleEndonym, getSupportedLocales, localizer } from "@/utils/text/localizer";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("language")
    .setDescription(localizer("en-US", "commands.personal.language.description"))
    .addStringOption((option) =>
      option
        .setName("language")
        .setDescription(localizer("en-US", "commands.personal.language.language_description"))
        .setRequired(true)
        .addChoices(...getSupportedLocales().map((code) => ({ name: getLocaleEndonym(code), value: code }))),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const userId = userData.user_id;
  if (userId === undefined) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const language = interaction.options.getString("language", true);
  if (!getSupportedLocales().includes(language)) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.invalid_option_title",
      descriptionKey: "general.errors.invalid_option_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await personalConfigOperations.setLanguage({
    userId,
    userDiscId: userData.user_disc_id,
    language,
  });

  if (result.status !== "success") {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // A confirmation in the old language reads as a failed change, so the receipt uses the language
  // just written.
  await replyInfoEmbed(interaction, language, {
    titleKey: "commands.personal.config.language_updated_heading",
    descriptionKey: "commands.personal.config.language_updated_detail",
    descriptionVars: { language: getLocaleEndonym(language) },
    color: ColorCode.SUCCESS,
  });
}
