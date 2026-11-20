import type { SlashCommandSubcommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { UserRow } from "@/types/db/schema";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("kofi").setDescription(localizer("en-US", "commands.donate.kofi.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  await interaction.deferReply();

  const bannerFile = Bun.file("assets/img/kofibanner.png");
  const bannerBuffer = await bannerFile.arrayBuffer();
  const attachment = new AttachmentBuilder(Buffer.from(bannerBuffer), {
    name: "kofibanner.png",
  });

  const embed = new EmbedBuilder()
    .setTitle(localizer(locale, "commands.donate.kofi.title"))
    .setDescription(localizer(locale, "commands.donate.kofi.description_text"))
    .setColor(ColorCode.INFO)
    .setImage("attachment://kofibanner.png");

  await interaction.editReply({
    embeds: [embed],
    files: [attachment],
  });
}
