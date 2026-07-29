import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { invalidateWhitelistCache } from "@/utils/cache/channelWhitelistCache";
import { whitelistRepository } from "@/utils/db/repositories/WhitelistRepository";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import type { UserRow, ErrorContext } from "@/types/db/schema";

/**
 * Configure the /server whitelist role subcommand
 * Allows server managers to add/remove role-based trigger whitelist entries.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("role")
    .setDescription(localizer("en-US", "commands.server.whitelist.role.description"))
    .addRoleOption((option) =>
      option
        .setName("role")
        .setDescription(localizer("en-US", "commands.server.whitelist.role.role_description"))
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription(localizer("en-US", "commands.server.whitelist.role.action_description"))
        .setRequired(true)
        .addChoices(
          {
            name: localizer("en-US", "commands.server.whitelist.role.action_add"),
            value: "add",
          },
          {
            name: localizer("en-US", "commands.server.whitelist.role.action_remove"),
            value: "remove",
          },
        ),
    );

/**
 * Execute the /server whitelist role command.
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  user: UserRow,
  locale: string,
): Promise<void> {
  const errorContext: ErrorContext = {
    userId: user.user_id,
    serverId: null,
    personaId: null,
  };

  try {
    if (!interaction.guild || !interaction.guildId) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.guild_only_title",
        descriptionKey: "general.errors.guild_only_description",
      });
      return;
    }

    // Defer the interaction before async work to prevent timeout
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const tomoriState = await getCachedTomoriState(interaction.guildId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
      });
      return;
    }

    errorContext.serverId = tomoriState.server_id;
    errorContext.personaId = tomoriState.persona_id;

    const role = interaction.options.getRole("role", true);
    const action = interaction.options.getString("action", true);

    if (role.id === interaction.guildId) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "commands.server.whitelist.role.invalid_role_title",
        descriptionKey: "commands.server.whitelist.role.invalid_role_description",
      });
      return;
    }

    const roleMention = `<@&${role.id}>`;

    if (action === "add") {
      const alreadySet = await whitelistRepository.isRoleWhitelisted(tomoriState.server_id, role.id);
      if (alreadySet) {
        await replyInfoEmbed(interaction, locale, {
          color: ColorCode.WARN,
          titleKey: "commands.server.whitelist.role.already_set_title",
          descriptionKey: "commands.server.whitelist.role.already_set_description",
          descriptionVars: {
            role_mention: roleMention,
          },
        });
        return;
      }

      await whitelistRepository.upsertRoleWhitelist(tomoriState.server_id, role.id);
      invalidateWhitelistCache(interaction.guildId);

      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.SUCCESS,
        titleKey: "commands.server.whitelist.role.success_add_title",
        descriptionKey: "commands.server.whitelist.role.success_add_description",
        descriptionVars: {
          role_mention: roleMention,
        },
      });

      log.info(`Role ${role.name} (${role.id}) added to whitelist in server ${interaction.guildId}`);
      return;
    }

    const removed = await whitelistRepository.removeRoleWhitelist(tomoriState.server_id, role.id);
    if (!removed) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.WARN,
        titleKey: "commands.server.whitelist.role.not_set_title",
        descriptionKey: "commands.server.whitelist.role.not_set_description",
        descriptionVars: {
          role_mention: roleMention,
        },
      });
      return;
    }

    invalidateWhitelistCache(interaction.guildId);

    await replyInfoEmbed(interaction, locale, {
      color: ColorCode.SUCCESS,
      titleKey: "commands.server.whitelist.role.success_remove_title",
      descriptionKey: "commands.server.whitelist.role.success_remove_description",
      descriptionVars: {
        role_mention: roleMention,
      },
    });

    log.info(`Role ${role.name} (${role.id}) removed from whitelist in server ${interaction.guildId}`);
  } catch (error) {
    log.error("Error executing /server whitelist role command", error, errorContext);

    await replyInfoEmbed(interaction, locale, {
      color: ColorCode.ERROR,
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
    });
  }
}
