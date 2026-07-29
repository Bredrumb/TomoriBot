import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";
import type { UserRow, ErrorContext, StPresetRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";

const MODAL_CUSTOM_ID = "st_preset_switch_modal";
const PRESET_SELECT_ID = "preset_select";

/**
 * Configure the /st-preset switch subcommand.
 * No options — lists all imported presets for selection.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("switch").setDescription(localizer("en-US", "commands.st-preset.switch.description"));

/**
 * Execute /st-preset switch.
 * Shows a paginated modal listing all imported presets for this server.
 * The selected preset becomes the new active preset; all others are deactivated.
 *
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const serverId = interaction.guild?.id ?? interaction.user.id;
  const tomoriState = await getCachedTomoriState(serverId);
  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    const allPresets = (await presetRepository.loadPresetsForServer(tomoriState.server_id)).filter(
      (p): p is StPresetRow & { preset_id: number } => p.preset_id !== undefined,
    );

    if (allPresets.length === 0) {
      const stPresetImportMention = commandRegistry.getCommandMention("st-preset", "import");
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.st-preset.switch.no_presets_title",
        descriptionKey: "commands.st-preset.switch.no_presets_description",
        descriptionVars: { stPresetImport: stPresetImportMention },
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (allPresets.length === 1) {
      const stPresetImportMention = commandRegistry.getCommandMention("st-preset", "import");
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.st-preset.switch.single_preset_title",
        descriptionKey: "commands.st-preset.switch.single_preset_description",
        descriptionVars: { stPresetImport: stPresetImportMention },
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const selectOptions: SelectOption[] = allPresets.map((preset) => ({
      label: safeSelectOptionText(preset.preset_name),
      value: preset.preset_id.toString(),
      description: preset.is_active ? "★ Active" : undefined,
    }));

    const modalResult = await promptWithPaginatedModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.st-preset.switch.modal_title",
      components: [
        {
          customId: PRESET_SELECT_ID,
          labelKey: "commands.st-preset.switch.select_label",
          placeholder: "commands.st-preset.switch.select_placeholder",
          required: true,
          options: selectOptions,
        },
      ],
    });

    if (modalResult.outcome !== "submit") {
      log.info(`[ST Preset Switch] Modal ${modalResult.outcome} for user ${interaction.user.id}`);
      return;
    }

    // biome-ignore lint/style/noNonNullAssertion: Modal "submit" outcome guarantees interaction and values exist
    const modalSubmitInteraction = modalResult.interaction!;
    if (!modalSubmitInteraction.deferred && !modalSubmitInteraction.replied) {
      await modalSubmitInteraction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    // biome-ignore lint/style/noNonNullAssertion: Modal "submit" outcome guarantees values exist
    const selectedPresetId = Number.parseInt(modalResult.values![PRESET_SELECT_ID], 10);
    const selectedPreset = allPresets.find((p) => p.preset_id === selectedPresetId) ?? null;

    if (!selectedPreset) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const activated = await presetRepository.setActivePreset(tomoriState.server_id, selectedPreset.preset_id);
    if (!activated) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.st-preset.switch.success_title",
      descriptionKey: "commands.st-preset.switch.success_description",
      descriptionVars: { name: selectedPreset.preset_name },
      color: ColorCode.SUCCESS,
    });

    log.success(
      `[ST Preset Switch] Activated preset "${selectedPreset.preset_name}" (ID: ${selectedPreset.preset_id}) for server_id ${tomoriState.server_id}`,
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: null,
      personaId: null,
      errorType: "CommandExecutionError",
      metadata: { command: "st-preset switch" },
    };
    await log.error("Error executing /st-preset switch", error as Error, context);

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({
        content: localizer(locale, "general.errors.unknown_error_description"),
      });
    } else {
      await interaction.reply({
        content: localizer(locale, "general.errors.unknown_error_description"),
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
