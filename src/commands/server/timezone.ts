import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { configRepository } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "../../utils/cache/tomoriStateCache";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed } from "../../utils/discord/ui/embeds";
import type { UserRow, ErrorContext } from "../../types/db/schema";
import { formatUTCOffset } from "../../utils/text/timezoneHelper";

const TIMEZONE_MIN = -12;
const TIMEZONE_MAX = 14;
const TIMEZONE_DEFAULT = 0; // UTC

/**
 * Configures the subcommand for server timezone setting
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("timezone")
    .setDescription(localizer("en-US", "commands.server.timezone.description"))
    .addNumberOption((option) =>
      option
        .setName("value")
        .setDescription(localizer("en-US", "commands.server.timezone.value_description"))
        .setMinValue(TIMEZONE_MIN)
        .setMaxValue(TIMEZONE_MAX)
        .setRequired(true),
    );

/**
 * Sets the timezone offset for the server.
 * This affects how times are displayed in reminders and context messages.
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

  // Defer the interaction before async work to prevent timeout
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const timezoneValue = interaction.options.getNumber("value", true);

    // Additional validation (Discord already handles min/max, but just in case)
    if (timezoneValue < TIMEZONE_MIN || timezoneValue > TIMEZONE_MAX) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.server.timezone.invalid_value_title",
        descriptionKey: "commands.server.timezone.invalid_value_description",
        descriptionVars: {
          min: TIMEZONE_MIN.toString(),
          max: TIMEZONE_MAX.toString(),
        },
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

    const currentTimezone = tomoriState.config.timezone_offset ?? TIMEZONE_DEFAULT;
    if (timezoneValue === currentTimezone) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.server.timezone.already_set_title",
        descriptionKey: "commands.server.timezone.already_set_description",
        descriptionVars: {
          timezone: formatUTCOffset(timezoneValue),
        },
        color: ColorCode.WARN,
      });
      return;
    }

    const updated = await configRepository.updateChatConfig(tomoriState.server_id, { timezone_offset: timezoneValue });

    if (!updated) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "server timezone",
          guildId: interaction.guild?.id,
          timezoneValue,
        },
      };
      await log.error("Failed to update timezone_offset config", new Error("Database update failed"), context);

      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Invalidate cache so next message gets fresh config
    invalidateTomoriStateCache(interaction.guild.id);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.server.timezone.success_title",
      descriptionKey: "commands.server.timezone.success_description",
      descriptionVars: {
        timezone: formatUTCOffset(timezoneValue),
        previous_timezone: formatUTCOffset(currentTimezone),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    let serverIdForError: number | null = null;
    let personaIdForError: number | null = null;
    if (interaction.guild?.id) {
      const state = await getCachedTomoriState(interaction.guild.id);
      serverIdForError = state?.server_id ?? null;
      personaIdForError = state?.persona_id ?? null;
    }

    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: serverIdForError,
      personaId: personaIdForError,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server timezone",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
        valueAttempted: interaction.options.getNumber("value"),
      },
    };
    await log.error(`Error executing /server timezone for user ${userData.user_disc_id}`, error as Error, context);

    if (interaction.deferred && !interaction.replied) {
      await interaction.followUp({
        content: localizer(locale, "general.errors.unknown_error_description"),
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
