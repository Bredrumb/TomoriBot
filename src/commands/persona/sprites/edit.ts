import {
  MessageFlags,
  PermissionsBitField,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ErrorContext, PersonaSpriteRow, TomoriState, UserRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { personaRepository, personaSpriteRepository } from "@/utils/db/repositories";
import { promptWithUnacknowledgedConfirmation } from "@/utils/discord/ui/confirmation";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import {
  acknowledgeModalSubmitForRefresh,
  promptWithPaginatedModal,
  promptWithRawModal,
  safeSelectOptionText,
} from "@/utils/discord/ui/modals";
import { type AvatarSessionCache, replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { replyComponentsV2Status, updateButtonComponentsV2Status } from "@/utils/discord/ui/statusComponents";
import { convertToPNG } from "@/utils/image/imageProcessor";
import { ColorCode, log } from "@/utils/misc/logger";
import {
  isPersonaSpriteInstructionsTooLong,
  normalizePersonaSpriteInstructions,
  PERSONA_SPRITE_LIMITS,
  validatePersonaSpriteName,
} from "@/utils/persona/sprites";
import {
  downloadPersonaSpriteImageAttachment,
  validatePersonaSpriteImageAttachment,
} from "@/utils/persona/spriteImages";
import { memoryGuard, PERSONA_LIMITS, reserveAvatarQuota } from "@/utils/security/rateLimiter";
import { deletePersonaSpriteFromStorage, uploadPersonaSpriteToStorage } from "@/utils/storage/avatarStorage";
import { localizer } from "@/utils/text/localizer";
import { forkPointerForAvatarChange } from "../avatar";

const SELECT_MODAL_CUSTOM_ID = "persona_sprites_edit_select_modal";
const EDIT_MODAL_CUSTOM_ID = "persona_sprites_edit_value_modal";
const SPRITE_SELECT_ID = "sprite_select";
const SPRITE_NAME_INPUT_ID = "sprite_name_input";
const SPRITE_IMAGE_UPLOAD_ID = "sprite_image_upload";
const SPRITE_INSTRUCTIONS_INPUT_ID = "sprite_usage_instructions";
const SPRITE_IDENTITY_CHECKBOX_ID = "sprite_save_as_identity";

/** Sprite row guaranteed to carry a numeric primary key (filtered before use). */
type SpriteWithId = PersonaSpriteRow & { sprite_id: number };

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("edit").setDescription(localizer("en-US", "commands.persona.sprites.edit.description"));

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

  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.persona.sprites.add.no_permission_title",
      descriptionKey: "commands.persona.sprites.add.no_permission_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let selectedPersona: TomoriState | null = null;
  let personaSelectionInteraction: ButtonInteraction | null = null;

  try {
    let allPersonas = await personaRepository.loadAllForServer(interaction.guild.id);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 1. Persona picker → sprite picker → edit loop. Editing one sprite returns
    //    to the persona picker so several sprites can be edited in one run.
    const avatarSessionCache: AvatarSessionCache = new Map();
    while (true) {
      const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
        personas: allPersonas,
        avatarSessionCache,
        color: ColorCode.INFO,
        preserveSelectedInteraction: true,
        titleKey: "commands.persona.sprites.edit.persona_select_title",
        onSelect: async () => {},
      });

      if (!personaSelection.success || personaSelection.selectedIndex === undefined || !personaSelection.interaction) {
        return;
      }

      personaSelectionInteraction = personaSelection.interaction;
      selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;
      if (!selectedPersona?.persona_id) {
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
      const personaId = selectedPersona.persona_id;

      // 2. Load the persona's sprites. Reuse the picker message to report an empty
      //    list and reloop instead of ending the command.
      const sprites = (await personaSpriteRepository.listForPersona(personaId)).filter(
        (sprite): sprite is SpriteWithId => typeof sprite.sprite_id === "number",
      );
      if (sprites.length === 0) {
        await updateButtonComponentsV2Status(
          personaSelectionInteraction,
          locale,
          "commands.persona.sprites.edit.no_sprites_title",
          "commands.persona.sprites.edit.no_sprites_description",
          ColorCode.WARN,
          { persona_name: selectedPersona.persona_nickname },
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      // 3. Choose which sprite to edit. promptWithPaginatedModal splits the select
      //    across pages automatically when a persona has more than 25 sprites.
      // Identify sprites by their lookup key (stable across a pointer→materialized
      // fork) rather than sprite_id, which is reassigned when preset sprites are
      // copied into persona_sprites on the fork.
      const spriteSelectOptions: SelectOption[] = sprites.map((sprite) => ({
        label: safeSelectOptionText(sprite.sprite_name, 100),
        value: sprite.sprite_key,
        description: safeSelectOptionText(formatSpriteOptionDescription(sprite, locale), 100),
      }));

      const selectModalResult = await promptWithPaginatedModal(personaSelectionInteraction, locale, {
        modalCustomId: SELECT_MODAL_CUSTOM_ID,
        modalTitleKey: "commands.persona.sprites.edit.select_modal_title",
        components: [
          {
            customId: SPRITE_SELECT_ID,
            labelKey: "commands.persona.sprites.edit.select_label",
            descriptionKey: "commands.persona.sprites.edit.select_description",
            placeholder: "commands.persona.sprites.edit.select_placeholder",
            required: true,
            options: spriteSelectOptions,
          },
        ],
      });

      if (selectModalResult.outcome !== "submit") {
        log.info(`Sprite edit selection modal ${selectModalResult.outcome} for user ${userData.user_id}`);
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      const selectModalInteraction = selectModalResult.interaction;
      const selectedSpriteKeyRaw = selectModalResult.values?.[SPRITE_SELECT_ID];
      if (!selectModalInteraction || !selectedSpriteKeyRaw) {
        log.error("Sprite edit selection unexpectedly missing interaction or values");
        return;
      }

      const selectedSprite = sprites.find((sprite) => sprite.sprite_key === selectedSpriteKeyRaw);
      if (!selectedSprite) {
        await replyInfoEmbed(selectModalInteraction, locale, {
          titleKey: "general.errors.operation_failed_title",
          descriptionKey: "general.errors.operation_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      // 4. A modal-submit interaction cannot open another modal, so bridge through
      //    a confirmation button. It also previews the sprite's current state.
      await acknowledgeModalSubmitForRefresh(selectModalInteraction);

      const confirmationResult = await promptWithUnacknowledgedConfirmation(interaction, locale, {
        embedTitleKey: "commands.persona.sprites.edit.confirm_title",
        embedDescriptionKey: "commands.persona.sprites.edit.confirm_description",
        embedDescriptionVars: {
          sprite_name: selectedSprite.sprite_name,
          identity_status: formatIdentityStatus(selectedSprite.is_identity, locale),
          instructions:
            selectedSprite.usage_instructions.trim() ||
            localizer(locale, "commands.persona.sprites.remove.default_usage_description"),
        },
        embedColor: ColorCode.INFO,
        useComponentsV2: true,
        continueLabelKey: "general.confirm",
        cancelLabelKey: "general.pagination.cancel",
        continueCustomId: `persona_sprites_edit_confirm_${selectModalInteraction.id}`,
        cancelCustomId: `persona_sprites_edit_cancel_${selectModalInteraction.id}`,
      });

      if (confirmationResult.outcome !== "continue" || !confirmationResult.interaction) {
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      // 5. Edit modal, prefilled with the current values. Image upload is optional:
      //    metadata-only edits stay quota-free, while image replacements consume the
      //    same shared avatar quota as /persona sprites add.
      const editModalResult = await promptWithRawModal(confirmationResult.interaction, locale, {
        modalCustomId: EDIT_MODAL_CUSTOM_ID,
        modalTitleKey: "commands.persona.sprites.edit.modal_title",
        components: [
          {
            customId: SPRITE_NAME_INPUT_ID,
            labelKey: "commands.persona.sprites.add.sprite_name_label",
            descriptionKey: "commands.persona.sprites.add.sprite_name_description",
            placeholder: "commands.persona.sprites.add.sprite_name_placeholder",
            style: TextInputStyle.Short,
            required: true,
            minLength: 1,
            maxLength: PERSONA_SPRITE_LIMITS.MAX_NAME_LENGTH,
            value: selectedSprite.sprite_name,
          },
          {
            customId: SPRITE_IMAGE_UPLOAD_ID,
            labelKey: "commands.persona.sprites.edit.image_label",
            descriptionKey: "commands.persona.sprites.edit.image_description",
            minValues: 0,
            maxValues: 1,
            required: false,
          },
          {
            customId: SPRITE_INSTRUCTIONS_INPUT_ID,
            labelKey: "commands.persona.sprites.add.instructions_label",
            descriptionKey: "commands.persona.sprites.add.instructions_description",
            placeholder: "commands.persona.sprites.add.instructions_placeholder",
            style: TextInputStyle.Paragraph,
            required: false,
            maxLength: PERSONA_SPRITE_LIMITS.MAX_INSTRUCTIONS_LENGTH,
            value: selectedSprite.usage_instructions.trim() || undefined,
          },
          {
            kind: "checkbox",
            customId: SPRITE_IDENTITY_CHECKBOX_ID,
            labelKey: "commands.persona.sprites.add.identity_label",
            descriptionKey: "commands.persona.sprites.add.identity_description",
            default: selectedSprite.is_identity,
          },
        ],
      });

      if (editModalResult.outcome !== "submit" || !editModalResult.interaction) {
        log.info(`Sprite edit modal ${editModalResult.outcome} for user ${userData.user_id}`);
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }
      const editModalInteraction = editModalResult.interaction;

      // 6. Validate the new name (and its derived lookup key).
      const nameValidation = validatePersonaSpriteName(editModalResult.values?.[SPRITE_NAME_INPUT_ID] ?? "");
      if (!nameValidation.ok) {
        await replyInfoEmbed(editModalInteraction, locale, {
          titleKey: "commands.persona.sprites.add.invalid_name_title",
          descriptionKey: `commands.persona.sprites.add.invalid_name_${nameValidation.reason}`,
          descriptionVars: {
            max_length: PERSONA_SPRITE_LIMITS.MAX_NAME_LENGTH.toString(),
          },
          color: ColorCode.ERROR,
        });
        continue;
      }

      const usageInstructions = normalizePersonaSpriteInstructions(
        editModalResult.values?.[SPRITE_INSTRUCTIONS_INPUT_ID],
      );
      if (isPersonaSpriteInstructionsTooLong(usageInstructions)) {
        await replyInfoEmbed(editModalInteraction, locale, {
          titleKey: "commands.persona.sprites.add.instructions_too_long_title",
          descriptionKey: "commands.persona.sprites.add.instructions_too_long_description",
          descriptionVars: {
            max_length: PERSONA_SPRITE_LIMITS.MAX_INSTRUCTIONS_LENGTH.toString(),
          },
          color: ColorCode.ERROR,
        });
        continue;
      }

      const saveAsIdentity = editModalResult.values?.[SPRITE_IDENTITY_CHECKBOX_ID] === "true";
      const imageAttachment = editModalResult.attachments?.[SPRITE_IMAGE_UPLOAD_ID];
      if (imageAttachment) {
        const imageValidation = validatePersonaSpriteImageAttachment(imageAttachment);
        if (!imageValidation.ok) {
          await replyInfoEmbed(editModalInteraction, locale, {
            titleKey: "commands.persona.sprites.add.invalid_image_title",
            descriptionKey:
              imageValidation.reason === "file_too_large"
                ? "commands.persona.sprites.add.file_too_large_description"
                : "commands.persona.sprites.add.invalid_format_description",
            descriptionVars: {
              max_size: PERSONA_LIMITS.MAX_AVATAR_SIZE_MB.toString(),
            },
            color: ColorCode.ERROR,
          });
          continue;
        }
      }

      // 7. Renaming changes the sprite_key; reject a key already owned by a
      //    different sprite on this persona (the unique constraint would block it).
      const duplicateKey = sprites.some(
        (sprite) => sprite.sprite_key !== selectedSprite.sprite_key && sprite.sprite_key === nameValidation.spriteKey,
      );
      if (duplicateKey) {
        await replyInfoEmbed(editModalInteraction, locale, {
          titleKey: "commands.persona.sprites.edit.duplicate_title",
          descriptionKey: "commands.persona.sprites.edit.duplicate_description",
          descriptionVars: {
            sprite_name: nameValidation.displayName,
          },
          color: ColorCode.WARN,
        });
        continue;
      }

      // 8. Short-circuit when nothing actually changed.
      const nameUnchanged = nameValidation.displayName === selectedSprite.sprite_name;
      const instructionsUnchanged = usageInstructions === selectedSprite.usage_instructions.trim();
      const identityUnchanged = saveAsIdentity === selectedSprite.is_identity;
      const imageUnchanged = !imageAttachment;
      if (nameUnchanged && instructionsUnchanged && identityUnchanged && imageUnchanged) {
        await replyInfoEmbed(editModalInteraction, locale, {
          titleKey: "commands.persona.sprites.edit.no_changes_title",
          descriptionKey: "commands.persona.sprites.edit.no_changes_description",
          color: ColorCode.WARN,
        });
        continue;
      }

      let imageEditDeferred = false;
      let uploadedReference: string | null = null;
      if (imageAttachment) {
        if (!editModalInteraction.deferred && !editModalInteraction.replied) {
          await editModalInteraction.deferReply({ flags: MessageFlags.Ephemeral });
          imageEditDeferred = true;
        }

        const memoryCheck = memoryGuard.checkMemory();
        if (memoryCheck.status === "critical") {
          await replyInfoEmbed(editModalInteraction, locale, {
            titleKey: "rate_limit.error_memory_critical_title",
            descriptionKey: "rate_limit.error_memory_critical_description",
            color: ColorCode.ERROR,
          });
          continue;
        }

        const quotaReserve = reserveAvatarQuota(interaction.guild.id);
        if (!quotaReserve.allowed) {
          const resetTime = quotaReserve.resetAt
            ? new Date(quotaReserve.resetAt).toLocaleString(locale)
            : localizer(locale, "general.unknown");
          await replyInfoEmbed(editModalInteraction, locale, {
            titleKey: "rate_limit.error_quota_exceeded_title",
            descriptionKey: "rate_limit.error_quota_exceeded_description",
            descriptionVars: {
              reset_time: resetTime,
            },
            color: ColorCode.ERROR,
          });
          continue;
        }
      }

      // 9. Materialize pointer personas before persisting persona-specific data,
      //    mirroring add/remove (idempotent for already-forked personas).
      const wasPointer = selectedPersona.is_pointer === true;
      const pointerForked = await forkPointerForAvatarChange(selectedPersona);
      if (!pointerForked) {
        await replyInfoEmbed(editModalInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        continue;
      }
      if (wasPointer) {
        invalidateTomoriStateCache(interaction.guild.id);
      }

      if (imageAttachment) {
        const downloadedBuffer = await downloadPersonaSpriteImageAttachment(imageAttachment);
        if (!downloadedBuffer.ok) {
          await replyInfoEmbed(editModalInteraction, locale, {
            titleKey: "commands.persona.sprites.add.invalid_image_title",
            descriptionKey:
              downloadedBuffer.reason === "timeout"
                ? "commands.persona.sprites.add.error_download_timeout"
                : "commands.persona.sprites.add.error_download_failed",
            color: ColorCode.ERROR,
          });
          continue;
        }

        let pngBuffer: Buffer;
        try {
          pngBuffer = await convertToPNG(downloadedBuffer.buffer);
        } catch (error) {
          log.warn("Failed to convert persona sprite replacement image to PNG", error);
          await replyInfoEmbed(editModalInteraction, locale, {
            titleKey: "commands.persona.sprites.add.conversion_error_title",
            descriptionKey: "commands.persona.sprites.add.conversion_error_description",
            color: ColorCode.ERROR,
          });
          continue;
        }

        uploadedReference = await uploadPersonaSpriteToStorage({
          personaId,
          serverDiscId: interaction.guild.id,
          label: nameValidation.displayName,
          buffer: pngBuffer,
        });
        if (!uploadedReference) {
          await replyInfoEmbed(editModalInteraction, locale, {
            titleKey: "commands.persona.sprites.add.api_error_title",
            descriptionKey: "commands.persona.sprites.add.api_error_description",
            color: ColorCode.ERROR,
          });
          continue;
        }
      }

      const updateResult = await personaSpriteRepository.updateSpriteMetadata({
        currentSpriteKey: selectedSprite.sprite_key,
        personaId,
        spriteName: nameValidation.displayName,
        spriteKey: nameValidation.spriteKey,
        avatarUrl: uploadedReference ?? undefined,
        usageInstructions,
        isIdentity: saveAsIdentity,
      });
      if (!updateResult) {
        if (uploadedReference) {
          await deletePersonaSpriteFromStorage(uploadedReference);
        }
        await replyInfoEmbed(editModalInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        continue;
      }

      if (uploadedReference && updateResult.previousAvatarUrl && updateResult.previousAvatarUrl !== uploadedReference) {
        await deletePersonaSpriteFromStorage(updateResult.previousAvatarUrl);
      }

      const updatedSprite = updateResult.sprite;
      log.success(
        `Edited sprite "${selectedSprite.sprite_key}" for persona ${personaId} by ${userData.user_disc_id}: "${updatedSprite.sprite_name}" (identity=${updatedSprite.is_identity})`,
      );

      // 10. Acknowledge the edit modal, refresh the picker, and reload personas so
      //     the next loop reflects the just-saved change.
      if (imageEditDeferred) {
        await replyInfoEmbed(editModalInteraction, locale, {
          titleKey: "commands.persona.sprites.edit.success_title",
          descriptionKey: "commands.persona.sprites.edit.success_description",
          descriptionVars: {
            persona_name: selectedPersona.persona_nickname,
            sprite_name: updatedSprite.sprite_name,
          },
          color: ColorCode.SUCCESS,
        });
      } else {
        await acknowledgeModalSubmitForRefresh(editModalInteraction);
      }
      await replyComponentsV2Status(
        interaction,
        locale,
        "commands.persona.sprites.edit.success_title",
        "commands.persona.sprites.edit.success_description",
        ColorCode.SUCCESS,
        {
          persona_name: selectedPersona.persona_nickname,
          sprite_name: updatedSprite.sprite_name,
        },
        "general.pagination.reloading_persona_picker",
      );

      allPersonas = await personaRepository.loadAllForServer(interaction.guild.id);
    }
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      personaId: selectedPersona?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "persona sprites edit",
        guildId: interaction.guild.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error in /persona sprites edit command", error as Error, context);

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

/**
 * Builds the select-option description for a sprite: its identity status followed
 * by the usage instructions (or a placeholder when none are set).
 */
function formatSpriteOptionDescription(sprite: PersonaSpriteRow, locale: string): string {
  const status = formatIdentityStatus(sprite.is_identity, locale);
  const instructions =
    sprite.usage_instructions.trim() || localizer(locale, "commands.persona.sprites.remove.default_usage_description");
  return `${status} · ${instructions}`;
}

/** Localized "Identity"/"Sprite" label for a sprite's is_identity flag. */
function formatIdentityStatus(isIdentity: boolean, locale: string): string {
  return localizer(
    locale,
    isIdentity
      ? "commands.persona.sprites.edit.identity_status_on"
      : "commands.persona.sprites.edit.identity_status_off",
  );
}
