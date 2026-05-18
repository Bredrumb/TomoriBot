import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { getQuotaConfig } from "@/utils/quota/imageQuotaManager";
import {
  updateImageDailyUserQuota,
  updateImageServerwideQuota,
  updateImageServerwideResetDays,
} from "@/utils/db/repositories/QuotaRepository";
import type { UserRow } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";

// Quota limit constants
const MIN_USER_QUOTA = 0; // 0 = unlimited
const MAX_USER_QUOTA = 100;
const MIN_SERVERWIDE_QUOTA = 0; // 0 = unlimited
const MAX_SERVERWIDE_QUOTA = 99999;
const MIN_RESET_DAYS = 1;
const MAX_RESET_DAYS = 365;

/**
 * Configure the subcommand for /server quota image-generation.
 * Users select ONE of three options: daily_user_quota, serverwide_quota, or serverwide_quota_resets_in.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("image-generation")
    .setDescription(localizer("en-US", "commands.server.quota.imagegen.description"))
    .addIntegerOption((option) =>
      option
        .setName("daily_user_quota")
        .setDescription(localizer("en-US", "commands.server.quota.imagegen.daily_user_quota_limit_description"))
        .setMinValue(MIN_USER_QUOTA)
        .setMaxValue(MAX_USER_QUOTA),
    )
    .addIntegerOption((option) =>
      option
        .setName("serverwide_quota")
        .setDescription(localizer("en-US", "commands.server.quota.imagegen.serverwide_quota_limit_description"))
        .setMinValue(MIN_SERVERWIDE_QUOTA)
        .setMaxValue(MAX_SERVERWIDE_QUOTA),
    )
    .addIntegerOption((option) =>
      option
        .setName("serverwide_quota_resets_in")
        .setDescription(
          localizer("en-US", "commands.server.quota.imagegen.serverwide_quota_resets_in_days_description"),
        )
        .setMinValue(MIN_RESET_DAYS)
        .setMaxValue(MAX_RESET_DAYS),
    );

/**
 * Execute /server quota image-generation command.
 * Processes all provided options and updates quota settings accordingly.
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database
 * @param locale - Locale of the interaction
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // 1. Ensure command is run in a guild
  if (!interaction.guild || !interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // 2. Check permissions (Manage Server required)
  if (!interaction.memberPermissions?.has("ManageGuild")) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.permission_denied_title",
      descriptionKey: "general.errors.permission_denied_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // 3. Defer before async work
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // 4. Get server ID from database
  const serverId = await serverRepository.loadServerIdByDiscId(interaction.guild.id);

  if (!serverId) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.server_not_found_title",
      descriptionKey: "general.errors.server_not_found_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // 5. Get which options were provided
  const dailyUserQuota = interaction.options.getInteger("daily_user_quota");
  const serverwideQuota = interaction.options.getInteger("serverwide_quota");
  const resetDays = interaction.options.getInteger("serverwide_quota_resets_in");

  // 6. Check if at least one option was provided
  if (dailyUserQuota === null && serverwideQuota === null && resetDays === null) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.generic_error_title",
      descriptionKey: "general.errors.generic_error_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // 7. Process all provided options and collect results
  const updates: string[] = [];

  try {
    // Process daily user quota if provided
    if (dailyUserQuota !== null) {
      const result = await updateDailyUserQuota(serverId, dailyUserQuota, locale);
      if (result) {
        updates.push(result);
      }
    }

    // Process serverwide quota if provided
    if (serverwideQuota !== null) {
      const result = await updateServerwideQuota(serverId, serverwideQuota, locale);
      if (result) {
        updates.push(result);
      }
    }

    // Process reset days if provided
    if (resetDays !== null) {
      const result = await updateResetDays(serverId, resetDays, locale);
      if (result) {
        updates.push(result);
      }
    }

    log.info("Updated image generation quota settings");

    // 8. Send combined success message
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "commands.server.quota.imagegen.daily_user_quota_success_title",
      description: updates.join("\n"),
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    log.error("Error executing /server quota image-generation", error);

    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.generic_error_title",
      descriptionKey: "general.errors.generic_error_description",
      color: ColorCode.ERROR,
    });
  }
}

/**
 * Update daily user quota setting and return success message.
 * @param serverId - Database server ID
 * @param limit - New daily user quota limit (0 = unlimited)
 * @param locale - User's locale for formatting
 * @returns Success message string
 */
async function updateDailyUserQuota(serverId: number, limit: number, locale: string): Promise<string> {
  // 1. Ensure quota config exists (creates default if not exists)
  await getQuotaConfig(serverId);

  // 2. Update config
  await updateImageDailyUserQuota(serverId, limit);

  // 3. Format and return success message
  const limitText = limit === 0 ? localizer(locale, "commands.server.quota.imagegen.unlimited") : `${limit}`;

  return localizer(locale, "commands.server.quota.imagegen.daily_user_quota_success_description", { limit: limitText });
}

/**
 * Update serverwide quota setting and return success message.
 * @param serverId - Database server ID
 * @param limit - New serverwide quota limit (0 = unlimited)
 * @param locale - User's locale for formatting
 * @returns Success message string
 */
async function updateServerwideQuota(serverId: number, limit: number, locale: string): Promise<string> {
  // 1. Get current quota config (creates default if not exists)
  const currentConfig = await getQuotaConfig(serverId);

  // 2. Update config
  await updateImageServerwideQuota(
    serverId,
    limit,
    currentConfig.serverwide_quota_resets_in,
    currentConfig.serverwide_quota,
  );

  // 4. Format and return success message
  const limitText = limit === 0 ? localizer(locale, "commands.server.quota.imagegen.unlimited") : `${limit}`;

  return localizer(locale, "commands.server.quota.imagegen.serverwide_quota_success_description", { limit: limitText });
}

/**
 * Update serverwide quota reset period and return success message.
 * @param serverId - Database server ID
 * @param days - Number of days before quota resets (1-365)
 * @param locale - User's locale for formatting
 * @returns Success message string
 */
async function updateResetDays(serverId: number, days: number, locale: string): Promise<string> {
  // 1. Get current quota config (creates default if not exists)
  const currentConfig = await getQuotaConfig(serverId);

  // 2. Update config
  await updateImageServerwideResetDays(serverId, days, currentConfig.serverwide_quota > 0);

  // 4. Format and return success message
  return localizer(locale, "commands.server.quota.imagegen.serverwide_quota_resets_in_success_description", {
    days: `${days}`,
  });
}
