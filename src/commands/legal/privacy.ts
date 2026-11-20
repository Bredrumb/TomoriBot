import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { ColorCode } from "@/utils/misc/logger";
import { buildLegalDocUrl } from "@/utils/misc/docsUrl";
import { isHostedPolicyEnvironment } from "@/utils/misc/hostedPolicy";
import type { UserRow } from "@/types/db/schema";

// Gated on hosted environments because the Privacy Policy applies only to the hosted bot and would mislead
// self-hosted users.
export const isCommandEnabled = (): boolean => isHostedPolicyEnvironment();

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("privacy-policy").setDescription(localizer("en-US", "commands.legal.privacy-policy.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  const docsUrl = buildLegalDocUrl(locale, "privacy-policy");

  const embed = new EmbedBuilder()
    .setTitle(localizer(locale, "commands.legal.privacy-policy.title"))
    .setDescription(localizer(locale, "commands.legal.privacy-policy.description_text"))
    .addFields({
      name: localizer(locale, "commands.legal.privacy-policy.link_title"),
      value: docsUrl,
    })
    .setColor(ColorCode.INFO)
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}
