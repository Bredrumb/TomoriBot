import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { sql } from "@/utils/db/client";
import type { UserRow } from "@/types/db/schema";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { log, ColorCode } from "@/utils/misc/logger";
import { getVideoQuotaConfig } from "@/utils/quota/videoQuotaManager";
import {
  updateVideoDailyUserQuota,
  updateVideoServerwideQuota,
  updateVideoServerwideResetDays,
} from "@/utils/db/repositories/QuotaRepository";
import { localizer } from "@/utils/text/localizer";

// Quota limit constants
const MIN_USER_QUOTA = 0; // 0 = unlimited
const MAX_USER_QUOTA = 100;
const MIN_SERVERWIDE_QUOTA = 0; // 0 = unlimited
const MAX_SERVERWIDE_QUOTA = 99999;
const MIN_RESET_DAYS = 1;
const MAX_RESET_DAYS = 365;

/**
 * Configure the subcommand for /server quota video-generation.
 * Users can update one or more quota settings in a single invocation.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("video-generation")
    .setDescription(localizer("en-US", "commands.server.quota.videogen.description"))
    .addIntegerOption((option) =>
      option
        .setName("daily_user_quota")
        .setDescription(localizer("en-US", "commands.server.quota.videogen.daily_user_quota_limit_description"))
        .setMinValue(MIN_USER_QUOTA)
        .setMaxValue(MAX_USER_QUOTA),
    )
    .addIntegerOption((option) =>
      option
        .setName("serverwide_quota")
        .setDescription(localizer("en-US", "commands.server.quota.videogen.serverwide_quota_limit_description"))
        .setMinValue(MIN_SERVERWIDE_QUOTA)
        .setMaxValue(MAX_SERVERWIDE_QUOTA),
    )
    .addIntegerOption((option) =>
      option
        .setName("serverwide_quota_resets_in")
        .setDescription(
          localizer("en-US", "commands.server.quota.videogen.serverwide_quota_resets_in_days_description"),
        )
        .setMinValue(MIN_RESET_DAYS)
        .setMaxValue(MAX_RESET_DAYS),
    );

/**
 * Execute /server quota video-generation command.
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

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const [serverRow] = await sql<{ server_id: number }[]>`
		SELECT server_id FROM servers WHERE server_disc_id = ${interaction.guild.id}
	`;

  if (!serverRow) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.server_not_found_title",
      descriptionKey: "general.errors.server_not_found_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const serverId = serverRow.server_id;
  const dailyUserQuota = interaction.options.getInteger("daily_user_quota");
  const serverwideQuota = interaction.options.getInteger("serverwide_quota");
  const resetDays = interaction.options.getInteger("serverwide_quota_resets_in");

  if (dailyUserQuota === null && serverwideQuota === null && resetDays === null) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.generic_error_title",
      descriptionKey: "general.errors.generic_error_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const updates: string[] = [];

  try {
    if (dailyUserQuota !== null) {
      updates.push(await updateDailyUserQuota(serverId, dailyUserQuota, locale));
    }

    if (serverwideQuota !== null) {
      updates.push(await updateServerwideQuota(serverId, serverwideQuota, locale));
    }

    if (resetDays !== null) {
      updates.push(await updateResetDays(serverId, resetDays, locale));
    }

    log.info("Updated video generation quota settings");

    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "commands.server.quota.videogen.daily_user_quota_success_title",
      description: updates.join("\n"),
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    log.error("Error executing /server quota video-generation", error);

    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.generic_error_title",
      descriptionKey: "general.errors.generic_error_description",
      color: ColorCode.ERROR,
    });
  }
}

async function updateDailyUserQuota(serverId: number, limit: number, locale: string): Promise<string> {
  await getVideoQuotaConfig(serverId);

  await updateVideoDailyUserQuota(serverId, limit);

  const limitText = limit === 0 ? localizer(locale, "commands.server.quota.videogen.unlimited") : `${limit}`;

  return localizer(locale, "commands.server.quota.videogen.daily_user_quota_success_description", { limit: limitText });
}

async function updateServerwideQuota(serverId: number, limit: number, locale: string): Promise<string> {
  const currentConfig = await getVideoQuotaConfig(serverId);

  await updateVideoServerwideQuota(
    serverId,
    limit,
    currentConfig.serverwide_quota_resets_in,
    currentConfig.serverwide_quota,
  );

  const limitText = limit === 0 ? localizer(locale, "commands.server.quota.videogen.unlimited") : `${limit}`;

  return localizer(locale, "commands.server.quota.videogen.serverwide_quota_success_description", { limit: limitText });
}

async function updateResetDays(serverId: number, days: number, locale: string): Promise<string> {
  const currentConfig = await getVideoQuotaConfig(serverId);

  await updateVideoServerwideResetDays(serverId, days, currentConfig.serverwide_quota > 0);

  return localizer(locale, "commands.server.quota.videogen.serverwide_quota_resets_in_success_description", {
    days: `${days}`,
  });
}
