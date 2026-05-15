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
import { sql } from "@/utils/db/client";
import type { SelectOption } from "@/types/discord/modal";
import { personaRepository } from "@/utils/db/repositories";

// Rule 20: Constants for static values at the top
const MODAL_CUSTOM_ID = "forget_sampledialogue_modal";
const DIALOGUE_SELECT_ID = "dialogue_select";

/**
 * Repairs mismatched sample dialogue arrays by truncating both to the shorter length.
 * This heals corruption caused by the old array_remove() bug which could remove
 * duplicate values from one array but not the other, breaking alignment.
 * @param tomoriId - The tomori ID to repair
 * @param inLength - Current length of sample_dialogues_in
 * @param outLength - Current length of sample_dialogues_out
 * @returns The repaired [in, out] arrays, or null if repair failed
 */
async function repairMismatchedDialogues(
  tomoriId: number,
  inLength: number,
  outLength: number,
): Promise<{ repairedIn: string[]; repairedOut: string[] } | null> {
  // Truncate both arrays to the shorter length to restore alignment
  const safeLength = Math.min(inLength, outLength);

  log.warn(
    `Self-healing: truncating sample dialogues for tomori ${tomoriId} from (in: ${inLength}, out: ${outLength}) to ${safeLength} pairs`,
  );

  const [updatedRow] = await sql`
		UPDATE tomoris
		SET
			sample_dialogues_in = sample_dialogues_in[1:${safeLength}],
			sample_dialogues_out = sample_dialogues_out[1:${safeLength}]
		WHERE tomori_id = ${tomoriId}
		RETURNING sample_dialogues_in, sample_dialogues_out
	`;

  if (!updatedRow) {
    log.error(`Self-healing failed: no rows returned for tomori ${tomoriId}`);
    return null;
  }

  log.success(`Self-healing complete: sample dialogues for tomori ${tomoriId} repaired to ${safeLength} pairs`);

  return {
    repairedIn: (updatedRow.sample_dialogues_in as string[]) ?? [],
    repairedOut: (updatedRow.sample_dialogues_out as string[]) ?? [],
  };
}

/**
 * Helper function to perform sample dialogue removal from database
 * @param tomoriState - Current Tomori state
 * @param selectedIndex - Index of the dialogue pair to remove
 * @param currentIn - Current input dialogues array
 * @param currentOut - Current output dialogues array
 * @param userData - User data
 * @param replyInteraction - Interaction to reply to (can be modal or pagination)
 * @param locale - User locale
 */
async function performSampleDialogueRemoval(
  tomoriState: TomoriState,
  selectedIndex: number,
  currentIn: string[],
  currentOut: string[],
  userData: UserRow,
  replyInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  locale: string,
  suppressSuccessReply = false,
): Promise<boolean> {
  // Get the item being removed (for display purposes)
  const itemToRemoveIn = currentIn[selectedIndex];
  const itemToRemoveOut = currentOut[selectedIndex];

  // Convert 0-based JS index to 1-based PostgreSQL ordinality
  const pgIndex = selectedIndex + 1;

  // Update both arrays using index-based removal via unnest + ordinality
  // NOTE: array_remove() is NOT safe here — it removes ALL matching values,
  // which corrupts array alignment when duplicate dialogue text exists.
  const [updatedRow] = await sql`
		UPDATE tomoris
		SET
			sample_dialogues_in = (
				SELECT COALESCE(array_agg(elem ORDER BY ord), '{}')
				FROM unnest(sample_dialogues_in) WITH ORDINALITY AS t(elem, ord)
				WHERE ord != ${pgIndex}
			),
			sample_dialogues_out = (
				SELECT COALESCE(array_agg(elem ORDER BY ord), '{}')
				FROM unnest(sample_dialogues_out) WITH ORDINALITY AS t(elem, ord)
				WHERE ord != ${pgIndex}
			)
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
        command: "forget sampledialogue",
        selectedIndex,
        validationErrors: validatedTomori.success ? null : validatedTomori.error.flatten(),
      },
    };

    await log.error(
      "Failed to update or validate sample_dialogues in tomoris table",
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
    `Removed sample dialogue pair at index ${selectedIndex} for tomori ${tomoriState.tomori_id} by user ${userData.user_disc_id}`,
  );

  if (!suppressSuccessReply) {
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "commands.forget.sampledialogue.success_title",
      descriptionKey: "commands.forget.sampledialogue.success_description",
      descriptionVars: {
        input: itemToRemoveIn.length > 50 ? `${itemToRemoveIn.slice(0, 50)}...` : itemToRemoveIn,
        output: itemToRemoveOut.length > 50 ? `${itemToRemoveOut.slice(0, 50)}...` : itemToRemoveOut,
      },
      color: ColorCode.SUCCESS,
    });
  }

  return true;
}

// Rule 21: Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("remove")
    .setDescription(localizer("en-US", "commands.persona.sample-dialogue.remove.description"));

/**
 * Rule 1: JSDoc comment for exported function
 * Removes a sample dialogue pair from Tomori's memory using a paginated embed
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

  // Define state and result variables outside try for catch block context
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

      // 4. Check if teaching is enabled - FIX: Access through config object
      if (!tomoriState.config.sampledialogue_memteaching_enabled && !hasManagePermission) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.teach.sampledialogue.teaching_disabled_title",
          descriptionKey: "commands.teach.sampledialogue.teaching_disabled_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // 5. Get the current dialogue pairs
      let currentIn = selectedPersona.sample_dialogues_in ?? [];
      let currentOut = selectedPersona.sample_dialogues_out ?? [];

      // 6. Self-heal mismatched arrays before checking emptiness
      // This repairs corruption from the old array_remove() bug
      if (currentIn.length !== currentOut.length && currentIn.length > 0 && currentOut.length > 0) {
        const repaired = await repairMismatchedDialogues(
          selectedPersona.tomori_id,
          currentIn.length,
          currentOut.length,
        );
        if (repaired) {
          currentIn = repaired.repairedIn;
          currentOut = repaired.repairedOut;
          // Invalidate cache so subsequent operations see repaired data
          if (interaction.guildId) {
            invalidateTomoriStateCache(interaction.guildId);
          }
        }
      }

      // 7. Check if there are any dialogues to remove after potential repair
      if (currentIn.length === 0 || currentIn.length !== currentOut.length) {
        await updateButtonComponentsV2Status(
          personaSelectionInteraction,
          locale,
          "commands.forget.sampledialogue.no_dialogues_title",
          "commands.forget.sampledialogue.no_dialogues",
          ColorCode.WARN,
          undefined,
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      // 8. Create dialogue select options for the modal
      const dialogueSelectOptions: SelectOption[] = currentIn.map((input, index) => {
        const output = currentOut[index];
        const truncatedInput = safeSelectOptionText(input, 50);
        const truncatedOutput = safeSelectOptionText(output, 50);
        //const fullDisplay = `User: "${truncatedInput}" → Bot: "${truncatedOutput}"`;

        return {
          label: safeSelectOptionText(truncatedInput),
          value: index.toString(),
          description: safeSelectOptionText(truncatedOutput),
        };
      });

      // 9. Show the paginated modal with dialogue selection
      const modalResult = await promptWithPaginatedModal(personaSelectionInteraction, locale, {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.forget.sampledialogue.modal_title",
        components: [
          {
            customId: DIALOGUE_SELECT_ID,
            labelKey: "commands.forget.sampledialogue.select_label",
            descriptionKey: "commands.forget.sampledialogue.select_description",
            placeholder: "commands.forget.sampledialogue.select_placeholder",
            required: true,
            options: dialogueSelectOptions,
          },
        ],
      });

      // 10. Handle modal outcome - keep the persona picker loop alive when the modal closes
      if (modalResult.outcome !== "submit") {
        log.info(`Sample dialogue deletion modal ${modalResult.outcome} for user ${userData.user_id}`);
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      // 11. Extract values from the modal
      const modalSubmitInteraction = modalResult.interaction;
      const selectedIndexStr = modalResult.values?.[DIALOGUE_SELECT_ID];

      // Safety checks (should never be null after submit outcome)
      if (!modalSubmitInteraction || !selectedIndexStr) {
        log.error("Modal result unexpectedly missing interaction or values");
        return;
      }

      const selectedIndex = Number.parseInt(selectedIndexStr, 10);

      // 12. Perform the database update using the helper function - let helper manage interaction state
      const removalSucceeded = await performSampleDialogueRemoval(
        selectedPersona,
        selectedIndex,
        currentIn,
        currentOut,
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
        "commands.forget.sampledialogue.success_title",
        "commands.forget.sampledialogue.success_description",
        ColorCode.SUCCESS,
        {
          input:
            currentIn[selectedIndex].length > 50
              ? `${currentIn[selectedIndex].slice(0, 50)}...`
              : currentIn[selectedIndex],
          output:
            currentOut[selectedIndex].length > 50
              ? `${currentOut[selectedIndex].slice(0, 50)}...`
              : currentOut[selectedIndex],
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
        command: "forget sampledialogue",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Unexpected error in /forget sampledialogue for user ${userData.user_disc_id}`,
      error as Error,
      context,
    );

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
