import {
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { personaRepository, personaSpriteRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
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

const MODAL_CUSTOM_ID = "persona_sprites_add_modal";
const PERSONA_SELECT_ID = "persona_select";
const SPRITE_NAME_INPUT_ID = "sprite_name_input";
const SPRITE_IMAGE_UPLOAD_ID = "sprite_image_upload";
const SPRITE_INSTRUCTIONS_INPUT_ID = "sprite_usage_instructions";
const SPRITE_IDENTITY_CHECKBOX_ID = "sprite_save_as_identity";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("add").setDescription(localizer("en-US", "commands.persona.sprites.add.description"));

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

  let responseInteraction: ChatInputCommandInteraction | ModalSubmitInteraction = interaction;
  let selectedPersona: TomoriState | null = null;

  try {
    const allPersonas = await personaRepository.loadAllForServer(interaction.guild.id);
    const personaSelectOptions = buildPersonaSelectOptions(
      allPersonas,
      locale,
      "commands.persona.sprites.add.main_persona_description",
      "commands.persona.sprites.add.alter_persona_description",
    );
    if (personaSelectOptions.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modalResult = await promptWithPaginatedModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.persona.sprites.add.modal_title",
      components: [
        {
          customId: PERSONA_SELECT_ID,
          labelKey: "commands.persona.sprites.add.persona_select_label",
          descriptionKey: "commands.persona.sprites.add.persona_select_description",
          placeholder: "commands.persona.sprites.add.persona_select_placeholder",
          required: true,
          options: personaSelectOptions,
        },
        {
          customId: SPRITE_NAME_INPUT_ID,
          labelKey: "commands.persona.sprites.add.sprite_name_label",
          descriptionKey: "commands.persona.sprites.add.sprite_name_description",
          placeholder: "commands.persona.sprites.add.sprite_name_placeholder",
          style: TextInputStyle.Short,
          required: true,
          minLength: 1,
          maxLength: PERSONA_SPRITE_LIMITS.MAX_NAME_LENGTH,
        },
        {
          customId: SPRITE_IMAGE_UPLOAD_ID,
          labelKey: "commands.persona.sprites.add.image_label",
          descriptionKey: "commands.persona.sprites.add.image_description",
          minValues: 1,
          maxValues: 1,
          required: true,
        },
        {
          customId: SPRITE_INSTRUCTIONS_INPUT_ID,
          labelKey: "commands.persona.sprites.add.instructions_label",
          descriptionKey: "commands.persona.sprites.add.instructions_description",
          placeholder: "commands.persona.sprites.add.instructions_placeholder",
          style: TextInputStyle.Paragraph,
          required: false,
          maxLength: PERSONA_SPRITE_LIMITS.MAX_INSTRUCTIONS_LENGTH,
        },
        {
          kind: "checkbox",
          customId: SPRITE_IDENTITY_CHECKBOX_ID,
          labelKey: "commands.persona.sprites.add.identity_label",
          descriptionKey: "commands.persona.sprites.add.identity_description",
          default: false,
        },
      ],
    });

    if (modalResult.outcome !== "submit") {
      log.info(`Persona sprite add modal ${modalResult.outcome} for user ${interaction.user.id}`);
      return;
    }

    if (!modalResult.interaction) {
      return;
    }
    responseInteraction = modalResult.interaction;
    if (!responseInteraction.deferred && !responseInteraction.replied) {
      await responseInteraction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    const selectedPersonaId = modalResult.values?.[PERSONA_SELECT_ID];
    selectedPersona = allPersonas.find((persona) => persona.persona_id?.toString() === selectedPersonaId) ?? null;
    if (!selectedPersona?.persona_id) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }
    const personaId = selectedPersona.persona_id;

    const nameValidation = validatePersonaSpriteName(modalResult.values?.[SPRITE_NAME_INPUT_ID] ?? "");
    if (!nameValidation.ok) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.persona.sprites.add.invalid_name_title",
        descriptionKey: `commands.persona.sprites.add.invalid_name_${nameValidation.reason}`,
        descriptionVars: {
          max_length: PERSONA_SPRITE_LIMITS.MAX_NAME_LENGTH.toString(),
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    // "Save as Identity" is authoritative on every add: re-adding an existing
    // sprite with the box unchecked demotes it back to an ordinary sprite.
    const saveAsIdentity = modalResult.values?.[SPRITE_IDENTITY_CHECKBOX_ID] === "true";

    const usageInstructions = normalizePersonaSpriteInstructions(modalResult.values?.[SPRITE_INSTRUCTIONS_INPUT_ID]);
    if (isPersonaSpriteInstructionsTooLong(usageInstructions)) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.persona.sprites.add.instructions_too_long_title",
        descriptionKey: "commands.persona.sprites.add.instructions_too_long_description",
        descriptionVars: {
          max_length: PERSONA_SPRITE_LIMITS.MAX_INSTRUCTIONS_LENGTH.toString(),
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    const imageAttachment = modalResult.attachments?.[SPRITE_IMAGE_UPLOAD_ID];
    if (!imageAttachment) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.persona.sprites.add.invalid_image_title",
        descriptionKey: "commands.persona.sprites.add.invalid_image_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const imageValidation = validatePersonaSpriteImageAttachment(imageAttachment);
    if (!imageValidation.ok) {
      await replyInfoEmbed(responseInteraction, locale, {
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
      return;
    }

    const memoryCheck = memoryGuard.checkMemory();
    if (memoryCheck.status === "critical") {
      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "rate_limit.error_memory_critical_title"))
            .setDescription(localizer(locale, "rate_limit.error_memory_critical_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    // Enforce the per-persona sprite cap BEFORE reserving avatar quota.
    //    Avatar quota is a shared, guild-level (server-wide) budget, so a
    //    rejected-over-limit add must not consume one of its daily slots.
    const existingSprites = await personaSpriteRepository.listForPersona(personaId);
    const replacingExisting = existingSprites.some((sprite) => sprite.sprite_key === nameValidation.spriteKey);
    if (!replacingExisting && existingSprites.length >= PERSONA_SPRITE_LIMITS.MAX_PER_PERSONA) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.persona.sprites.add.limit_title",
        descriptionKey: "commands.persona.sprites.add.limit_description",
        descriptionVars: {
          max_count: PERSONA_SPRITE_LIMITS.MAX_PER_PERSONA.toString(),
          persona_name: selectedPersona.persona_nickname,
        },
        color: ColorCode.WARN,
      });
      return;
    }

    const quotaReserve = reserveAvatarQuota(interaction.guild.id);
    if (!quotaReserve.allowed) {
      const resetTime = quotaReserve.resetAt
        ? new Date(quotaReserve.resetAt).toLocaleString(locale)
        : localizer(locale, "general.unknown");
      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "rate_limit.error_quota_exceeded_title"))
            .setDescription(
              localizer(locale, "rate_limit.error_quota_exceeded_description", {
                reset_time: resetTime,
              }),
            )
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    const wasPointer = selectedPersona.is_pointer === true;
    const pointerForked = await forkPointerForAvatarChange(selectedPersona);
    if (!pointerForked) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }
    if (wasPointer) {
      invalidateTomoriStateCache(interaction.guild.id);
    }

    const downloadedBuffer = await downloadPersonaSpriteImageAttachment(imageAttachment);
    if (!downloadedBuffer.ok) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.persona.sprites.add.invalid_image_title",
        descriptionKey:
          downloadedBuffer.reason === "timeout"
            ? "commands.persona.sprites.add.error_download_timeout"
            : "commands.persona.sprites.add.error_download_failed",
        color: ColorCode.ERROR,
      });
      return;
    }

    let pngBuffer: Buffer;
    try {
      pngBuffer = await convertToPNG(downloadedBuffer.buffer);
    } catch (error) {
      log.warn("Failed to convert persona sprite image to PNG", error);
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.persona.sprites.add.conversion_error_title",
        descriptionKey: "commands.persona.sprites.add.conversion_error_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const uploadedReference = await uploadPersonaSpriteToStorage({
      personaId,
      serverDiscId: interaction.guild.id,
      label: nameValidation.displayName,
      buffer: pngBuffer,
    });
    if (!uploadedReference) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.persona.sprites.add.api_error_title",
        descriptionKey: "commands.persona.sprites.add.api_error_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const upsertResult = await personaSpriteRepository.upsertSprite({
      personaId,
      spriteName: nameValidation.displayName,
      spriteKey: nameValidation.spriteKey,
      avatarUrl: uploadedReference,
      usageInstructions,
      isIdentity: saveAsIdentity,
    });
    if (!upsertResult) {
      await deletePersonaSpriteFromStorage(uploadedReference);
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (upsertResult.previousAvatarUrl && upsertResult.previousAvatarUrl !== uploadedReference) {
      await deletePersonaSpriteFromStorage(upsertResult.previousAvatarUrl);
    }

    await replyInfoEmbed(responseInteraction, locale, {
      titleKey: upsertResult.replaced
        ? "commands.persona.sprites.add.success_replaced_title"
        : "commands.persona.sprites.add.success_created_title",
      descriptionKey: upsertResult.replaced
        ? "commands.persona.sprites.add.success_replaced_description"
        : "commands.persona.sprites.add.success_created_description",
      descriptionVars: {
        persona_name: selectedPersona.persona_nickname,
        sprite_name: upsertResult.sprite.sprite_name,
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      personaId: selectedPersona?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "persona sprites add",
        guildId: interaction.guild.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error in /persona sprites add command", error as Error, context);

    const replyTarget =
      responseInteraction.deferred || responseInteraction.replied
        ? responseInteraction
        : interaction.deferred || interaction.replied
          ? interaction
          : null;
    if (replyTarget) {
      await replyInfoEmbed(replyTarget, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
    }
  }
}

function buildPersonaSelectOptions(
  personas: TomoriState[],
  locale: string,
  mainDescriptionKey: string,
  alterDescriptionKey: string,
): SelectOption[] {
  return personas
    .filter((persona) => persona.persona_id !== undefined)
    .map((persona) => ({
      label: safeSelectOptionText(persona.persona_nickname),
      value: persona.persona_id?.toString() ?? "",
      description: persona.is_alter ? localizer(locale, alterDescriptionKey) : localizer(locale, mainDescriptionKey),
    }))
    .filter((option) => option.value !== "");
}
