import type { SlashCommandSubcommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { UserRow } from "@/types/db/schema";

/**
 * Configure the discord subcommand for support category
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("discord").setDescription(localizer("en-US", "commands.support.discord.description"));

/**
 * Execute the support discord command - show Discord server link and support resources
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  // Defer the interaction before async file I/O to prevent timeout
  await interaction.deferReply();

  const bannerFile = Bun.file("assets/img/tomobanner.png");
  const bannerBuffer = await bannerFile.arrayBuffer();
  const attachment = new AttachmentBuilder(Buffer.from(bannerBuffer), {
    name: "tomobanner.png",
  });

  const embed = new EmbedBuilder()
    .setTitle(localizer(locale, "commands.support.discord.title"))
    .setDescription(localizer(locale, "commands.support.discord.description_text"))
    .setColor(ColorCode.INFO)
    .setImage("attachment://tomobanner.png");

  await interaction.editReply({
    embeds: [embed],
    files: [attachment],
  });
}
