import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags, TextInputStyle } from "discord.js";
import type { UserRow, ErrorContext, TomoriState } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { personaRepository, userRepository } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import type { ModalResult, SelectOption } from "@/types/discord/modal";
import { getMemoryLimits, validateAttribute } from "@/utils/misc/memoryLimits";

import { dedupeCaseInsensitive, getNonEmptyNumberedLines, readTxtUpload } from "@/utils/teach/batchUploadUtils";

const memoryLimits = getMemoryLimits();

const MODAL_CUSTOM_ID = "teach_attribute_add_modal";
const PERSONA_SELECT_ID = "persona_select";
const ATTRIBUTE_INPUT_ID = "attribute_input";
const ATTRIBUTE_FILE_UPLOAD_ID = "attribute_file_upload";
const ATTRIBUTE_PUBLIC_ID = "attribute_public";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("add").setDescription(localizer("en-US", "commands.persona.attribute.add.description"));

/**
 * JSDoc comment for exported function
 * Adds a personality attribute to Tomori's memory for the server.
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // Ensure command is run in a valid channel context
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral, // Explicit flag needed before deferral
    });
    return;
  }

  let tomoriState: TomoriState | null = null;
  let selectedPersona: TomoriState | null = null;
  let modalResult: ModalResult | null = null;

  try {
    const hasManagePermission = interaction.memberPermissions?.has("ManageGuild") ?? false;

    // Check blacklisting only for guild contexts
    // Users with Manage Server permission can bypass blacklist (they can unblacklist themselves anyway)
    if (interaction.guild) {
      const blacklisted = (await userRepository.isBlacklisted(interaction.guild.id, interaction.user.id)) ?? false;
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

    tomoriState = await getCachedTomoriState(interaction.guild?.id ?? interaction.user.id);

    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        // No flags needed due to deferReply
      });
      return;
    }

    const allPersonas = await personaRepository.loadAllForServer(interaction.guild?.id ?? interaction.user.id);
    const personaSelectOptions: SelectOption[] = allPersonas
      .filter((persona) => persona.persona_id !== undefined)
      .map((persona) => ({
        label: safeSelectOptionText(persona.persona_nickname),
        value: persona.persona_id?.toString() ?? "",
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

    if (!tomoriState.config.attribute_memteaching_enabled && !hasManagePermission) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.teach.attribute.teaching_disabled_title", // New locale key needed
        descriptionKey: "commands.teach.attribute.teaching_disabled_description", // New locale key needed
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Prompt user with persona selector + attribute input
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
        {
          kind: "checkbox",
          customId: ATTRIBUTE_PUBLIC_ID,
          labelKey: "commands.teach.attribute.public_checkbox_label",
          descriptionKey: "commands.teach.attribute.public_checkbox_description",
          default: false,
        },
      ],
    });

    if (modalResult.outcome !== "submit") {
      log.info(`Attribute add modal ${modalResult.outcome} for user ${userData.user_id}`);
      return;
    }

    // biome-ignore lint/style/noNonNullAssertion: Outcome 'submit' guarantees interaction
    const modalSubmitInteraction = modalResult.interaction!;

    // biome-ignore lint/style/noNonNullAssertion: Outcome 'submit' + required persona select guarantees value
    const selectedPersonaId = modalResult.values![PERSONA_SELECT_ID];
    selectedPersona = allPersonas.find((persona) => persona.persona_id?.toString() === selectedPersonaId) ?? null;
    if (!selectedPersona?.persona_id) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const typedAttribute = modalResult.values?.[ATTRIBUTE_INPUT_ID]?.trim() ?? "";
    const isPublicAttribute = modalResult.values?.[ATTRIBUTE_PUBLIC_ID] === "true";
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

    const currentAttributes = selectedPersona.attribute_list || [];
    const existingAttributes = new Set(currentAttributes.map((attribute) => attribute.trim().toLowerCase()));
    const attributesToAdd = dedupedAttributes.filter((attribute) => !existingAttributes.has(attribute.toLowerCase()));

    if (attributesToAdd.length === 0) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.teach.attribute.duplicate_title",
        descriptionKey: "commands.teach.attribute.duplicate_description",
        descriptionVars: { attribute: dedupedAttributes[0] ?? typedAttribute },
        color: ColorCode.WARN,
      });
      return;
    }

    const attributeLimitCheck = await personaRepository.checkAttributeLimit(selectedPersona.persona_id);
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

    const ok = await personaRepository.addAttributes(selectedPersona.persona_id, attributesToAdd, isPublicAttribute);

    if (!ok) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Invalidate cache so next message gets fresh config
    invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

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
              visibility: localizer(
                locale,
                isPublicAttribute
                  ? "commands.teach.attribute.visibility_public"
                  : "commands.teach.attribute.visibility_private",
              ),
            }
          : {
              attribute: attributesToAdd[0],
              visibility: localizer(
                locale,
                isPublicAttribute
                  ? "commands.teach.attribute.visibility_public"
                  : "commands.teach.attribute.visibility_private",
              ),
            },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id, // Use optional chaining as tomoriState might be null if error happened early
      personaId: tomoriState?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "teach attribute",
        userDiscordId: interaction.user.id,
        guildId: interaction.guild?.id,
      },
    };
    await log.error("Error in /teach attribute command", error, context);

    const errorReplyInteraction =
      modalResult?.interaction ?? // Prefer modal interaction
      (interaction.replied || interaction.deferred ? interaction : null); // Fallback

    if (errorReplyInteraction) {
      await replyInfoEmbed(errorReplyInteraction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
    } else {
      log.warn(
        "Interaction was not replied or deferred in attribute catch block, cannot send error message to user.",
        context,
      );
    }
  }
}
