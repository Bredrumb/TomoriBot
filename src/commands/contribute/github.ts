import type { SlashCommandSubcommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { UserRow } from "@/types/db/schema";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("github").setDescription(localizer("en-US", "commands.contribute.github.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  await interaction.deferReply();

  const bannerFile = Bun.file("assets/img/gitbanner.png");
  const bannerBuffer = await bannerFile.arrayBuffer();
  const attachment = new AttachmentBuilder(Buffer.from(bannerBuffer), {
    name: "gitbanner.png",
  });

  const embed = new EmbedBuilder()
    .setTitle(localizer(locale, "commands.contribute.github.title"))
    .setDescription(localizer(locale, "commands.contribute.github.description_text"))
    .setColor(ColorCode.INFO)
    .setImage("attachment://gitbanner.png");

  await interaction.editReply({
    embeds: [embed],
    files: [attachment],
  });
}
