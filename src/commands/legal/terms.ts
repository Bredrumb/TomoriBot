import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { ColorCode } from "@/utils/misc/logger";
import type { UserRow } from "@/types/db/schema";

/**
 * Configure the 'terms' subcommand
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("terms").setDescription(localizer("en-US", "commands.legal.terms.description"));

/**
 * Executes the 'terms' command
 * Shows a link to the Terms of Service on GitHub with dynamic locale support
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  // Since language_pref only contains officially supported locales,
  // we can directly use it without availability checks
  const githubUrl = `https://github.com/Bredrumb/TomoriBot/blob/main/legal/${locale}/terms-of-service.md`;

  const embed = new EmbedBuilder()
    .setTitle(localizer(locale, "commands.legal.terms.title"))
    .setDescription(localizer(locale, "commands.legal.terms.description_text"))
    .addFields({
      name: localizer(locale, "commands.legal.terms.link_title"),
      value: githubUrl,
    })
    .setColor(ColorCode.INFO)
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}
