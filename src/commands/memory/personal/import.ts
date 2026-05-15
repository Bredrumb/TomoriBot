import type {
  ChatInputCommandInteraction,
  Client,
  ModalSubmitInteraction,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import type { UserRow } from "@/types/db/schema";
import { importRepository, personaRepository } from "@/utils/db/repositories";
import type { PersonalMemoriesExportData } from "@/types/db/dataExport";

import type { SelectOption } from "@/types/discord/modal";
import { IMPORT_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";

const PERSONA_MODAL_ID = "memory_personal_import_persona_modal";
const PERSONA_SELECT_ID = "persona_select";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("import")
    .setDescription(localizer("en-US", "commands.memory.personal.import.description"))
    .addAttachmentOption((option) =>
      option
        .setName("file")
        .setDescription(localizer("en-US", "commands.memory.personal.import.file_description"))
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("target")
        .setDescription(localizer("en-US", "commands.memory.personal.import.target_description"))
        .setRequired(true)
        .addChoices(
          {
            name: localizer("en-US", "commands.memory.personal.import.target_choice_global"),
            value: "global",
          },
          {
            name: localizer("en-US", "commands.memory.personal.import.target_choice_persona"),
            value: "persona",
          },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("confirmation")
        .setDescription(localizer("en-US", "commands.memory.personal.import.confirmation_description"))
        .setRequired(true)
        .addChoices(
          { name: localizer("en-US", "commands.memory.personal.import.confirmation_choice_yes"), value: "yes" },
          { name: localizer("en-US", "commands.memory.personal.import.confirmation_choice_no"), value: "no" },
        ),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  const confirmation = interaction.options.getString("confirmation", true);
  const target = interaction.options.getString("target", true);
  const serverDiscId = interaction.guild?.id ?? interaction.user.id;
  let responseInteraction: ChatInputCommandInteraction | ModalSubmitInteraction = interaction;

  try {
    if (confirmation !== "yes") {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.data.import.cancelled_title",
        descriptionKey: "commands.data.import.cancelled_description",
        color: ColorCode.INFO,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const attachment = interaction.options.getAttachment("file", true);
    const response = await safeDownload(attachment.url, {
      maxSizeMB: IMPORT_LIMITS.MAX_DATA_IMPORT_SIZE_MB,
      timeoutMs: 10_000,
      knownSize: attachment.size,
    });
    if (!response.success || !response.buffer) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.data.import.invalid_file_title",
        descriptionKey: "commands.data.import.invalid_file_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const jsonData = JSON.parse(response.buffer.toString("utf8"));
    const validation = importRepository.validateImportFile(jsonData);
    if (!validation.valid || !validation.type || !validation.data) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.data.import.invalid_file_title",
        descriptionKey: "commands.data.import.invalid_file_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (validation.type !== "personal_memories" && validation.type !== "global_personal_memories") {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.data.import.invalid_file_title",
        descriptionKey: "commands.data.import.error_unknown_type",
        descriptionVars: { type: validation.type },
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let targetLineageId = 0;
    if (target === "persona") {
      const personas = await personaRepository.loadAllForServer(serverDiscId);
      const personaSelectOptions: SelectOption[] = personas
        .filter((persona) => persona.tomori_id !== undefined)
        .map((persona) => ({
          label: safeSelectOptionText(persona.tomori_nickname),
          value: persona.tomori_id?.toString() ?? "",
          description: persona.is_alter
            ? localizer(locale, "commands.data.import.alter_persona_description")
            : localizer(locale, "commands.data.import.main_persona_description"),
        }))
        .filter((option) => option.value !== "");

      const personaModalResult = await promptWithPaginatedModal(interaction, locale, {
        modalCustomId: PERSONA_MODAL_ID,
        modalTitleKey: "commands.data.import.persona_modal_title",
        components: [
          {
            customId: PERSONA_SELECT_ID,
            labelKey: "commands.data.import.persona_select_label",
            descriptionKey: "commands.data.import.persona_select_description",
            placeholder: "commands.data.import.persona_select_placeholder",
            required: true,
            options: personaSelectOptions,
          },
        ],
      });

      if (personaModalResult.outcome !== "submit") {
        log.info(`Memory personal import persona modal ${personaModalResult.outcome} for user ${interaction.user.id}`);
        return;
      }

      const modalSubmitInteraction = personaModalResult.interaction;
      if (!modalSubmitInteraction) return;
      responseInteraction = modalSubmitInteraction;

      const selectedPersonaId = personaModalResult.values?.[PERSONA_SELECT_ID];
      const selectedPersona = personas.find((persona) => persona.tomori_id?.toString() === selectedPersonaId) ?? null;
      if (!selectedPersona) {
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "general.errors.invalid_option_title",
          descriptionKey: "general.errors.invalid_option_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      targetLineageId = selectedPersona.persona_lineage_id ?? 0;
    }

    await responseInteraction.deferReply({ flags: MessageFlags.Ephemeral });

    const importResult = await importRepository.importPersonalMemories(
      interaction.user.id,
      (validation.data as PersonalMemoriesExportData).personal_memories,
      targetLineageId,
    );

    if (!importResult.success) {
      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.data.import.failed_title"))
            .setDescription(
              importResult.error
                ? localizer(locale, importResult.error)
                : localizer(locale, "commands.data.import.failed_description"),
            )
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    await responseInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.data.import.success_title"))
          .setDescription(
            localizer(locale, "commands.data.import.success_description", {
              type:
                target === "global"
                  ? localizer(locale, "commands.data.export.type_choice_global_personal_memories")
                  : localizer(locale, "commands.data.export.type_choice_persona_personal_memories"),
              memories_count: importResult.itemsImported?.memoriesCount || 0,
              config_count: 0,
            }),
          )
          .setColor(ColorCode.SUCCESS),
      ],
    });
  } catch (error) {
    log.error("Error executing /memory personal import:", error, {
      errorType: "CommandExecutionError",
      metadata: { commandName: "memory personal import", target },
    });

    if (!responseInteraction.replied && !responseInteraction.deferred) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

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
