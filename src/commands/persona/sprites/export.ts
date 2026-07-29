/**
 * Persona Sprite Export Command (`/persona sprites export`)
 *
 * Bundles all of a selected persona's sprites (images + metadata) into a single
 * shareable `.zip`. Kept separate from `/persona export` on purpose: sprite sets
 * can be large, so folding them into the persona card would balloon that file.
 */

import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { personaRepository, personaSpriteRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { sanitizeAttachmentFilenamePart } from "@/utils/discord/attachmentFilename";
import { convertToPNG } from "@/utils/image/imageProcessor";
import { ColorCode, log } from "@/utils/misc/logger";
import { buildSpriteArchive, type SpriteArchiveBuildEntry } from "@/utils/persona/spriteArchive";
import { memoryGuard } from "@/utils/security/rateLimiter";
import { loadStoredPersonaAvatarBuffer } from "@/utils/storage/avatarStorage";
import { localizer } from "@/utils/text/localizer";

const MODAL_CUSTOM_ID = "persona_sprites_export_modal";
const PERSONA_SELECT_ID = "persona_select";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("export").setDescription(localizer("en-US", "commands.persona.sprites.export.description"));

/**
 * Executes the `/persona sprites export` command.
 * @param _client - Discord client (unused; storage handles image resolution)
 * @param interaction - The chat input command interaction
 * @param userData - Invoking user's row (for locale fallback)
 * @param locale - Resolved locale
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  let responseInteraction: ChatInputCommandInteraction | ModalSubmitInteraction = interaction;
  let selectedPersona: TomoriState | null = null;

  try {
    // Sprites are server-scoped; in DMs the user id stands in for the server.
    const serverDiscId = interaction.guild?.id ?? interaction.user.id;
    const allPersonas = await personaRepository.loadAllForServer(serverDiscId);
    const personaSelectOptions = buildPersonaSelectOptions(allPersonas, locale);
    if (personaSelectOptions.length === 0) {
      await replyInfoEmbed(interaction, userData.language_pref, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Ask which persona to export sprites from (modal handles the 3s ack).
    const modalResult = await promptWithPaginatedModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.persona.sprites.export.modal_title",
      components: [
        {
          customId: PERSONA_SELECT_ID,
          labelKey: "commands.persona.sprites.export.persona_select_label",
          descriptionKey: "commands.persona.sprites.export.persona_select_description",
          placeholder: "commands.persona.sprites.export.persona_select_placeholder",
          required: true,
          options: personaSelectOptions,
        },
      ],
    });

    if (modalResult.outcome !== "submit" || !modalResult.interaction) {
      log.info(`Persona sprite export modal ${modalResult.outcome} for user ${interaction.user.id}`);
      return;
    }
    responseInteraction = modalResult.interaction;

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

    // Defer publicly: an export is meant to be shared in-channel, mirroring
    //    `/persona export`.
    if (!responseInteraction.deferred && !responseInteraction.replied) {
      await responseInteraction.deferReply();
    }

    const sprites = await personaSpriteRepository.listForPersona(personaId);
    if (sprites.length === 0) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.persona.sprites.export.no_sprites_title",
        descriptionKey: "commands.persona.sprites.export.no_sprites_description",
        descriptionVars: {
          persona_name: selectedPersona.persona_nickname,
        },
        color: ColorCode.WARN,
      });
      return;
    }

    // Defense-in-depth: loading many images at once is the memory-heavy step.
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

    // Resolve each sprite's stored image to a normalized PNG buffer. Sprites
    //    whose image can no longer be loaded are skipped (and reported) rather
    //    than failing the whole export.
    const buildEntries: SpriteArchiveBuildEntry[] = [];
    let skippedCount = 0;
    for (const sprite of sprites) {
      const storedBuffer = await loadStoredPersonaAvatarBuffer(sprite.avatar_url);
      if (!storedBuffer) {
        skippedCount += 1;
        log.warn(`Skipping sprite ${sprite.sprite_key} (persona ${personaId}); image could not be loaded for export`);
        continue;
      }

      try {
        const pngBuffer = await convertToPNG(storedBuffer);
        buildEntries.push({ sprite, pngBuffer });
      } catch (error) {
        skippedCount += 1;
        log.warn(`Skipping sprite ${sprite.sprite_key} (persona ${personaId}); PNG conversion failed`, error);
      }
    }

    if (buildEntries.length === 0) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.persona.sprites.export.failed_title",
        descriptionKey: "commands.persona.sprites.export.all_images_failed_description",
        descriptionVars: {
          persona_name: selectedPersona.persona_nickname,
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    // Build the archive and attach it.
    const archive = await buildSpriteArchive({
      personaNickname: selectedPersona.persona_nickname,
      personaId,
      entries: buildEntries,
    });

    const sanitizedNickname = sanitizeAttachmentFilenamePart(selectedPersona.persona_nickname, {
      fallback: "persona",
      maxLength: 50,
    });
    const filename = `${sanitizedNickname}-sprites-${Date.now()}.zip`;
    const attachment = new AttachmentBuilder(archive.buffer, { name: filename });

    // Success embed; warn-colored when some images had to be skipped so the
    //    sharer knows the archive is incomplete.
    const descriptionKey =
      skippedCount > 0
        ? "commands.persona.sprites.export.success_partial_description"
        : "commands.persona.sprites.export.success_description";
    const successEmbed = new EmbedBuilder()
      .setTitle(localizer(locale, "commands.persona.sprites.export.success_title"))
      .setDescription(
        localizer(locale, descriptionKey, {
          persona_name: selectedPersona.persona_nickname,
          sprite_count: archive.spriteCount.toString(),
          skipped_count: skippedCount.toString(),
        }),
      )
      .setColor(skippedCount > 0 ? ColorCode.WARN : ColorCode.SUCCESS);

    await responseInteraction.editReply({
      embeds: [successEmbed],
      files: [attachment],
    });

    log.success(
      `Exported ${archive.spriteCount} sprite(s) for persona ${personaId} (${selectedPersona.persona_nickname}); skipped ${skippedCount}`,
    );
  } catch (error) {
    const context: ErrorContext = {
      personaId: selectedPersona?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "persona sprites export",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error in /persona sprites export command", error as Error, context);

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
 * Builds persona select options for the export modal.
 * @param personas - All personas for the server
 * @param locale - Resolved locale for option descriptions
 */
function buildPersonaSelectOptions(personas: TomoriState[], locale: string): SelectOption[] {
  return personas
    .filter((persona) => persona.persona_id !== undefined)
    .map((persona) => ({
      label: safeSelectOptionText(persona.persona_nickname),
      value: persona.persona_id?.toString() ?? "",
      description: persona.is_alter
        ? localizer(locale, "commands.persona.sprites.export.alter_persona_description")
        : localizer(locale, "commands.persona.sprites.export.main_persona_description"),
    }))
    .filter((option) => option.value !== "");
}
