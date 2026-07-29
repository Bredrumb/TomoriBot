import type { Client, ChatInputCommandInteraction } from "discord.js";
import { MessageFlags, type SlashCommandSubcommandBuilder, EmbedBuilder } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { isGuildMessageCommandChannel } from "@/utils/discord/guildMessageChannel";
import type { UserRow } from "@/types/db/schema";

/**
 * Configures the /tool comment subcommand
 * @param subcommand - The slash command subcommand builder
 * @returns Configured subcommand builder
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) => {
  return subcommand
    .setName("comment")
    .setDescription(localizer("en-US", "commands.tool.comment.description"))
    .addStringOption((option) =>
      option
        .setName("content")
        .setDescription(localizer("en-US", "commands.tool.comment.content_description"))
        .setRequired(true)
        .setMaxLength(4000),
    );
};

/**
 * Executes the /tool comment command
 * Sends an embed with user input text and a footer showing who created the comment
 * @param client - Discord client
 * @param interaction - Command interaction
 * @param userData - User data from database (unused)
 * @param locale - User's locale
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  // Fast validation
  if (!interaction.guild || !interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.WARN,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Narrow channel type to TextChannel
  if (!isGuildMessageCommandChannel(interaction.channel)) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.tool.comment.invalid_channel_title",
      descriptionKey: "commands.tool.comment.invalid_channel_description",
      color: ColorCode.WARN,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.channel;

  // Defer reply ephemerally while processing
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Get comment content from slash command option
  const commentContent = interaction.options.getString("content", true);

  // Create embed with comment content
  const embed = new EmbedBuilder().setDescription(commentContent).setColor(ColorCode.INFO);

  // Add footer showing who created the comment (with profile picture)
  const memberAvatarUrl = interaction.member
    ? (interaction.member as import("discord.js").GuildMember).displayAvatarURL({
        size: 64,
        extension: "png",
        forceStatic: true,
      })
    : interaction.user.displayAvatarURL({
        size: 64,
        extension: "png",
        forceStatic: true,
      });

  embed.setFooter({
    text: localizer(locale, "commands.tool.comment.footer", {
      user: interaction.user.username,
    }),
    iconURL: memberAvatarUrl,
  });

  // Send as public message in the channel
  await channel.send({
    embeds: [embed],
  });

  // Send confirmation to user
  await replyInfoEmbed(interaction, locale, {
    titleKey: "commands.tool.comment.success_title",
    descriptionKey: "commands.tool.comment.success_description",
    color: ColorCode.SUCCESS,
  });
}
