import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags, TextInputStyle } from "discord.js";
import { sql } from "@/utils/db/client";
import {
  tomoriSchema, // Use tomoriSchema for validation
  type UserRow,
  type ErrorContext,
  type TomoriState,
} from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed, promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/interactionHelper";
import { isBlacklisted, loadAllPersonasForServer } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import type { ModalResult, SelectOption } from "@/types/discord/modal";
import { checkAttributeLimit, getMemoryLimits, validateAttribute } from "@/utils/db/memoryLimits";
import {
  dedupeCaseInsensitive,
  formatTextArrayLiteral,
  getNonEmptyNumberedLines,
  readTxtUpload,
} from "@/utils/teach/batchUploadUtils";

// Get memory limits from environment variables
const memoryLimits = getMemoryLimits();

// Rule 20: Constants (Modal IDs, Input IDs)
const MODAL_CUSTOM_ID = "teach_attribute_add_modal";
const PERSONA_SELECT_ID = "persona_select";
const ATTRIBUTE_INPUT_ID = "attribute_input";
const ATTRIBUTE_FILE_UPLOAD_ID = "attribute_file_upload";

// Rule 21: Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("add").setDescription(localizer("en-US", "commands.persona.attribute.add.description"));

/**
 * Rule 1: JSDoc comment for exported function
 * Adds a personality attribute to Tomori's memory for the server.
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
  // 1. Ensure command is run in a valid channel context (Rule 17)
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral, // Explicit flag needed before deferral
    });
    return;
  }

  // Define state and modal result outside try for catch block
  let tomoriState: TomoriState | null = null;
  let selectedPersona: TomoriState | null = null;
  let modalResult: ModalResult | null = null;

  try {
    // 2. Check if user has Manage Server permission - used for blacklist and teaching restriction bypass
    const hasManagePermission = interaction.memberPermissions?.has("ManageGuild") ?? false;

    // 3. Check blacklisting only for guild contexts
    // Users with Manage Server permission can bypass blacklist (they can unblacklist themselves anyway)
    if (interaction.guild) {
      const blacklisted = (await isBlacklisted(interaction.guild.id, interaction.user.id)) ?? false;
      if (blacklisted && !hasManagePermission) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.user_blacklisted_title",
          descriptionKey: "general.errors.user_blacklisted_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    // 4. Load server's Tomori state (Rule 17)
    tomoriState = await getCachedTomoriState(interaction.guild?.id ?? interaction.user.id);

    // 5. Check if Tomori is set up
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        // No flags needed due to deferReply
      });
      return;
    }

    // 6. Resolve target persona options
    const allPersonas = await loadAllPersonasForServer(interaction.guild?.id ?? interaction.user.id);
    const personaSelectOptions: SelectOption[] = allPersonas
      .filter((persona) => persona.tomori_id !== undefined)
      .map((persona) => ({
        label: safeSelectOptionText(persona.tomori_nickname),
        value: persona.tomori_id?.toString() ?? "",
        description: persona.is_alter
          ? localizer(locale, "commands.teach.attribute.alter_persona_description")
          : localizer(locale, "commands.teach.attribute.main_persona_description"),
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

    // 7. Check if attribute teaching is enabled and if user has bypass permissions
    if (!tomoriState.config.attribute_memteaching_enabled && !hasManagePermission) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.teach.attribute.teaching_disabled_title", // New locale key needed
        descriptionKey: "commands.teach.attribute.teaching_disabled_description", // New locale key needed
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 8. Prompt user with persona selector + attribute input
    // NOTE: Ensure locale keys resolve to strings <= 45 chars for labels!
    modalResult = await promptWithPaginatedModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.teach.attribute.modal_title",
      components: [
        {
          customId: PERSONA_SELECT_ID,
          labelKey: "commands.teach.attribute.persona_select_label",
          descriptionKey: "commands.teach.attribute.persona_select_description",
          placeholder: "commands.teach.attribute.persona_select_placeholder",
          required: true,
          options: personaSelectOptions,
        },
        {
          customId: ATTRIBUTE_INPUT_ID,
          labelKey: "commands.teach.attribute.attribute_input_label",
          descriptionKey: "commands.teach.attribute.attribute_input_description",
          placeholder: "commands.teach.attribute.attribute_input_placeholder",
          style: TextInputStyle.Paragraph,
          required: false,
          maxLength: memoryLimits.maxAttributeLength,
        },
        {
          customId: ATTRIBUTE_FILE_UPLOAD_ID,
          labelKey: "commands.teach.attribute.batch_file_label",
          descriptionKey: "commands.teach.attribute.batch_file_description",
          minValues: 0,
          maxValues: 1,
          required: false,
        },
      ],
    });

    // 9. Handle modal outcome
    if (modalResult.outcome !== "submit") {
      log.info(`Attribute add modal ${modalResult.outcome} for user ${userData.user_id}`);
      // promptWithRawModal handles cancel/timeout replies
      return;
    }

    // Capture the ModalSubmitInteraction
    // biome-ignore lint/style/noNonNullAssertion: Outcome 'submit' guarantees interaction
    const modalSubmitInteraction = modalResult.interaction!;

    // 10. Resolve selected persona + attribute input
    // biome-ignore lint/style/noNonNullAssertion: Outcome 'submit' + required persona select guarantees value
    const selectedPersonaId = modalResult.values![PERSONA_SELECT_ID];
    selectedPersona = allPersonas.find((persona) => persona.tomori_id?.toString() === selectedPersonaId) ?? null;
    if (!selectedPersona?.tomori_id) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const typedAttribute = modalResult.values?.[ATTRIBUTE_INPUT_ID]?.trim() ?? "";
    const uploadedTextFile = modalResult.attachments?.[ATTRIBUTE_FILE_UPLOAD_ID];
    const pendingAttributes: string[] = [];

    if (typedAttribute) {
      pendingAttributes.push(typedAttribute);
    }

    if (uploadedTextFile) {
      const uploadResult = await readTxtUpload(uploadedTextFile);
      if (!uploadResult.isValid || !uploadResult.text) {
        const errorKey =
          uploadResult.error === "invalid_format"
            ? "commands.teach.attribute.invalid_file_description"
            : uploadResult.error === "file_too_large"
              ? "commands.teach.attribute.file_too_large_description"
              : "commands.teach.attribute.download_failed_description";

        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.teach.attribute.invalid_file_title",
          descriptionKey: errorKey,
          descriptionVars: {
            max_size: "1",
          },
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const importedAttributes = getNonEmptyNumberedLines(uploadResult.text).map((line) => line.content);
      pendingAttributes.push(...importedAttributes);
    }

    if (pendingAttributes.length === 0) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.teach.attribute.no_input_title",
        descriptionKey: "commands.teach.attribute.no_input_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const dedupedAttributes = dedupeCaseInsensitive(pendingAttributes);

    // 11. Validate each attribute length
    for (const attribute of dedupedAttributes) {
      const attributeValidation = validateAttribute(attribute);
      if (!attributeValidation.isValid) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.teach.attribute.content_too_long_title",
          descriptionKey: "commands.teach.attribute.content_too_long_description",
          descriptionVars: {
            current_length: attribute.length.toString(),
            max_allowed: (attributeValidation.maxAllowed || memoryLimits.maxAttributeLength).toString(),
          },
          color: ColorCode.ERROR,
        });
        return;
      }
    }

    // 12. Prepare updated array from selected persona
    const currentAttributes = selectedPersona.attribute_list || [];
    const existingAttributes = new Set(currentAttributes.map((attribute) => attribute.trim().toLowerCase()));
    const attributesToAdd = dedupedAttributes.filter((attribute) => !existingAttributes.has(attribute.toLowerCase()));

    // 13. Check for duplicates before adding
    if (attributesToAdd.length === 0) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.teach.attribute.duplicate_title",
        descriptionKey: "commands.teach.attribute.duplicate_description",
        descriptionVars: { attribute: dedupedAttributes[0] ?? typedAttribute },
        color: ColorCode.WARN,
      });
      return;
    }

    // 13.5 Check limit against final import size
    const attributeLimitCheck = await checkAttributeLimit(selectedPersona.tomori_id);
    const currentCount = attributeLimitCheck.currentCount ?? currentAttributes.length;
    const maxAllowed = attributeLimitCheck.maxAllowed ?? memoryLimits.maxAttributes;
    const availableSlots = Math.max(0, maxAllowed - currentCount);

    if (attributesToAdd.length > availableSlots) {
      const removeCount = attributesToAdd.length - availableSlots;
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: uploadedTextFile
          ? "commands.teach.attribute.batch_limit_exceeded_title"
          : "commands.teach.attribute.limit_exceeded_title",
        descriptionKey: uploadedTextFile
          ? "commands.teach.attribute.batch_limit_exceeded_description"
          : "commands.teach.attribute.limit_exceeded_description",
        descriptionVars: uploadedTextFile
          ? {
              current_count: currentCount.toString(),
              max_allowed: maxAllowed.toString(),
              import_count: attributesToAdd.length.toString(),
              remove_count: removeCount.toString(),
            }
          : {
              current_count: currentCount.toString(),
              max_allowed: maxAllowed.toString(),
            },
        color: ColorCode.ERROR,
      });
      return;
    }

    // 14. Update target persona row in the database
    const [updatedTomoriResult] =
      attributesToAdd.length === 1
        ? await sql`
					UPDATE tomoris
					SET attribute_list = array_append(attribute_list, ${attributesToAdd[0]})
					WHERE tomori_id = ${selectedPersona.tomori_id}
					RETURNING *
				`
        : await sql`
					UPDATE tomoris
					SET attribute_list = array_cat(attribute_list, ${formatTextArrayLiteral(attributesToAdd)}::text[])
					WHERE tomori_id = ${selectedPersona.tomori_id}
					RETURNING *
				`;

    // 15. Validate the result from the database (Rule 3, 5, 6)
    const validationResult = tomoriSchema.safeParse(updatedTomoriResult);

    if (!validationResult.success) {
      // Rule 22: Log error with context
      const context: ErrorContext = {
        userId: userData.user_id,
        serverId: tomoriState.server_id,
        tomoriId: selectedPersona.tomori_id,
        errorType: "DatabaseValidationError",
        metadata: {
          command: "teach attribute",
          userDiscordId: interaction.user.id, // Keep Discord ID for easier user lookup
          newAttribute: attributesToAdd.join("\n"),
          validationErrors: validationResult.error.issues,
        },
      };
      await log.error("Failed to validate updated tomori data after adding attribute", validationResult.error, context);

      // Use modal interaction for reply
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
        // No flags needed
      });
      return;
    }

    // 16. Invalidate cache so next message gets fresh config
    invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

    // 17. Success! Confirm addition (Rule 12, 19)
    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey:
        attributesToAdd.length > 1 || uploadedTextFile
          ? "commands.teach.attribute.batch_success_title"
          : "commands.teach.attribute.success_title",
      descriptionKey:
        attributesToAdd.length > 1 || uploadedTextFile
          ? "commands.teach.attribute.batch_success_description"
          : "commands.teach.attribute.success_description",
      descriptionVars:
        attributesToAdd.length > 1 || uploadedTextFile
          ? {
              added_count: attributesToAdd.length.toString(),
            }
          : {
              attribute: attributesToAdd[0],
            },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    // Rule 22: Log error with context
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id, // Use optional chaining as tomoriState might be null if error happened early
      tomoriId: tomoriState?.tomori_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "teach attribute",
        userDiscordId: interaction.user.id,
        guildId: interaction.guild?.id,
      },
    };
    await log.error("Error in /teach attribute command", error, context);

    // Rule 12, 19: Reply with unknown error embed
    // Determine which interaction to use
    const errorReplyInteraction =
      modalResult?.interaction ?? // Prefer modal interaction
      (interaction.replied || interaction.deferred ? interaction : null); // Fallback

    if (errorReplyInteraction) {
      await replyInfoEmbed(errorReplyInteraction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        // No flags needed
      });
    } else {
      log.warn(
        "Interaction was not replied or deferred in attribute catch block, cannot send error message to user.",
        context,
      );
    }
  }
}
