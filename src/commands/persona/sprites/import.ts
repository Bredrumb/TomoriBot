/**
 * Persona Sprite Import Command (`/persona sprites import`)
 *
 * Imports a sprite archive (`.zip`, produced by `/persona sprites export`) into
 * a chosen persona. Uses a single modal: persona string-select plus a file
 * upload field: mirroring `/persona sprites add`.
 *
 * Behavior decisions:
 *  - Name conflicts OVERWRITE the existing sprite (image + metadata).
 *  - If the archive would push the persona past its per-persona cap, the WHOLE
 *    import is rejected (all-or-nothing) so the persona is never left partial.
 *  - All images are validated/converted up front, before any storage/DB write.
 */

import {
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
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
  PERSONA_SPRITE_LIMITS,
  validatePersonaSpriteName,
  normalizePersonaSpriteInstructions,
} from "@/utils/persona/sprites";
import { readSpriteArchive, type SpriteArchiveReadResult } from "@/utils/persona/spriteArchive";
import { memoryGuard, IMPORT_LIMITS, PERSONA_LIMITS, reserveImportQuota } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";
import { deletePersonaSpriteFromStorage, uploadPersonaSpriteToStorage } from "@/utils/storage/avatarStorage";
import { localizer } from "@/utils/text/localizer";
import { forkPointerForAvatarChange } from "../avatar";

const MODAL_CUSTOM_ID = "persona_sprites_import_modal";
const PERSONA_SELECT_ID = "persona_select";
const ARCHIVE_UPLOAD_ID = "sprite_archive_upload";
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_ARCHIVE_BYTES = IMPORT_LIMITS.MAX_PERSONA_IMPORT_SIZE_MB * 1024 * 1024;
const MAX_IMAGE_BYTES = PERSONA_LIMITS.MAX_AVATAR_SIZE_MB * 1024 * 1024;

/** One archive entry that passed name + image validation, ready to write. */
type PreparedSprite = {
  displayName: string;
  spriteKey: string;
  usageInstructions: string;
  isIdentity: boolean;
  pngBuffer: Buffer;
};

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("import").setDescription(localizer("en-US", "commands.persona.sprites.import.description"));

/**
 * Executes the `/persona sprites import` command.
 * @param _client - Discord client (unused; storage handles image persistence)
 * @param userData - Invoking user's row (for locale fallback)
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // Sprites are guild-scoped and importing mutates them, so require a guild
  //    and Manage Server (mirrors add/remove).
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
      titleKey: "commands.persona.sprites.import.no_permission_title",
      descriptionKey: "commands.persona.sprites.import.no_permission_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let responseInteraction: ChatInputCommandInteraction | ModalSubmitInteraction = interaction;
  let selectedPersona: TomoriState | null = null;

  try {
    const allPersonas = await personaRepository.loadAllForServer(interaction.guild.id);
    const personaSelectOptions = buildPersonaSelectOptions(allPersonas, locale);
    if (personaSelectOptions.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Single modal: target persona + archive upload (handles the 3s ack).
    const modalResult = await promptWithPaginatedModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.persona.sprites.import.modal_title",
      components: [
        {
          customId: PERSONA_SELECT_ID,
          labelKey: "commands.persona.sprites.import.persona_select_label",
          descriptionKey: "commands.persona.sprites.import.persona_select_description",
          placeholder: "commands.persona.sprites.import.persona_select_placeholder",
          required: true,
          options: personaSelectOptions,
        },
        {
          customId: ARCHIVE_UPLOAD_ID,
          labelKey: "commands.persona.sprites.import.archive_label",
          descriptionKey: "commands.persona.sprites.import.archive_description",
          minValues: 1,
          maxValues: 1,
          required: true,
        },
      ],
    });

    if (modalResult.outcome !== "submit" || !modalResult.interaction) {
      log.info(`Persona sprite import modal ${modalResult.outcome} for user ${interaction.user.id}`);
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

    // Validate the uploaded archive (extension + size) before any heavy work.
    const archiveAttachment = modalResult.attachments?.[ARCHIVE_UPLOAD_ID];
    if (!archiveAttachment?.filename.toLowerCase().endsWith(".zip")) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.persona.sprites.import.invalid_file_title",
        descriptionKey: "commands.persona.sprites.import.invalid_file_description",
        color: ColorCode.ERROR,
      });
      return;
    }
    if (archiveAttachment.size > MAX_ARCHIVE_BYTES) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.persona.sprites.import.file_too_large_title",
        descriptionKey: "commands.persona.sprites.import.file_too_large_description",
        descriptionVars: { max_size: IMPORT_LIMITS.MAX_PERSONA_IMPORT_SIZE_MB.toString() },
        color: ColorCode.ERROR,
      });
      return;
    }

    // Reserve one import-operation quota slot for the whole batch (NOT one
    //    avatar-quota slot per sprite: a batch import is a single operation).
    const quotaReserve = reserveImportQuota(interaction.user.id);
    if (!quotaReserve.allowed) {
      const resetTime = quotaReserve.resetAt
        ? new Date(quotaReserve.resetAt).toLocaleString(locale)
        : localizer(locale, "general.unknown");
      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "rate_limit.error_quota_exceeded_title"))
            .setDescription(localizer(locale, "rate_limit.error_quota_exceeded_description", { reset_time: resetTime }))
            .setColor(ColorCode.ERROR),
        ],
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

    const download = await safeDownload(archiveAttachment.url, {
      maxSizeMB: IMPORT_LIMITS.MAX_PERSONA_IMPORT_SIZE_MB,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      knownSize: archiveAttachment.size,
    });
    if (!download.success || !download.buffer) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.persona.sprites.import.download_failed_title",
        descriptionKey: "commands.persona.sprites.import.download_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Parse + validate the archive (ZIP-bomb guards live in readSpriteArchive).
    const archive = await readSpriteArchive(download.buffer, {
      maxEntries: PERSONA_SPRITE_LIMITS.MAX_PER_PERSONA,
      maxFileBytes: MAX_IMAGE_BYTES,
      maxTotalBytes: PERSONA_SPRITE_LIMITS.MAX_PER_PERSONA * MAX_IMAGE_BYTES,
    });
    if (!archive.ok) {
      const errorEmbed = buildArchiveErrorEmbed(archive, locale);
      await responseInteraction.editReply({ embeds: [errorEmbed] });
      return;
    }

    // Validate names and convert every image BEFORE touching storage/DB so a
    //    bad entry aborts the whole import cleanly. Incoming keys are deduped
    //    (last wins) because two entries could normalize to the same key.
    const preparedByKey = new Map<string, PreparedSprite>();
    for (const entry of archive.entries) {
      const nameValidation = validatePersonaSpriteName(entry.meta.sprite_name);
      if (!nameValidation.ok) {
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "commands.persona.sprites.import.invalid_sprite_title",
          descriptionKey: "commands.persona.sprites.import.invalid_sprite_name_description",
          descriptionVars: { sprite_name: safeSelectOptionText(entry.meta.sprite_name, 80) },
          color: ColorCode.ERROR,
        });
        return;
      }

      let pngBuffer: Buffer;
      try {
        pngBuffer = await convertToPNG(entry.pngBuffer);
      } catch (error) {
        log.warn(`Sprite import: image conversion failed for "${entry.meta.sprite_name}"`, error);
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "commands.persona.sprites.import.invalid_sprite_title",
          descriptionKey: "commands.persona.sprites.import.invalid_sprite_image_description",
          descriptionVars: { sprite_name: safeSelectOptionText(nameValidation.displayName, 80) },
          color: ColorCode.ERROR,
        });
        return;
      }

      preparedByKey.set(nameValidation.spriteKey, {
        displayName: nameValidation.displayName,
        spriteKey: nameValidation.spriteKey,
        usageInstructions: normalizePersonaSpriteInstructions(entry.meta.usage_instructions),
        isIdentity: entry.meta.is_identity,
        pngBuffer,
      });
    }
    const prepared = [...preparedByKey.values()];

    // Cap check (all-or-nothing). Only NEW keys count toward the cap; keys
    //    that already exist are overwrites and do not grow the set.
    const existingSprites = await personaSpriteRepository.listForPersona(personaId);
    const existingKeys = new Set(existingSprites.map((sprite) => sprite.sprite_key));
    const newKeyCount = prepared.filter((sprite) => !existingKeys.has(sprite.spriteKey)).length;
    const projectedTotal = existingKeys.size + newKeyCount;
    if (projectedTotal > PERSONA_SPRITE_LIMITS.MAX_PER_PERSONA) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.persona.sprites.import.limit_title",
        descriptionKey: "commands.persona.sprites.import.limit_description",
        descriptionVars: {
          persona_name: selectedPersona.persona_nickname,
          max_count: PERSONA_SPRITE_LIMITS.MAX_PER_PERSONA.toString(),
          current_count: existingKeys.size.toString(),
          incoming_count: prepared.length.toString(),
        },
        color: ColorCode.WARN,
      });
      return;
    }

    // Materialize a pointer persona so sprites (keyed by persona_id) attach
    //    to a concrete row (mirrors add/remove).
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

    // Upload + upsert each sprite. The cap was guaranteed above, so a
    //     failure here is a transient storage/DB error: record it and continue
    //     so one bad image doesn't lose the rest of a large batch.
    let createdCount = 0;
    let replacedCount = 0;
    let failedCount = 0;
    for (const sprite of prepared) {
      const uploadedReference = await uploadPersonaSpriteToStorage({
        personaId,
        serverDiscId: interaction.guild.id,
        label: sprite.displayName,
        buffer: sprite.pngBuffer,
      });
      if (!uploadedReference) {
        failedCount += 1;
        continue;
      }

      const upsertResult = await personaSpriteRepository.upsertSprite({
        personaId,
        spriteName: sprite.displayName,
        spriteKey: sprite.spriteKey,
        avatarUrl: uploadedReference,
        usageInstructions: sprite.usageInstructions,
        isIdentity: sprite.isIdentity,
      });
      if (!upsertResult) {
        // Roll back the orphaned upload for this entry.
        await deletePersonaSpriteFromStorage(uploadedReference);
        failedCount += 1;
        continue;
      }

      // Replacing an existing sprite leaves its old image orphaned in storage.
      if (upsertResult.previousAvatarUrl && upsertResult.previousAvatarUrl !== uploadedReference) {
        await deletePersonaSpriteFromStorage(upsertResult.previousAvatarUrl);
      }

      if (upsertResult.replaced) {
        replacedCount += 1;
      } else {
        createdCount += 1;
      }
    }

    await replyInfoEmbed(responseInteraction, locale, {
      titleKey:
        failedCount > 0
          ? "commands.persona.sprites.import.success_partial_title"
          : "commands.persona.sprites.import.success_title",
      descriptionKey: "commands.persona.sprites.import.success_description",
      descriptionVars: {
        persona_name: selectedPersona.persona_nickname,
        created_count: createdCount.toString(),
        replaced_count: replacedCount.toString(),
        failed_count: failedCount.toString(),
      },
      color: failedCount > 0 ? ColorCode.WARN : ColorCode.SUCCESS,
    });

    log.success(
      `Imported sprites for persona ${personaId} (${selectedPersona.persona_nickname}): ${createdCount} created, ${replacedCount} replaced, ${failedCount} failed`,
    );
  } catch (error) {
    const context: ErrorContext = {
      personaId: selectedPersona?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "persona sprites import",
        guildId: interaction.guild.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error in /persona sprites import command", error as Error, context);

    if (responseInteraction.deferred || responseInteraction.replied) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
    } else {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

/**
 * Maps a failed archive-parse result to its localized error embed.
 * @param result - The failed `readSpriteArchive` result
 */
function buildArchiveErrorEmbed(result: Extract<SpriteArchiveReadResult, { ok: false }>, locale: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(ColorCode.ERROR);
  switch (result.reason) {
    case "too_many_entries":
      return embed
        .setTitle(localizer(locale, "commands.persona.sprites.import.error_too_many_entries_title"))
        .setDescription(
          localizer(locale, "commands.persona.sprites.import.error_too_many_entries_description", {
            max_count: PERSONA_SPRITE_LIMITS.MAX_PER_PERSONA.toString(),
          }),
        );
    case "file_too_large":
    case "total_too_large":
      return embed.setTitle(localizer(locale, "commands.persona.sprites.import.file_too_large_title")).setDescription(
        localizer(locale, "commands.persona.sprites.import.error_image_too_large_description", {
          max_size: PERSONA_LIMITS.MAX_AVATAR_SIZE_MB.toString(),
        }),
      );
    case "incompatible_version":
      return embed
        .setTitle(localizer(locale, "commands.persona.sprites.import.invalid_file_title"))
        .setDescription(localizer(locale, "commands.persona.sprites.import.error_incompatible_version_description"));
    case "empty":
      return embed
        .setTitle(localizer(locale, "commands.persona.sprites.import.invalid_file_title"))
        .setDescription(localizer(locale, "commands.persona.sprites.import.error_empty_description"));
    default:
      // invalid_zip | missing_manifest | invalid_manifest | missing_image
      return embed
        .setTitle(localizer(locale, "commands.persona.sprites.import.invalid_file_title"))
        .setDescription(localizer(locale, "commands.persona.sprites.import.invalid_file_description"));
  }
}

function buildPersonaSelectOptions(personas: TomoriState[], locale: string): SelectOption[] {
  return personas
    .filter((persona) => persona.persona_id !== undefined)
    .map((persona) => ({
      label: safeSelectOptionText(persona.persona_nickname),
      value: persona.persona_id?.toString() ?? "",
      description: persona.is_alter
        ? localizer(locale, "commands.persona.sprites.import.alter_persona_description")
        : localizer(locale, "commands.persona.sprites.import.main_persona_description"),
    }))
    .filter((option) => option.value !== "");
}
