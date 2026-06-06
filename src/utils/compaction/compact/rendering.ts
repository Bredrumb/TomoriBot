import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder } from "discord.js";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { SendableChannel } from "./types";

export function buildConversationEmbed(locale: string, summaryText: string, refresh: boolean): EmbedBuilder {
  const title = refresh
    ? localizer(locale, "commands.tool.compact.summary_title_refreshed")
    : localizer(locale, "commands.tool.compact.summary_title");

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(truncateEmbedDescription(summaryText))
    .setColor(ColorCode.SECTION);

  if (refresh) {
    embed.setFooter({ text: localizer(locale, "commands.tool.compact.refresh_footer") });
  }

  return embed;
}

export function buildRoleplayEmbeds(locale: string, summaryText: string, refresh: boolean): EmbedBuilder[] {
  const title = refresh
    ? localizer(locale, "commands.tool.compact.roleplay_scene_title_refreshed")
    : localizer(locale, "commands.tool.compact.roleplay_scene_title");

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(truncateEmbedDescription(summaryText))
    .setColor(ColorCode.SECTION);

  if (refresh) {
    embed.setFooter({ text: localizer(locale, "commands.tool.compact.refresh_footer") });
  }

  return [embed];
}

export function isDiscordThreadChannel(channel: unknown): boolean {
  if (!channel || typeof channel !== "object") return false;
  if ("isThread" in channel && typeof channel.isThread === "function") return channel.isThread();
  if (!("type" in channel)) return false;
  const channelType = Number((channel as { type: number }).type);
  return (
    channelType === ChannelType.PublicThread ||
    channelType === ChannelType.PrivateThread ||
    channelType === ChannelType.AnnouncementThread
  );
}

export async function sendEmbedsInChunks(channel: SendableChannel, embeds: EmbedBuilder[]): Promise<void> {
  const chunkSize = 10;
  for (let index = 0; index < embeds.length; index += chunkSize) {
    await channel.send({ embeds: embeds.slice(index, index + chunkSize) });
  }
}

export const COMPACT_EDIT_BUTTON_ID = "compact_edit_summary";

export function buildEditSummaryButtonRow(locale: string): ActionRowBuilder<ButtonBuilder> {
  const button = new ButtonBuilder()
    .setCustomId(COMPACT_EDIT_BUTTON_ID)
    .setLabel(localizer(locale, "commands.tool.compact.edit_button_label"))
    .setStyle(ButtonStyle.Secondary);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

function truncateEmbedDescription(text: string, maxLength = 4000): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

