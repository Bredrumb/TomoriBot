import type {
  ChatInputCommandInteraction,
  Client,
  SlashCommandSubcommandBuilder,
  User,
  UserSelectMenuInteraction,
} from "discord.js";
import { ActionRowBuilder, ComponentType, EmbedBuilder, MessageFlags, UserSelectMenuBuilder } from "discord.js";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import {
  resetServerwideImageQuotaPool,
  resetServerwideTextQuotaPool,
  resetServerwideVideoQuotaPool,
  resetUserDailyImageQuota,
  resetUserDailyTextQuota,
  resetUserDailyVideoQuota,
} from "@/utils/db/repositories/QuotaRepository";
import type { UserRow } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";

type QuotaResetScope = "user" | "server";
type QuotaResetType = "imagegen" | "textgen" | "videogen";

/**
 * Configure /server quota reset subcommand.
 * Lets admins reset either a user's daily pool or the server-wide pool for image/text generation.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("reset")
    .setDescription(localizer("en-US", "commands.server.quota.reset.description"))
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.server.quota.reset.scope_description"))
        .setRequired(true)
        .addChoices(
          {
            name: localizer("en-US", "commands.server.quota.reset.scope_choice_user"),
            value: "user",
          },
          {
            name: localizer("en-US", "commands.server.quota.reset.scope_choice_server"),
            value: "server",
          },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("quota_type")
        .setDescription(localizer("en-US", "commands.server.quota.reset.quota_type_description"))
        .setRequired(true)
        .addChoices(
          {
            name: localizer("en-US", "commands.server.quota.reset.quota_type_choice_imagegen"),
            value: "imagegen",
          },
          {
            name: localizer("en-US", "commands.server.quota.reset.quota_type_choice_textgen"),
            value: "textgen",
          },
          {
            name: localizer("en-US", "commands.server.quota.reset.quota_type_choice_videogen"),
            value: "videogen",
          },
        ),
    );

/**
 * Execute /server quota reset.
 */
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

  if (!interaction.memberPermissions?.has("ManageGuild")) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.permission_denied_title",
      descriptionKey: "general.errors.permission_denied_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const rawScope = interaction.options.getString("scope", true);
  const rawQuotaType = interaction.options.getString("quota_type", true);

  if (
    (rawScope !== "user" && rawScope !== "server") ||
    (rawQuotaType !== "imagegen" && rawQuotaType !== "textgen" && rawQuotaType !== "videogen")
  ) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.generic_error_title",
      descriptionKey: "general.errors.generic_error_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const scope = rawScope as QuotaResetScope;
  const quotaType = rawQuotaType as QuotaResetType;

  const serverId = await serverRepository.loadServerIdByDiscId(interaction.guild.id);

  if (!serverId) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.server_not_found_title",
      descriptionKey: "general.errors.server_not_found_description",
      color: ColorCode.ERROR,
    });
    return;
  }
  try {
    if (scope === "user") {
      const targetUser = await promptUserSelection(interaction, locale);
      if (!targetUser) {
        return;
      }

      await resetUserDailyQuota(serverId, targetUser.id, quotaType);

      await replyInfoEmbed(interaction, userData.language_pref, {
        titleKey: "commands.server.quota.reset.success_title",
        descriptionKey:
          quotaType === "imagegen"
            ? "commands.server.quota.reset.success_user_imagegen_description"
            : quotaType === "textgen"
              ? "commands.server.quota.reset.success_user_textgen_description"
              : "commands.server.quota.reset.success_user_videogen_description",
        descriptionVars: {
          user: `<@${targetUser.id}>`,
        },
        color: ColorCode.SUCCESS,
      });

      log.info(
        `Reset user daily quota (serverId=${serverId}, scope=${scope}, quotaType=${quotaType}, targetUserId=${targetUser.id}, resetBy=${interaction.user.id})`,
      );
      return;
    }

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    await resetServerwideQuotaPool(serverId, quotaType);

    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "commands.server.quota.reset.success_title",
      descriptionKey:
        quotaType === "imagegen"
          ? "commands.server.quota.reset.success_server_imagegen_description"
          : quotaType === "textgen"
            ? "commands.server.quota.reset.success_server_textgen_description"
            : "commands.server.quota.reset.success_server_videogen_description",
      color: ColorCode.SUCCESS,
    });

    log.info(
      `Reset serverwide quota (serverId=${serverId}, scope=${scope}, quotaType=${quotaType}, resetBy=${interaction.user.id})`,
    );
  } catch (error) {
    log.error("Error executing /server quota reset", error);
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.generic_error_title",
      descriptionKey: "general.errors.generic_error_description",
      color: ColorCode.ERROR,
    });
  }
}

async function promptUserSelection(interaction: ChatInputCommandInteraction, locale: string): Promise<User | null> {
  const userSelect = new UserSelectMenuBuilder()
    .setCustomId(`quota_reset_user_select_${interaction.id}`)
    .setPlaceholder(localizer(locale, "commands.server.quota.reset.user_select_placeholder"))
    .setMinValues(1)
    .setMaxValues(1);

  const selectEmbed = new EmbedBuilder()
    .setTitle(localizer(locale, "commands.server.quota.reset.user_select_title"))
    .setDescription(localizer(locale, "commands.server.quota.reset.user_select_description"))
    .setColor(ColorCode.INFO);

  await interaction.reply({
    embeds: [selectEmbed],
    components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(userSelect)],
    flags: MessageFlags.Ephemeral,
  });

  const promptMessage = await interaction.fetchReply();
  let userSelectInteraction: UserSelectMenuInteraction;

  try {
    userSelectInteraction = await promptMessage.awaitMessageComponent({
      componentType: ComponentType.UserSelect,
      filter: (componentInteraction: UserSelectMenuInteraction) => componentInteraction.user.id === interaction.user.id,
      time: 60_000,
    });
  } catch {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.interaction.timeout_title",
      descriptionKey: "general.interaction.timeout_description",
      color: ColorCode.WARN,
    });
    return null;
  }

  await userSelectInteraction.deferUpdate();
  await interaction.editReply({ components: [] });

  const selectedUserId = userSelectInteraction.values[0];
  const selectedUser = userSelectInteraction.users.get(selectedUserId);

  if (!selectedUser) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.generic_error_title",
      descriptionKey: "general.errors.generic_error_description",
      color: ColorCode.ERROR,
    });
    return null;
  }

  return selectedUser;
}

async function resetUserDailyQuota(serverId: number, userDiscId: string, quotaType: QuotaResetType): Promise<void> {
  if (quotaType === "imagegen") {
    await resetUserDailyImageQuota(serverId, userDiscId);
    return;
  }

  if (quotaType === "textgen") {
    await resetUserDailyTextQuota(serverId, userDiscId);
    return;
  }

  await resetUserDailyVideoQuota(serverId, userDiscId);
}

async function resetServerwideQuotaPool(serverId: number, quotaType: QuotaResetType): Promise<void> {
  if (quotaType === "imagegen") {
    await resetServerwideImageQuotaPool(serverId);
    return;
  }

  if (quotaType === "textgen") {
    await resetServerwideTextQuotaPool(serverId);
    return;
  }

  await resetServerwideVideoQuotaPool(serverId);
}
