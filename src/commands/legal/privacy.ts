import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { ColorCode } from "@/utils/misc/logger";
import { buildLegalDocUrl } from "@/utils/misc/docsUrl";
import type { UserRow } from "@/types/db/schema";

/**
 * Configure the 'privacy' subcommand
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("privacy").setDescription(localizer("en-US", "commands.legal.privacy.description"));

/**
 * Executes the 'privacy' command
 * Shows a link to the Privacy Policy on the docs site with dynamic locale support
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  const docsUrl = buildLegalDocUrl(locale, "privacy-policy");

  const embed = new EmbedBuilder()
    .setTitle(localizer(locale, "commands.legal.privacy.title"))
    .setDescription(localizer(locale, "commands.legal.privacy.description_text"))
    .addFields({
      name: localizer(locale, "commands.legal.privacy.link_title"),
      value: docsUrl,
    })
    .setColor(ColorCode.INFO)
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}
