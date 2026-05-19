import {
  MessageFlags,
  PermissionsBitField,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { invalidateTomoriStateCache } from "../../utils/cache/tomoriStateCache";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed, promptWithPaginatedModal, safeSelectOptionText } from "../../utils/discord/interactionHelper";
import type { UserRow, ErrorContext, TomoriState } from "../../types/db/schema";
import type { ModalResult, SelectOption } from "../../types/discord/modal";
import { personaRepository } from "@/utils/db/repositories";
import { sql } from "@/utils/db/client";

// Constants for validation
const NICKNAME_MIN_LENGTH = 2;
const NICKNAME_MAX_LENGTH = 32;
const MODAL_CUSTOM_ID = "config_rename_modal";
const PERSONA_SELECT_ID = "persona_select";
const NEW_NAME_INPUT_ID = "new_name_input";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505"
  );
}

// Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("rename").setDescription(localizer("en-US", "commands.persona.rename.description"));

/**
 * Changes what Tomori refers to herself in context and in chat.
 * Also adds the new nickname to her trigger words if not already present.
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
  if (interaction.guild && !interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.persona.rename.no_permission_title",
      descriptionKey: "commands.persona.rename.no_permission_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const serverDiscId = interaction.guild?.id ?? interaction.user.id;
  let modalResult: ModalResult | null = null;
  let modalSubmitInteraction: ModalSubmitInteraction | null = null;
  let selectedPersona: TomoriState | null = null;
  let attemptedNickname: string | null = null;

  // 1. Ensure command is run in a channel
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    // 2. Resolve all personas for selector
    const allPersonas = await personaRepository.loadAllForServer(serverDiscId);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const personaSelectOptions: SelectOption[] = allPersonas
      .filter((persona) => persona.persona_id !== undefined)
      .map((persona) => ({
        label: safeSelectOptionText(persona.persona_nickname),
        value: persona.persona_id?.toString() ?? "",
        description: persona.is_alter
          ? localizer(locale, "commands.persona.rename.alter_persona_description")
          : localizer(locale, "commands.persona.rename.main_persona_description"),
      }))
      .filter((option) => option.value !== "");
    if (personaSelectOptions.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 3. Show modal (persona select + new name)
    modalResult = await promptWithPaginatedModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.persona.rename.modal_title",
      components: [
        {
          customId: PERSONA_SELECT_ID,
          labelKey: "commands.persona.rename.persona_select_label",
          descriptionKey: "commands.persona.rename.persona_select_description",
          placeholder: "commands.persona.rename.persona_select_placeholder",
          required: true,
          options: personaSelectOptions,
        },
        {
          customId: NEW_NAME_INPUT_ID,
          labelKey: "commands.persona.rename.new_name_input_label",
          descriptionKey: "commands.persona.rename.new_name_input_description",
          placeholder: "commands.persona.rename.new_name_input_placeholder",
          style: TextInputStyle.Short,
          required: true,
          minLength: NICKNAME_MIN_LENGTH,
          maxLength: NICKNAME_MAX_LENGTH,
        },
      ],
    });
    if (modalResult.outcome !== "submit") {
      log.info(`Rename modal ${modalResult.outcome} for user ${interaction.user.id}`);
      return;
    }

    // biome-ignore lint/style/noNonNullAssertion: Modal submit outcome guarantees interaction exists
    modalSubmitInteraction = modalResult.interaction!;
    if (!modalSubmitInteraction.deferred && !modalSubmitInteraction.replied) {
      await modalSubmitInteraction.deferReply({
        flags: MessageFlags.Ephemeral,
      });
    }
    const selectedPersonaId = modalResult.values?.[PERSONA_SELECT_ID];
    attemptedNickname = modalResult.values?.[NEW_NAME_INPUT_ID] ?? "";
    const newNickname = attemptedNickname.trim();

    selectedPersona = allPersonas.find((persona) => persona.persona_id?.toString() === selectedPersonaId) ?? null;
    if (!selectedPersona?.persona_id) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 4. Validate nickname length
    if (newNickname.length < NICKNAME_MIN_LENGTH || newNickname.length > NICKNAME_MAX_LENGTH) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.persona.rename.invalid_length_title",
        descriptionKey: "commands.persona.rename.invalid_length",
        descriptionVars: {
          min: NICKNAME_MIN_LENGTH.toString(),
          max: NICKNAME_MAX_LENGTH.toString(),
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    // 5. Store the old nickname for the success message
    const oldNickname = selectedPersona.persona_nickname;

    // 6. Check if the nickname is actually changing
    if (newNickname === oldNickname) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.persona.rename.already_set_title",
        descriptionKey: "commands.persona.rename.already_set_description",
        descriptionVars: {
          nickname: newNickname,
        },
        color: ColorCode.WARN,
      });
      return;
    }

    const duplicateNameRows = await sql<Array<{ persona_id: number }>>`
			SELECT persona_id
			FROM personas
			WHERE server_id = ${selectedPersona.server_id}
			  AND persona_id <> ${selectedPersona.persona_id}
			  AND lower(btrim(persona_nickname)) = lower(btrim(${newNickname}))
			LIMIT 1
		`;
    if (duplicateNameRows.length > 0) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.persona.name_conflict_title",
        descriptionKey: "commands.persona.name_conflict_description",
        descriptionVars: { name: newNickname },
        color: ColorCode.ERROR,
      });
      return;
    }

    // 7. Update the nickname in the `personas` table
    const renamed = await personaRepository.renamePersona(selectedPersona.persona_id, newNickname);

    if (!renamed) {
      // Log error specific to personas update failure
      const context: ErrorContext = {
        personaId: selectedPersona.persona_id,
        serverId: selectedPersona.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "config rename",
          table: "personas",
          guildId: serverDiscId,
          newNickname,
        },
      };
      await log.error(
        "Failed to update persona_nickname in personas table",
        new Error("Database update returned no rows"),
        context,
      );

      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return; // Stop if the primary update failed
    }

    // 9. Add new nickname to trigger words if not already present
    const currentTriggers = selectedPersona.trigger_words ?? [];
    let triggerUpdateNeeded = false;

    // Case-insensitive check if the nickname exists
    if (!currentTriggers.some((trigger) => trigger.toLowerCase() === newNickname.toLowerCase())) {
      triggerUpdateNeeded = true;
      log.info(`Adding new nickname '${newNickname}' to trigger words for tomori ${selectedPersona.persona_id}`);
    } else {
      log.info(
        `Nickname '${newNickname}' already exists in trigger words for tomori ${selectedPersona.persona_id}. Skipping update.`,
      );
    }

    // 10. Update trigger_words in `persona_configs` if needed
    if (triggerUpdateNeeded) {
      const triggerAdded = await personaRepository.addTrigger(selectedPersona.persona_id, [newNickname]);

      if (!triggerAdded) {
        // Log error specific to persona_configs update failure
        const context: ErrorContext = {
          personaId: selectedPersona.persona_id,
          serverId: selectedPersona.server_id,
          userId: userData.user_id,
          errorType: "DatabaseUpdateError",
          metadata: {
            command: "config rename",
            table: "persona_configs",
            column: "trigger_words",
            guildId: serverDiscId,
            newNickname,
          },
        };
        // Log this as a warning since the primary nickname update succeeded,
        // but inform the user of the partial failure.
        await log.error(
          "Failed to update trigger_words in persona_configs table",
          new Error("Database update returned no rows"),
          context,
        );

        // Inform user about partial success
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.persona.rename.partial_success_title",
          descriptionKey: "commands.persona.rename.partial_success_description",
          descriptionVars: {
            old_nickname: oldNickname,
            new_nickname: newNickname,
          },
          color: ColorCode.WARN, // Use WARN for partial success
        });
        return; // Stop execution after informing about partial success
      }
      log.success(`Successfully updated trigger words for tomori ${selectedPersona.persona_id}`);
    }

    // 12. Update bot's server nickname only when renaming the main persona
    let nicknameUpdateSuccess = false;
    const attemptedGuildNicknameSync = Boolean(interaction.guild) && selectedPersona.is_alter !== true;
    if (attemptedGuildNicknameSync && interaction.guild) {
      try {
        const botMember = await interaction.guild.members.fetchMe();
        if (botMember) {
          await botMember.setNickname(newNickname);
          nicknameUpdateSuccess = true;
          log.success(`Successfully updated bot nickname to '${newNickname}' in guild ${interaction.guild.id}`);
        }
      } catch (nicknameError) {
        // Log the error but don't fail the entire command
        await log.warn(
          `Failed to update bot's server nickname in guild ${interaction.guild.id} (permissions issue or API error): ${(nicknameError as Error).message}`,
        );
      }
    }

    // 13. Invalidate cache so next message gets fresh config
    invalidateTomoriStateCache(serverDiscId);

    // 14. Success! Show the nickname change
    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.persona.rename.success_title",
      descriptionKey: nicknameUpdateSuccess
        ? triggerUpdateNeeded
          ? "commands.persona.rename.success_with_trigger_and_discord_description"
          : "commands.persona.rename.success_with_discord_description"
        : triggerUpdateNeeded
          ? "commands.persona.rename.success_with_trigger_description"
          : "commands.persona.rename.success_description",
      descriptionVars: {
        old_nickname: oldNickname,
        new_nickname: newNickname,
      },
      color: ColorCode.SUCCESS,
      footerKey:
        attemptedGuildNicknameSync && !nicknameUpdateSuccess
          ? "commands.persona.rename.nickname_update_failed_footer"
          : undefined,
    });
  } catch (error) {
    const errorReplyInteraction = modalSubmitInteraction ?? interaction;

    if (isUniqueViolation(error)) {
      await replyInfoEmbed(errorReplyInteraction, locale, {
        titleKey: "commands.persona.name_conflict_title",
        descriptionKey: "commands.persona.name_conflict_description",
        descriptionVars: {
          name: attemptedNickname?.trim() ?? modalResult?.values?.[NEW_NAME_INPUT_ID] ?? "",
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    // 15. Log error with context
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: selectedPersona?.server_id ?? null,
      personaId: selectedPersona?.persona_id ?? null,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config rename",
        guildId: serverDiscId,
        executorDiscordId: interaction.user.id,
        selectedPersonaId: selectedPersona?.persona_id ?? null,
        nicknameAttempted: attemptedNickname,
      },
    };
    await log.error(`Error executing /config rename for user ${userData.user_disc_id}`, error as Error, context);

    // 16. Inform user of unknown error
    await replyInfoEmbed(errorReplyInteraction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
