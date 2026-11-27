import type { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { UserRow } from "@/types/db/schema";
import { localizedStatusTitle } from "@/utils/discord/ui/statusTitle";
import { botSendBlockNotice, resolveBotSendBlock } from "@/utils/discord/botSendBlock";

export const configureCommand = (command: SlashCommandBuilder) =>
  command.setName("ping").setDescription(localizer("en-US", "commands.ping.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  const channel = interaction.channel;
  const sendBlock =
    interaction.guild && channel && "permissionsFor" in channel
      ? resolveBotSendBlock(channel, interaction.guild.members.me)
      : null;

  await interaction.deferReply(sendBlock ? { flags: MessageFlags.Ephemeral } : undefined);

  const reply = await interaction.fetchReply();
  const responseTime = reply.createdTimestamp - interaction.createdTimestamp;

  const isLaggy = responseTime > 250;
  const embedColor = isLaggy || sendBlock ? ColorCode.WARN : ColorCode.SUCCESS;

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(localizedStatusTitle(locale, "commands.ping.title", embedColor))
    .setDescription(
      localizer(locale, isLaggy ? "commands.ping.response_slow" : "commands.ping.response_fast", {
        response_time: responseTime,
      }),
    );

  if (sendBlock) {
    const notice = botSendBlockNotice(sendBlock);
    embed.addFields({
      name: localizer(locale, notice.titleKey),
      value: localizer(locale, notice.descriptionKey, notice.descriptionVars),
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
