import { MessageFlags, type SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { replyInfoEmbed } from "@/utils/discord/interactionHelper";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { UserRow } from "@/types/db/schema";
import { clearShortTermMemoryForChannel } from "@/utils/cache/shortTermMemoryCache";

export const configureCommand = (command: SlashCommandBuilder) =>
  command.setName("refresh").setDescription(localizer("en-US", "commands.refresh.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  if (interaction.channel) {
    clearShortTermMemoryForChannel(interaction.channel.id);
    log.info(`[refreshCommand] Cleared short-term memories for channel - channelId=${interaction.channel.id}`);
  }

  // embedProtocol matches commands.refresh.title in channel history as a reset boundary, so this reply must stay
  // non-ephemeral.
  await replyInfoEmbed(
    interaction,
    locale,
    {
      titleKey: "commands.refresh.title",
      descriptionKey: "commands.refresh.response",
      footerKey: "commands.refresh.footer",
      color: ColorCode.SECTION,
    },
    MessageFlags.SuppressNotifications,
  );
}
