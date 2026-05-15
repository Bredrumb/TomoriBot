import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import {
  acknowledgeModalSubmitForRefresh,
  promptWithPaginatedModal,
  safeSelectOptionText,
} from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { replyComponentsV2Status, updateButtonComponentsV2Status } from "@/utils/discord/ui/statusComponents";
import { type AvatarSessionCache, replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { type UserRow, type ErrorContext, tomoriSchema, type TomoriState } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { sql } from "@/utils/db/client";
import { personaRepository } from "@/utils/db/repositories";

// Rule 20: Constants for static values at the top
const MODAL_CUSTOM_ID = "forget_attribute_modal";
const ATTRIBUTE_SELECT_ID = "attribute_select";

/**
 * Helper function to perform attribute removal from database
 * @param tomoriState - Current Tomori state
 * @param attributeToRemove - Attribute to remove
 * @param userData - User data
 * @param replyInteraction - Interaction to reply to (can be modal or pagination)
 * @param locale - User locale
 */
async function performAttributeRemoval(
  tomoriState: TomoriState,
  attributeToRemove: string,
  userData: UserRow,
  replyInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  locale: string,
  suppressSuccessReply = false,
): Promise<boolean> {
  // Update the attribute_list in the database using array_remove
  const [updatedRow] = await sql`
		UPDATE tomoris
		SET attribute_list = array_remove(attribute_list, ${attributeToRemove})
		WHERE tomori_id = ${tomoriState.tomori_id}
		RETURNING *
	`;

  // Validate the returned data
  const validatedTomori = tomoriSchema.safeParse(updatedRow);

  if (!validatedTomori.success || !updatedRow) {
    // Log error specific to this update failure
    const context: ErrorContext = {
      tomoriId: tomoriState.tomori_id,
      serverId: tomoriState.server_id,
      userId: userData.user_id,
      errorType: "DatabaseUpdateError",
      metadata: {
        command: "forget attribute",
        attributeToRemove,
        validationErrors: validatedTomori.success ? null : validatedTomori.error.flatten(),
      },
    };

    await log.error(
      "Failed to update or validate attribute_list in tomoris table",
      validatedTomori.success
        ? new Error("Database update returned no rows or unexpected data")
        : new Error("Updated tomori data failed validation"),
      context,
    );

    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return false;
  }

  // Invalidate cache so next message gets fresh config
  if (replyInteraction.guildId) {
    invalidateTomoriStateCache(replyInteraction.guildId);
  }

  // Log success and show success message
  log.success(
    `Removed attribute "${attributeToRemove}" for tomori ${tomoriState.tomori_id} by user ${userData.user_disc_id}`,
  );

  if (!suppressSuccessReply) {
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "commands.forget.attribute.success_title",
      descriptionKey: "commands.forget.attribute.success_description",
      descriptionVars: {
        attribute: attributeToRemove,
      },
      color: ColorCode.SUCCESS,
    });
  }

  return true;
}

// Rule 21: Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.persona.attribute.remove.description"));

/**
 * Rule 1: JSDoc comment for exported function
 * Removes a personality attribute from Tomori's memory using a paginated embed
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
  // 1. Ensure command is run in a valid channel context
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Define state variables outside try for catch block context
  let tomoriState: TomoriState | null = null;
  let selectedPersona: TomoriState | null = null;
  let personaSelectionInteraction: ButtonInteraction | null = null;

  try {
    // 2. Load server's Tomori state (Rule 17)
    tomoriState = await getCachedTomoriState(interaction.guild?.id ?? interaction.user.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Select target persona via paginated selector
    const allPersonas = await personaRepository.loadAllForServer(interaction.guild?.id ?? interaction.user.id);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const avatarSessionCache: AvatarSessionCache = new Map();
    while (true) {
      const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
        personas: allPersonas,
        avatarSessionCache,
        color: ColorCode.INFO,
        preserveSelectedInteraction: true,
        onSelect: async () => {},
      });

      if (!personaSelection.success) {
        if (personaSelection.reason === "cancelled" || personaSelection.reason === "fatal") return;
        continue;
      }
      if (personaSelection.selectedIndex === undefined || !personaSelection.interaction) {
        return;
      }

      personaSelectionInteraction = personaSelection.interaction;
      selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;
      if (!selectedPersona?.tomori_id) {
        await updateButtonComponentsV2Status(
          personaSelectionInteraction,
          locale,
          "general.errors.invalid_option_title",
          "general.errors.invalid_option_description",
          ColorCode.ERROR,
          undefined,
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      // Check if user has Manage Server permission - admins can bypass teaching restriction
      const hasManagePermission = interaction.memberPermissions?.has("ManageGuild") ?? false;

      // 4. Check if teaching is enabled
      if (!tomoriState.config.attribute_memteaching_enabled && !hasManagePermission) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.teach.attribute.teaching_disabled_title",
          descriptionKey: "commands.teach.attribute.teaching_disabled_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // 5. Get the current attribute list
      const currentAttributes = selectedPersona.attribute_list ?? [];

      // 6. Check if there are any attributes to remove
      if (currentAttributes.length === 0) {
        await updateButtonComponentsV2Status(
          personaSelectionInteraction,
          locale,
          "commands.forget.attribute.no_attributes_title",
          "commands.forget.attribute.no_attributes",
          ColorCode.WARN,
          undefined,
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      // 7. Use unified paginated modal system (supports up to 25 items directly, >25 via page selection)
      const attributeSelectOptions: SelectOption[] = currentAttributes.map((attribute, index) => ({
        label: safeSelectOptionText(attribute),
        value: index.toString(), // Use index to avoid truncation issues
        description: undefined, // No description needed for attributes
      }));

      const modalResult = await promptWithPaginatedModal(personaSelectionInteraction, locale, {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.forget.attribute.modal_title",
        components: [
          {
            customId: ATTRIBUTE_SELECT_ID,
            labelKey: "commands.forget.attribute.select_label",
            descriptionKey: "commands.forget.attribute.select_description",
            placeholder: "commands.forget.attribute.select_placeholder",
            required: true,
            options: attributeSelectOptions,
          },
        ],
      });

      // Handle modal outcome - keep the persona picker loop alive when the modal closes
      if (modalResult.outcome !== "submit") {
        log.info(`Attribute removal modal ${modalResult.outcome} for user ${userData.user_id}`);
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      // Extract values from the modal
      // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
      const modalSubmitInteraction = modalResult.interaction!;
      const selectedIndex = Number.parseInt(
        // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
        modalResult.values![ATTRIBUTE_SELECT_ID],
        10,
      );
      const attributeToRemove = currentAttributes[selectedIndex];

      // Perform the database update - let helper functions manage interaction state
      const removalSucceeded = await performAttributeRemoval(
        selectedPersona,
        attributeToRemove,
        userData,
        modalSubmitInteraction,
        locale,
        true,
      );
      if (!removalSucceeded) {
        return;
      }
      await acknowledgeModalSubmitForRefresh(modalSubmitInteraction);
      await replyComponentsV2Status(
        interaction,
        locale,
        "commands.forget.attribute.success_title",
        "commands.forget.attribute.success_description",
        ColorCode.SUCCESS,
        {
          attribute: attributeToRemove,
        },
        "general.pagination.reloading_persona_picker",
      );
    }
  } catch (error) {
    // 15. Catch unexpected errors
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      tomoriId: selectedPersona?.tomori_id ?? tomoriState?.tomori_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "forget attribute",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(`Unexpected error in /forget attribute for user ${userData.user_disc_id}`, error as Error, context);

    // 16. Inform user of unknown error, prioritizing unacknowledged button interaction
    const errorReplyTarget =
      personaSelectionInteraction && !personaSelectionInteraction.deferred && !personaSelectionInteraction.replied
        ? personaSelectionInteraction
        : interaction;
    await replyInfoEmbed(errorReplyTarget, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
