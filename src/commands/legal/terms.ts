import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { ColorCode } from "@/utils/misc/logger";
import { buildLegalDocUrl } from "@/utils/misc/docsUrl";
import { isHostedPolicyEnvironment } from "@/utils/misc/hostedPolicy";
import type { UserRow } from "@/types/db/schema";

// Gated on hosted environments because the Terms of Service apply only to the hosted bot and would mislead
// self-hosted users.
export const isCommandEnabled = (): boolean => isHostedPolicyEnvironment();

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("terms-of-service")
    .setDescription(localizer("en-US", "commands.legal.terms-of-service.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  const docsUrl = buildLegalDocUrl(locale, "terms-of-service");

  const embed = new EmbedBuilder()
    .setTitle(localizer(locale, "commands.legal.terms-of-service.title"))
    .setDescription(localizer(locale, "commands.legal.terms-of-service.description_text"))
    .addFields({
      name: localizer(locale, "commands.legal.terms-of-service.link_title"),
      value: docsUrl,
    })
    .setColor(ColorCode.INFO)
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}
