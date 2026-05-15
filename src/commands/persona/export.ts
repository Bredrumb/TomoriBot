/**
 * Preset Export Command
 * Exports TomoriBot's personality as a PNG file with embedded metadata
 */

import type {
  ChatInputCommandInteraction,
  Client,
  ModalSubmitInteraction,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { AttachmentBuilder, MessageFlags, EmbedBuilder } from "discord.js";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed, promptWithPaginatedModal, safeSelectOptionText } from "../../utils/discord/interactionHelper";
import type { UserRow } from "../../types/db/schema";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";
import { getServerAvatar } from "../../utils/image/avatarHelper";
import { embedMetadataInPNG } from "../../utils/image/pngMetadata";
import type { SelectOption } from "../../types/discord/modal";
import { loadAllPersonasForServer } from "@/utils/db/repositories";
import { sanitizeAttachmentFilenamePart } from "@/utils/discord/attachmentFilename";
import { convertToPNG } from "@/utils/image/imageProcessor";
import { loadStoredPersonaAvatarBuffer } from "@/utils/storage/avatarStorage";

const PERSONA_EXPORT_MODAL_ID = "persona_export_persona_modal";
const PERSONA_EXPORT_SELECT_ID = "persona_select";
const PERSONA_EXPORT_JSON_SELECT_ID = "export_json_select";
const PERSONA_EXPORT_JSON_FALSE = "false";
const PERSONA_EXPORT_JSON_TRUE = "true";

/**
 * Configure the 'export' subcommand
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("export").setDescription(localizer("en-US", "commands.persona.export.description"));

/**
 * Executes the 'export' command
 * Exports TomoriBot's personality to a PNG file and sends it to the channel
 * @param client - The Discord client instance
 * @param interaction - The chat input command interaction
 * @param userData - The user data for the invoking user
 * @param locale - The user's preferred locale
 */
export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  let responseInteraction: ChatInputCommandInteraction | ModalSubmitInteraction = interaction;

  try {
    // 1. Resolve target persona via selector
    const serverDiscId = interaction.guild?.id ?? interaction.user.id;
    const allPersonas = await loadAllPersonasForServer(serverDiscId);
    const personaSelectOptions: SelectOption[] = allPersonas
      .filter((persona) => persona.tomori_id !== undefined)
      .map((persona) => ({
        label: safeSelectOptionText(persona.tomori_nickname),
        value: persona.tomori_id?.toString() ?? "",
        description: persona.is_alter
          ? localizer(locale, "commands.persona.export.alter_persona_description")
          : localizer(locale, "commands.persona.export.main_persona_description"),
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

    const personaModalResult = await promptWithPaginatedModal(interaction, locale, {
      modalCustomId: PERSONA_EXPORT_MODAL_ID,
      modalTitleKey: "commands.persona.export.persona_modal_title",
      components: [
        {
          customId: PERSONA_EXPORT_SELECT_ID,
          labelKey: "commands.persona.export.persona_select_label",
          descriptionKey: "commands.persona.export.persona_select_description",
          placeholder: "commands.persona.export.persona_select_placeholder",
          required: true,
          options: personaSelectOptions,
        },
        {
          // Checkbox: checked = export JSON (true), unchecked = skip (false).
          // Value returned in modalResult.values[PERSONA_EXPORT_JSON_SELECT_ID] as "true"/"false".
          kind: "checkbox" as const,
          customId: PERSONA_EXPORT_JSON_SELECT_ID,
          labelKey: "commands.persona.export.export_json_select_label",
          descriptionKey: "commands.persona.export.export_json_select_description",
          default: false,
        },
      ],
    });
    if (personaModalResult.outcome !== "submit") {
      log.info(`Persona export select modal ${personaModalResult.outcome} for user ${interaction.user.id}`);
      return;
    }

    const modalSubmitInteraction = personaModalResult.interaction;
    if (!modalSubmitInteraction) {
      return;
    }
    responseInteraction = modalSubmitInteraction;

    const selectedPersonaId = personaModalResult.values?.[PERSONA_EXPORT_SELECT_ID];
    const exportJsonSelection = personaModalResult.values?.[PERSONA_EXPORT_JSON_SELECT_ID] ?? PERSONA_EXPORT_JSON_FALSE;
    const exportJson = exportJsonSelection === PERSONA_EXPORT_JSON_TRUE;
    const selectedPersona = allPersonas.find((persona) => persona.tomori_id?.toString() === selectedPersonaId) ?? null;
    if (!selectedPersona?.tomori_id) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 2. Defer reply while we process (not ephemeral for transparency)
    await responseInteraction.deferReply();

    // 3. Export selected persona data from database
    const exportResult = await presetRepository.exportPresetData(serverDiscId, selectedPersona.tomori_id);

    if (!exportResult.success) {
      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.persona.export.failed_title"))
            .setDescription(localizer(locale, exportResult.error))
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    // Type is now narrowed to success variant
    const presetData = exportResult.data;
    if (exportJson) {
      const nickname = presetData.data.tomori_nickname;
      const sanitizedNickname = sanitizeAttachmentFilenamePart(nickname, {
        fallback: "persona",
        maxLength: 50,
      });
      const timestamp = Date.now();
      const filename = `tomori-preset-${sanitizedNickname}-${timestamp}.json`;

      const readableJsonExport = {
        export_type: "persona_readable",
        import_compatible: false,
        exported_at: new Date().toISOString(),
        note: localizer(locale, "commands.persona.export.json_non_importable_note"),
        persona: {
          tomori_id: selectedPersona.tomori_id ?? null,
          tomori_nickname: nickname,
          is_alter: selectedPersona.is_alter === true,
          persona_lineage_id: presetData.data.persona_lineage_id,
          trigger_words: presetData.data.trigger_words,
          persona_prompt: presetData.data.persona_prompt,
          attribute_list: presetData.data.attribute_list,
          sample_dialogues_in: presetData.data.sample_dialogues_in,
          sample_dialogues_out: presetData.data.sample_dialogues_out,
          sample_dialogues: presetData.data.sample_dialogues_in.map((input, index) => ({
            user_input: input,
            persona_output: presetData.data.sample_dialogues_out[index] ?? "",
          })),
          webhook_avatar_url: selectedPersona.webhook_avatar_url ?? null,
          alter_triggers: selectedPersona.alter_triggers ?? [],
          nai_tags: selectedPersona.nai_tags ?? [],
        },
      };

      const attachment = new AttachmentBuilder(
        Buffer.from(`${JSON.stringify(readableJsonExport, null, 2)}\n`, "utf8"),
        {
          name: filename,
        },
      );

      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.persona.export.success_title"))
            .setDescription(
              localizer(locale, "commands.persona.export.success_description_json", {
                nickname,
              }),
            )
            .setColor(ColorCode.SUCCESS),
        ],
        files: [attachment],
      });

      log.success(
        `Successfully exported readable JSON preset for ${interaction.guild ? "guild" : "DM"} ${serverDiscId}: ${nickname}`,
      );
      return;
    }

    // 4. Resolve avatar image (alter persona avatar when available, otherwise server avatar)
    let avatarBuffer: Buffer;
    try {
      let selectedAvatarBuffer: Buffer | null = null;
      if (selectedPersona.is_alter && selectedPersona.webhook_avatar_url) {
        const storedAvatarBuffer = await loadStoredPersonaAvatarBuffer(selectedPersona.webhook_avatar_url);
        if (storedAvatarBuffer) {
          try {
            selectedAvatarBuffer = await convertToPNG(storedAvatarBuffer);
          } catch (error) {
            log.warn(
              `Failed to convert alter avatar to PNG for tomori ${selectedPersona.tomori_id}; falling back to server avatar`,
              error as Error,
            );
          }
        } else {
          log.warn(
            `Failed to download alter avatar for tomori ${selectedPersona.tomori_id}; falling back to server avatar`,
          );
        }
      }

      avatarBuffer =
        selectedAvatarBuffer ??
        // In DMs, getServerAvatar will return bot's default avatar when guild is null
        (await getServerAvatar(interaction.guild, client));
    } catch (error) {
      log.error(`Failed to get avatar for ${interaction.guild ? "guild" : "DM"} ${serverDiscId}:`, error as Error);
      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.persona.export.avatar_failed_title"))
            .setDescription(localizer(locale, "commands.persona.export.avatar_failed_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    // 5. Embed metadata into PNG
    let pngWithMetadata: Buffer;
    try {
      pngWithMetadata = embedMetadataInPNG(avatarBuffer, presetData);
    } catch (error) {
      log.error(
        `Failed to embed metadata into PNG for ${interaction.guild ? "guild" : "DM"} ${serverDiscId}:`,
        error as Error,
      );
      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.persona.export.embed_failed_title"))
            .setDescription(localizer(locale, "commands.persona.export.embed_failed_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    // 6. Create filename with nickname and timestamp
    const nickname = presetData.data.tomori_nickname;
    const sanitizedNickname = sanitizeAttachmentFilenamePart(nickname, {
      fallback: "persona",
      maxLength: 50,
    });
    const timestamp = Date.now();
    const filename = `tomori-preset-${sanitizedNickname}-${timestamp}.png`;

    // 7. Create attachment
    const attachment = new AttachmentBuilder(pngWithMetadata, {
      name: filename,
    });

    // 8. Send to channel with embedded image (visible to everyone for transparency)
    await responseInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.persona.export.success_title"))
          .setDescription(
            localizer(locale, "commands.persona.export.success_description", {
              nickname: nickname,
            }),
          )
          .setColor(ColorCode.SUCCESS)
          .setImage(`attachment://${filename}`),
      ],
      files: [attachment],
    });

    log.success(`Successfully exported preset for ${interaction.guild ? "guild" : "DM"} ${serverDiscId}: ${nickname}`);
  } catch (error) {
    log.error("Error executing preset export command:", error, {
      errorType: "CommandExecutionError",
      metadata: { commandName: "preset export" },
    });

    // If we haven't replied yet, reply with error
    if (!responseInteraction.replied && !responseInteraction.deferred) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "general.errors.unknown_error_title"))
            .setDescription(localizer(locale, "general.errors.unknown_error_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
    }
  }
}
