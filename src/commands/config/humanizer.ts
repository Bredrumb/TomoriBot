import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "../../utils/cache/tomoriStateCache";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed, promptWithRawModal } from "../../utils/discord/interactionHelper";
import type { UserRow, ErrorContext } from "../../types/db/schema";
import type { RadioGroupOption } from "../../types/discord/modal";
import { configRepository } from "@/utils/db/repositories";

// Define constants at the top (Rule #20)
const HUMANIZER_MIN = 0;
const HUMANIZER_MAX = 3;
const HUMANIZER_DEFAULT = 1;

// Modal configuration constants
const MODAL_CUSTOM_ID = "config_humanizer_modal";
const HUMANIZER_SELECT_ID = "humanizer_select";

/**
 * Creates humanizer degree options with localized descriptions
 * @param locale - The locale to use for localization
 * @returns Array of SelectOption with localized descriptions
 */
function createHumanizerOptions(locale: string): RadioGroupOption[] {
  return [
    {
      label: localizer(locale, "commands.config.humanizer.choice_none"),
      value: "0",
      description: localizer(locale, "commands.config.humanizer.desc_none"),
    },
    {
      label: localizer(locale, "commands.config.humanizer.choice_light"),
      value: "1",
      description: localizer(locale, "commands.config.humanizer.desc_light"),
    },
    {
      label: localizer(locale, "commands.config.humanizer.choice_medium"),
      value: "2",
      description: localizer(locale, "commands.config.humanizer.desc_medium"),
    },
    {
      label: localizer(locale, "commands.config.humanizer.choice_heavy"),
      value: "3",
      description: localizer(locale, "commands.config.humanizer.desc_heavy"),
    },
  ];
}

// Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("humanizer").setDescription(localizer("en-US", "commands.config.humanizer.description"));

/**
 * Configures the humanizer degree setting for Tomori.
 * Has 4 levels, each stacking upon each other:
 * 0 = Active system prompt + aggregated visible delivery per tool-free phase
 * 1 = Active system prompt + live discrete streaming
 * 2 = 1 + typing simulation and pauses between messages
 * 3 = 2 + sentence-level chunking and casual text humanization
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
  // 1. Ensure command is run in a channel
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  try {
    // 2. Load the Tomori state for this server (Rule #17)
    const tomoriState = await getCachedTomoriState(interaction.guild?.id ?? interaction.user.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 3. Show the modal with humanizer degree selection
    const modalResult = await promptWithRawModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.config.humanizer.modal_title",
      components: [
        {
          kind: "radioGroup" as const,
          customId: HUMANIZER_SELECT_ID,
          labelKey: "commands.config.humanizer.select_label",
          descriptionKey: "commands.config.humanizer.select_description",
          required: true,
          options: createHumanizerOptions(locale),
        },
      ],
    });

    // 4. Handle modal outcome
    if (modalResult.outcome !== "submit") {
      log.info(`Humanizer degree selection modal ${modalResult.outcome} for user ${userData.user_id}`);
      return;
    }

    // Extract values from the modal
    // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
    const modalSubmitInteraction = modalResult.interaction!;

    // 5a. Defer the modal submit interaction — DB write below exceeds the 3-second window
    await modalSubmitInteraction.deferReply({ flags: MessageFlags.Ephemeral });
    // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
    const selectedValue = modalResult.values![HUMANIZER_SELECT_ID];
    const humanizerValue = Number.parseInt(selectedValue, 10);

    // 5b. Validate the parsed value (additional safety check)
    if (Number.isNaN(humanizerValue) || humanizerValue < HUMANIZER_MIN || humanizerValue > HUMANIZER_MAX) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.operation_failed_title",
        descriptionKey: "commands.config.humanizer.invalid_value_description",
        descriptionVars: {
          min: String(HUMANIZER_MIN),
          max: String(HUMANIZER_MAX),
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    // 6. Check if this is the same as the current humanizer value
    const currentHumanizer = tomoriState.config.humanizer_degree ?? HUMANIZER_DEFAULT;
    if (humanizerValue === currentHumanizer) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.config.humanizer.already_set_title",
        descriptionKey: "commands.config.humanizer.already_set_description",
        descriptionVars: {
          value: getHumanizerLabel(locale, humanizerValue),
        },
        color: ColorCode.WARN,
      });
      return;
    }

    // 7. Update the config in the database (Rule #4, #15)
    const updated = await configRepository.updateChatConfig(tomoriState.server_id, {
      humanizer_degree: humanizerValue,
    });

    // 8. Check if update succeeded
    if (!updated) {
      const context: ErrorContext = {
        tomoriId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "config humanizer",
          guildId: interaction.guild?.id ?? interaction.user.id,
          humanizerValue,
        },
      };
      await log.error(
        "Failed to update humanizer_degree config",
        new Error("Database update returned no rows"),
        context,
      );

      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 9. Invalidate cache so next message gets fresh config
    invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

    // 10. Success message with explanation of the humanizer effect
    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.config.humanizer.success_title",
      descriptionKey: "commands.config.humanizer.success_description",
      descriptionVars: {
        value: getHumanizerLabel(locale, humanizerValue),
        previous_value: getHumanizerLabel(locale, currentHumanizer),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    // 11. Log error with context (Rule #22)
    // Attempt to get server/tomori IDs only once if needed
    let serverIdForError: number | null = null;
    let tomoriIdForError: number | null = null;
    if (interaction.guild?.id) {
      const state = await getCachedTomoriState(interaction.guild.id);
      serverIdForError = state?.server_id ?? null;
      tomoriIdForError = state?.persona_id ?? null;
    }

    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: serverIdForError,
      tomoriId: tomoriIdForError,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config humanizer",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(`Error executing /config humanizer for user ${userData.user_disc_id}`, error as Error, context);

    // 11. Inform user of unknown error
    // Check if the interaction has already been replied to or deferred
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
 * Helper function to get a user-friendly label for humanizer values
 * @param locale - The user's locale
 * @param value - Humanizer degree value
 * @returns Localized humanizer label
 */
function getHumanizerLabel(locale: string, value: number): string {
  switch (value) {
    case 0:
      return localizer(locale, "commands.config.humanizer.choice_none");
    case 1:
      return localizer(locale, "commands.config.humanizer.choice_light");
    case 2:
      return localizer(locale, "commands.config.humanizer.choice_medium");
    case 3:
      return localizer(locale, "commands.config.humanizer.choice_heavy");
    default:
      // Default to light if value is somehow unexpected, though validation should prevent this
      log.warn(`Unexpected humanizer value encountered in getHumanizerLabel: ${value}`);
      return localizer(locale, "commands.config.humanizer.choice_light");
  }
}
