import type {
  ChatInputCommandInteraction,
  Client,
  ModalSubmitInteraction,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { AttachmentBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import type { UserRow } from "@/types/db/schema";
import { exportRepository, personaRepository } from "@/utils/db/repositories";

import type { SelectOption } from "@/types/discord/modal";

const PERSONA_MODAL_ID = "memory_personal_export_persona_modal";
const PERSONA_SELECT_ID = "persona_select";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("export")
    .setDescription(localizer("en-US", "commands.memory.personal.export.description"))
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.memory.personal.export.scope_description"))
        .setRequired(true)
        .addChoices(
          {
            name: localizer("en-US", "commands.memory.personal.export.scope_choice_persona"),
            value: "persona",
          },
          {
            name: localizer("en-US", "commands.memory.personal.export.scope_choice_global"),
            value: "global",
          },
        ),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  const scope = interaction.options.getString("scope", true);
  const serverDiscId = interaction.guild?.id ?? interaction.user.id;
  let responseInteraction: ChatInputCommandInteraction | ModalSubmitInteraction = interaction;

  try {
    let exportResult: Awaited<ReturnType<typeof exportRepository.exportGlobalPersonalMemories>>;
    let typeLabel = localizer(locale, "commands.data.export.type_choice_global_personal_memories");
    let filename = `tomori-global-personal-memories-${interaction.user.id}-${Date.now()}.json`;

    if (scope === "persona") {
      const personas = await personaRepository.loadAllForServer(serverDiscId);
      const personaSelectOptions: SelectOption[] = personas
        .filter((persona) => persona.tomori_id !== undefined)
        .map((persona) => ({
          label: safeSelectOptionText(persona.tomori_nickname),
          value: persona.tomori_id?.toString() ?? "",
          description: persona.is_alter
            ? localizer(locale, "commands.data.export.alter_persona_description")
            : localizer(locale, "commands.data.export.main_persona_description"),
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
        modalCustomId: PERSONA_MODAL_ID,
        modalTitleKey: "commands.data.export.persona_modal_title",
        components: [
          {
            customId: PERSONA_SELECT_ID,
            labelKey: "commands.data.export.persona_select_label",
            descriptionKey: "commands.data.export.persona_select_description",
            placeholder: "commands.data.export.persona_select_placeholder",
            required: true,
            options: personaSelectOptions,
          },
        ],
      });

      if (personaModalResult.outcome !== "submit") {
        log.info(`Memory personal export persona modal ${personaModalResult.outcome} for user ${interaction.user.id}`);
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

      exportResult = await exportRepository.exportPersonaPersonalMemories(
        interaction.user.id,
        selectedPersona.persona_lineage_id ?? 0,
      );
      typeLabel = localizer(locale, "commands.data.export.type_choice_persona_personal_memories");
      const safeSlug = selectedPersona.tomori_nickname.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 32);
      filename = `tomori-personal-memories-${safeSlug}-${interaction.user.id}-${Date.now()}.json`;
    } else {
      exportResult = await exportRepository.exportGlobalPersonalMemories(interaction.user.id);
    }

    await responseInteraction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!exportResult.success || !exportResult.data) {
      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.data.export.failed_title"))
            .setDescription(
              exportResult.error
                ? localizer(locale, exportResult.error)
                : localizer(locale, "commands.data.export.failed_description"),
            )
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify(exportResult.data, null, 2), "utf-8"), {
      name: filename,
    });

    try {
      await interaction.user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.data.export.dm_title"))
            .setDescription(localizer(locale, "commands.data.export.dm_description", { type: typeLabel }))
            .setColor(ColorCode.INFO),
        ],
        files: [attachment],
      });

      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.data.export.success_title"))
            .setDescription(localizer(locale, "commands.data.export.success_description", { type: typeLabel }))
            .setColor(ColorCode.SUCCESS),
        ],
      });
    } catch (dmError) {
      log.warn(`Failed to send memory personal export DM to user ${interaction.user.id}:`, dmError as Error);
      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.data.export.dm_failed_title"))
            .setDescription(localizer(locale, "commands.data.export.dm_failed_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
    }
  } catch (error) {
    log.error("Error executing /memory personal export:", error, {
      errorType: "CommandExecutionError",
      metadata: { commandName: "memory personal export", scope },
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
