import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { personaRepository, serverRepository } from "@/utils/db/repositories";
import { invalidateUserBlacklistCache } from "@/utils/cache/userCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import type { UserRow, ErrorContext } from "@/types/db/schema";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("add")
    .setDescription(localizer("en-US", "commands.server.user-blacklist.add.description"))
    .addUserOption((option) =>
      option
        .setName("member")
        .setDescription(localizer("en-US", "commands.server.user-blacklist.add.member_description"))
        .setRequired(true),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.guild || !interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const targetDiscordUser = interaction.options.getUser("member", true);

  try {
    if (targetDiscordUser.bot) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.server.user-blacklist.add.cannot_blacklist_bot_title",
        descriptionKey: "commands.server.user-blacklist.add.cannot_blacklist_bot_description",
        descriptionVars: {
          user_name: targetDiscordUser.username,
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    const tomoriState = await personaRepository.loadState(interaction.guild.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (!tomoriState.config.personal_memories_enabled) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.server.user-blacklist.add.personalization_disabled_title",
        descriptionKey: "commands.server.user-blacklist.add.personalization_disabled_description",
        color: ColorCode.WARN,
      });
      return;
    }

    const isAlreadyBlacklisted = await serverRepository.isUserBlacklisted(tomoriState.server_id, targetDiscordUser.id);

    if (isAlreadyBlacklisted) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.server.user-blacklist.add.already_blacklisted_title",
        descriptionKey: "commands.server.user-blacklist.add.already_blacklisted_description",
        descriptionVars: {
          user_name: targetDiscordUser.username,
        },
        color: ColorCode.WARN,
      });
      return;
    }

    await serverRepository.addUserBlacklist(tomoriState.server_id, targetDiscordUser.id);

    invalidateUserBlacklistCache(interaction.guild.id, targetDiscordUser.id);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.server.user-blacklist.add.success_title",
      descriptionKey: "commands.server.user-blacklist.add.success_description",
      descriptionVars: {
        user_name: targetDiscordUser.username,
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const state = interaction.guild?.id ? await personaRepository.loadState(interaction.guild.id) : null;
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: state?.server_id ?? null,
      personaId: state?.persona_id ?? null,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server user-blacklist add",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
        targetDiscordUserId: targetDiscordUser.id,
      },
    };
    await log.error("Error executing /server user-blacklist add", error as Error, context);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: localizer(locale, "general.errors.unknown_error_description"),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.followUp({
      content: localizer(locale, "general.errors.unknown_error_description"),
      flags: MessageFlags.Ephemeral,
    });
  }
}
