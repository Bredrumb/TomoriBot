import {
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { updateTomoriConfig } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("thought-logs-channel")
    .setDescription(localizer("en-US", "commands.server.thought-logs-channel.description"))
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription(localizer("en-US", "commands.server.thought-logs-channel.channel_description"))
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.guild) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selectedChannel = interaction.options.getChannel("channel", true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let tomoriServerId: number | null = null;

  try {
    if (selectedChannel.type !== ChannelType.GuildText) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.server.thought-logs-channel.invalid_channel_title",
        descriptionKey: "commands.server.thought-logs-channel.invalid_channel_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const tomoriState = await getCachedTomoriState(interaction.guild.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }
    tomoriServerId = tomoriState.server_id;

    const currentChannelId = tomoriState.config.thought_log_channel_disc_id;
    const nextChannelId = currentChannelId === selectedChannel.id ? null : selectedChannel.id;
    const updatedConfig = await updateTomoriConfig(tomoriState.server_id, {
      thought_log_channel_disc_id: nextChannelId,
    });

    if (!updatedConfig) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(interaction.guild.id);

    const successMessage =
      nextChannelId === null
        ? {
            titleKey: "commands.server.thought-logs-channel.cleared_title",
            descriptionKey: "commands.server.thought-logs-channel.cleared_description",
          }
        : currentChannelId
          ? {
              titleKey: "commands.server.thought-logs-channel.updated_title",
              descriptionKey: "commands.server.thought-logs-channel.updated_description",
            }
          : {
              titleKey: "commands.server.thought-logs-channel.set_title",
              descriptionKey: "commands.server.thought-logs-channel.set_description",
            };

    await replyInfoEmbed(interaction, locale, {
      titleKey: successMessage.titleKey,
      descriptionKey: successMessage.descriptionKey,
      descriptionVars: {
        channel: `<#${selectedChannel.id}>`,
      },
      color: nextChannelId === null ? ColorCode.WARN : ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriServerId,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server thoughtlogs",
        channelId: selectedChannel.id,
        guildDiscId: interaction.guild.id,
      },
    };
    await log.error("Error in /server thought-logs-channel command", error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
