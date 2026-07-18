/**
 * Command: /config humanizer
 * Sets how 'human-like' Tomori's response delivery is (streaming, typing
 * simulation, sentence chunking, casual text).
 *
 * Scopes:
 * - global (default): server-wide value stored in server_chat_configs.humanizer_degree
 * - persona: per-persona override stored in persona_configs.humanizer_degree
 *   (persona picker shown first; the modal's "Inherit" choice clears the override)
 *
 * At runtime the persona override is overlaid onto config.humanizer_degree when
 * the persona's TomoriState is assembled, so the answering persona always speaks
 * at its own degree while everyone else inherits the global setting.
 */

import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  ModalSubmitInteraction,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import type { RadioGroupOption } from "@/types/discord/modal";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { configRepository, personaRepository } from "@/utils/db/repositories";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed, promptWithRawModal } from "@/utils/discord/interactionHelper";
import { replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";

// Define constants at the top (Rule #20)
const HUMANIZER_MIN = 0;
const HUMANIZER_MAX = 3;
const HUMANIZER_DEFAULT = 1;

// Modal configuration constants
const MODAL_CUSTOM_ID = "config_humanizer_modal";
const HUMANIZER_SELECT_ID = "humanizer_select";

// Sentinel radio value for the persona-scope "Inherit global" choice (clears the override)
const INHERIT_VALUE = "inherit";

/**
 * Creates humanizer degree options with localized descriptions.
 * The option matching `selectedValue` is pre-selected when the modal opens.
 * @param locale - The locale to use for localization
 * @param selectedValue - Radio value to pre-select ("0"-"3" or "inherit")
 * @param includeInherit - Whether to prepend the persona-scope "Inherit global" choice
 * @returns Array of RadioGroupOption with localized descriptions
 */
function createHumanizerOptions(locale: string, selectedValue: string, includeInherit: boolean): RadioGroupOption[] {
  const options: RadioGroupOption[] = [
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

  if (includeInherit) {
    options.unshift({
      label: localizer(locale, "commands.config.humanizer.choice_inherit"),
      value: INHERIT_VALUE,
      description: localizer(locale, "commands.config.humanizer.desc_inherit"),
    });
  }

  return options.map((option) => ({ ...option, default: option.value === selectedValue }));
}

// Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("humanizer")
    .setDescription(localizer("en-US", "commands.config.humanizer.description"))
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.config.humanizer.scope_description"))
        .setRequired(false)
        .addChoices(
          {
            name: localizer("en-US", "commands.config.humanizer.global_option"),
            value: "global",
          },
          {
            name: localizer("en-US", "commands.config.humanizer.persona_option"),
            value: "persona",
          },
        ),
    );

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

  // 2. Declare interaction handles outside try-catch for fallback error replies
  let modalHost: ChatInputCommandInteraction | ButtonInteraction = interaction;
  let modalSubmitInteraction: ModalSubmitInteraction | undefined;
  let selectedPersona: TomoriState | null = null;

  try {
    // 3. Load the Tomori state for this server (Rule #17)
    const serverDiscId = interaction.guild?.id ?? interaction.user.id;
    const tomoriState = await getCachedTomoriState(serverDiscId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 4. Resolve scope (defaults to global — the pre-scope behavior)
    const scope = (interaction.options.getString("scope") ?? "global") as "global" | "persona";

    // 5a. Persona scope: show the paginated persona picker first
    if (scope === "persona") {
      const allPersonas = await personaRepository.loadAllForServer(serverDiscId);

      if (allPersonas.length === 0) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.config.humanizer.no_personas_title",
          descriptionKey: "commands.config.humanizer.no_personas_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // preserveSelectedInteraction=true returns the unacknowledged ButtonInteraction
      // so the modal can be shown on it (do not defer before this).
      const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
        personas: allPersonas,
        color: ColorCode.INFO,
        preserveSelectedInteraction: true,
        onSelect: async () => {},
      });

      if (!personaSelection.success || !personaSelection.interaction || personaSelection.selectedIndex === undefined) {
        return;
      }

      modalHost = personaSelection.interaction;
      selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;

      if (!selectedPersona?.persona_id) {
        return;
      }
    }

    // 5b. Resolve the current value for pre-selection and "already set" comparison.
    // Global scope reads the raw server_chat_configs row instead of cached state:
    // the cached main persona's config.humanizer_degree may already carry a persona
    // overlay, which would mask the true server-wide value.
    let currentGlobal = HUMANIZER_DEFAULT;
    if (scope === "global" && tomoriState.server_id) {
      const chatConfig = await configRepository.getChatConfig(tomoriState.server_id);
      currentGlobal = chatConfig?.humanizer_degree ?? tomoriState.config.humanizer_degree ?? HUMANIZER_DEFAULT;
    }
    const currentOverride = selectedPersona?.humanizer_degree_override ?? null;
    const preselectedValue =
      scope === "persona"
        ? currentOverride === null
          ? INHERIT_VALUE
          : String(currentOverride)
        : String(currentGlobal);

    // 6. Show the modal with humanizer degree selection (persona scope adds "Inherit")
    const modalResult = await promptWithRawModal(modalHost, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.config.humanizer.modal_title",
      components: [
        {
          kind: "radioGroup" as const,
          customId: HUMANIZER_SELECT_ID,
          labelKey: "commands.config.humanizer.select_label",
          descriptionKey: "commands.config.humanizer.select_description",
          required: true,
          options: createHumanizerOptions(locale, preselectedValue, scope === "persona"),
        },
      ],
    });

    // 7. Handle modal outcome
    if (modalResult.outcome !== "submit") {
      log.info(`Humanizer degree selection modal ${modalResult.outcome} for user ${userData.user_id}`);
      return;
    }

    // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
    modalSubmitInteraction = modalResult.interaction!;

    // 8a. Defer the modal submit interaction — DB write below exceeds the 3-second window
    await modalSubmitInteraction.deferReply({ flags: MessageFlags.Ephemeral });
    // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
    const selectedValue = modalResult.values![HUMANIZER_SELECT_ID];

    // 8b. Parse the submitted value: null = inherit (persona scope only), 0-3 = degree
    const isInherit = scope === "persona" && selectedValue === INHERIT_VALUE;
    const humanizerValue = isInherit ? null : Number.parseInt(selectedValue, 10);

    // 8c. Validate the parsed value (additional safety check)
    if (
      humanizerValue !== null &&
      (Number.isNaN(humanizerValue) || humanizerValue < HUMANIZER_MIN || humanizerValue > HUMANIZER_MAX)
    ) {
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

    // 9. Check if this matches the current stored value for the chosen scope
    const currentValue = scope === "persona" ? currentOverride : currentGlobal;
    if (humanizerValue === currentValue) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.config.humanizer.already_set_title",
        descriptionKey:
          scope === "persona"
            ? "commands.config.humanizer.persona_already_set_description"
            : "commands.config.humanizer.already_set_description",
        descriptionVars: {
          value: getHumanizerLabel(locale, humanizerValue),
          persona: selectedPersona?.persona_nickname ?? "",
        },
        color: ColorCode.WARN,
      });
      return;
    }

    // 10. Persist to the appropriate table (Rule #4, #15)
    let updated: boolean;
    if (scope === "persona" && selectedPersona?.persona_id) {
      updated = await personaRepository.setHumanizerOverride(selectedPersona.persona_id, humanizerValue);
    } else {
      // Global scope never submits "inherit", so humanizerValue is a number here
      updated = await configRepository.updateChatConfig(tomoriState.server_id, {
        humanizer_degree: humanizerValue as number,
      });
    }

    // 11. Check if update succeeded
    if (!updated) {
      const context: ErrorContext = {
        personaId: scope === "persona" ? (selectedPersona?.persona_id ?? null) : tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "config humanizer",
          guildId: serverDiscId,
          scope,
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

    // 12. Invalidate cache so next message gets fresh config
    invalidateTomoriStateCache(serverDiscId);

    // 13. Success message with previous → new value for the chosen scope
    if (scope === "persona") {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.config.humanizer.persona_success_title",
        descriptionKey: "commands.config.humanizer.persona_success_description",
        descriptionVars: {
          persona: selectedPersona?.persona_nickname ?? "",
          value: getHumanizerLabel(locale, humanizerValue),
          previous_value: getHumanizerLabel(locale, currentOverride),
        },
        color: ColorCode.SUCCESS,
      });
    } else {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.config.humanizer.success_title",
        descriptionKey: "commands.config.humanizer.success_description",
        descriptionVars: {
          value: getHumanizerLabel(locale, humanizerValue),
          previous_value: getHumanizerLabel(locale, currentGlobal),
        },
        color: ColorCode.SUCCESS,
      });
    }
  } catch (error) {
    // 14. Log error with context (Rule #22)
    // Attempt to get server/tomori IDs only once if needed
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
        command: "config humanizer",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(`Error executing /config humanizer for user ${userData.user_disc_id}`, error as Error, context);

    // 15. Inform user of unknown error on the most specific available interaction
    const replyTarget = modalSubmitInteraction ?? modalHost;
    if (!replyTarget.replied && !replyTarget.deferred) {
      await replyTarget.reply({
        content: localizer(locale, "general.errors.unknown_error_description"),
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await replyTarget.followUp({
        content: localizer(locale, "general.errors.unknown_error_description"),
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

/**
 * Helper function to get a user-friendly label for humanizer values
 * @param locale - The user's locale
 * @param value - Humanizer degree value, or null for the persona-scope "Inherit" state
 * @returns Localized humanizer label
 */
function getHumanizerLabel(locale: string, value: number | null): string {
  switch (value) {
    case null:
      return localizer(locale, "commands.config.humanizer.choice_inherit");
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
