import { MessageFlags, type SlashCommandSubcommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import {
  clearChannelProcessingQueue,
  forceKillChannelStream,
  isChannelProcessingLocked,
} from "@/utils/chat/channelQueue";
import type { UserRow } from "../../types/db/schema";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import { StreamOrchestrator } from "../../utils/discord/streamOrchestrator";
import { ColorCode, log } from "../../utils/misc/logger";
import { localizer } from "../../utils/text/localizer";

/**
 * Configure the kill subcommand
 * @param subcommand - The slash command subcommand builder
 * @returns The configured subcommand
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("kill").setDescription(localizer("en-US", "commands.bot.kill.description"));

/**
 * Execute the kill command for this channel.
 * Stops the active stream if one exists and clears any queued responses.
 * @param _client - Discord client instance (unused)
 * @param interaction - Command interaction
 * @param _userData - User data from database (unused)
 * @param locale - Locale of the interaction
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.channel) {
    await replyInfoEmbed(
      interaction,
      locale,
      {
        titleKey: "general.errors.channel_only_title",
        descriptionKey: "general.errors.channel_only_description",
        color: ColorCode.ERROR,
      },
      MessageFlags.Ephemeral,
    );
    return;
  }

  const channelId = interaction.channel.id;
  const hasActiveStream = isChannelProcessingLocked(channelId);
  const clearedQueueCount = clearChannelProcessingQueue(channelId);

  if (!hasActiveStream && clearedQueueCount === 0) {
    await replyInfoEmbed(
      interaction,
      locale,
      {
        titleKey: "commands.bot.kill.nothing_to_stop_title",
        descriptionKey: "commands.bot.kill.nothing_to_stop_description",
        color: ColorCode.WARN,
      },
      MessageFlags.SuppressNotifications,
    );
    return;
  }

  if (hasActiveStream) {
    // Signal the stream processing loop to stop gracefully.
    StreamOrchestrator.requestStop(channelId, interaction.user.id);
    // Abort the underlying HTTP request and unblock Promise.race so the lock releases immediately.
    forceKillChannelStream(channelId);
  }

  log.info(
    `Stop/clear requested via /bot kill by user ${interaction.user.id} in channel ${channelId}. Active stream: ${hasActiveStream}. Cleared ${clearedQueueCount} queued message(s).`,
  );

  await replyInfoEmbed(
    interaction,
    locale,
    {
      titleKey: "commands.bot.kill.success_title",
      descriptionKey: "commands.bot.kill.success_description",
      color: ColorCode.SUCCESS,
    },
    MessageFlags.SuppressNotifications,
  );
}
