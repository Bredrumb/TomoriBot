import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import type { UserRow, ErrorContext } from "../../types/db/schema";
import { invalidateUserCache } from "../../utils/cache/userCache";
import { userRepository } from "@/utils/db/repositories";

const SUPPORTED_LANGUAGES = ["en-US", "ja"] as const;
const DEFAULT_LANGUAGE = "en-US";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("language")
    .setDescription(localizer("en-US", "commands.personal.language.description"))
    .addStringOption((option) =>
      option
        .setName("value")
        .setDescription(localizer("en-US", "commands.personal.language.value_description"))
        .setRequired(true)
        .addChoices(
          {
            name: localizer("en-US", "commands.personal.language.choice_english"),
            value: "en-US",
          },
          {
            name: localizer("en-US", "commands.personal.language.choice_japanese"),
            value: "ja",
          },
        ),
    );

/**
 * Configures the user's preferred interface language for TomoriBot.
 * This affects how the bot's messages and interfaces appear to the individual user.
 * Supported languages: English (en-US) and Japanese (ja)
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // Defer the interaction before async work to prevent timeout
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const languageValue = interaction.options.getString("value", true);

    // Additional validation (Discord already handles choices, but just in case)
    if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(languageValue)) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.personal.language.invalid_value_title",
        descriptionKey: "commands.personal.language.invalid_value_description",
        descriptionVars: {
          supported: SUPPORTED_LANGUAGES.join(", "),
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    const currentLanguage = userData.language_pref ?? DEFAULT_LANGUAGE;
    if (languageValue === currentLanguage) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.personal.language.already_set_title",
        descriptionKey: "commands.personal.language.already_set_description",
        descriptionVars: {
          value: getLanguageLabel(locale, languageValue),
        },
        color: ColorCode.WARN,
      });
      return;
    }

    // biome-ignore lint/style/noNonNullAssertion: userData.user_id is always provided by command framework
    const ok = await userRepository.setLanguage(userData.user_id!, languageValue);

    if (!ok) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Invalidate user cache so next message gets fresh data
    invalidateUserCache(userData.user_disc_id);

    await replyInfoEmbed(interaction, languageValue, {
      titleKey: "commands.personal.language.success_title",
      descriptionKey: "commands.personal.language.success_description",
      descriptionVars: {
        value: getLanguageLabel(languageValue, languageValue),
        previous_value: getLanguageLabel(languageValue, currentLanguage),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config language",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
        valueAttempted: interaction.options.getString("value"), // Log attempted value
      },
    };
    await log.error(`Error executing /config language for user ${userData.user_disc_id}`, error as Error, context);

    // Inform user of unknown error
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: localizer(locale, "general.errors.unknown_error_description"),
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.followUp({
        content: localizer(locale, "general.errors.unknown_error_description"),
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

/**
 * Helper function to get a user-friendly label for language values
 * @param locale - The user's locale for localization
 */
function getLanguageLabel(locale: string, value: string): string {
  switch (value) {
    case "en-US":
      return localizer(locale, "commands.personal.language.choice_english");
    case "ja":
      return localizer(locale, "commands.personal.language.choice_japanese");
    default:
      // Default to English if value is somehow unexpected, though validation should prevent this
      log.warn(`Unexpected language value encountered in getLanguageLabel: ${value}`);
      return localizer(locale, "commands.personal.language.choice_english");
  }
}
