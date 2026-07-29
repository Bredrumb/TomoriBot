import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";
import type { UserRow, ErrorContext, StPresetRow } from "@/types/db/schema";
import type { CheckboxGroupOption, ModalCheckboxGroupField } from "@/types/discord/modal";

// ─── Constants ───────────────────────────────────────────────────────

const MODAL_CUSTOM_ID = "st_preset_remove_modal";
const CHECKBOX_ID_PREFIX = "st_preset_remove_group";
const MAX_OPTIONS_PER_GROUP = 10;

// ─── Subcommand Configuration ────────────────────────────────────────

/**
 * Configure the /st-preset remove subcommand.
 * No options — lists all imported presets as a checklist; unchecked ones are deleted.
 * @param subcommand - The subcommand builder
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.st-preset.remove.description"));

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Build checkbox group components from the preset list.
 * Each group holds up to MAX_OPTIONS_PER_GROUP presets, all pre-checked.
 * The preset_id is stored as each option's value for direct DB lookup.
 *
 * @param presets - All presets for the server
 * @returns Array of ModalCheckboxGroupField components for the modal
 */
function buildPresetCheckboxGroups(presets: (StPresetRow & { preset_id: number })[]): ModalCheckboxGroupField[] {
  const groups: ModalCheckboxGroupField[] = [];

  for (let i = 0; i < presets.length; i += MAX_OPTIONS_PER_GROUP) {
    const chunk = presets.slice(i, i + MAX_OPTIONS_PER_GROUP);
    const groupIndex = Math.floor(i / MAX_OPTIONS_PER_GROUP);

    const options: CheckboxGroupOption[] = chunk.map((preset) => ({
      label: safeSelectOptionText(preset.preset_name, 50),
      value: preset.preset_id.toString(),
      description: preset.is_active ? "★ Active" : undefined,
      // Pre-check all so the user only needs to uncheck what they want removed
      default: true,
    }));

    groups.push({
      kind: "checkboxGroup",
      customId: `${CHECKBOX_ID_PREFIX}_${groupIndex}`,
      labelKey:
        groupIndex === 0
          ? "commands.st-preset.remove.checkbox_label"
          : "commands.st-preset.remove.checkbox_label_continued",
      descriptionKey: groupIndex === 0 ? "commands.st-preset.remove.checkbox_description" : undefined,
      minValues: 0,
      required: false,
      options,
    });
  }

  return groups;
}

// ─── Execution ───────────────────────────────────────────────────────

/**
 * Execute /st-preset remove.
 * Shows a checklist of all imported presets for this server.
 * Unchecking a preset removes it (cascade-deletes its nodes).
 * The active preset is indicated with ★ in the list.
 *
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database
 * @param locale - User's preferred locale
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // Verify server setup
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
    // Load all presets for this server (filter rows where preset_id is defined)
    const allPresets = (await presetRepository.loadPresetsForServer(tomoriState.server_id)).filter(
      (p): p is StPresetRow & { preset_id: number } => p.preset_id !== undefined,
    );

    if (allPresets.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.st-preset.remove.no_preset_title",
        descriptionKey: "commands.st-preset.remove.no_preset_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Build the checkbox groups (one group per 10 presets, all pre-checked)
    const checkboxGroups = buildPresetCheckboxGroups(allPresets);
    const groupCount = checkboxGroups.length;

    // Show the modal — no defer needed before modal display
    const modalResult = await promptWithRawModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.st-preset.remove.modal_title",
      components: checkboxGroups,
    });

    if (modalResult.outcome !== "submit") {
      log.info(`[ST Preset Remove] Modal ${modalResult.outcome} for user ${interaction.user.id}`);
      return;
    }

    // Collect all preset_ids that were still checked (= kept)
    // biome-ignore lint/style/noNonNullAssertion: Modal "submit" outcome guarantees interaction exists
    const modalSubmitInteraction = modalResult.interaction!;
    await modalSubmitInteraction.deferReply({ flags: MessageFlags.Ephemeral });

    const keptPresetIds = new Set<number>();
    for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
      const groupValues = modalResult.multiValues?.[`${CHECKBOX_ID_PREFIX}_${groupIndex}`] ?? [];
      for (const value of groupValues) {
        keptPresetIds.add(Number.parseInt(value, 10));
      }
    }

    // Determine which presets were unchecked (= to be removed)
    const presetsToRemove = allPresets.filter((p) => !keptPresetIds.has(p.preset_id));

    if (presetsToRemove.length === 0) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.st-preset.remove.no_removals_title",
        descriptionKey: "commands.st-preset.remove.no_removals_description",
        color: ColorCode.INFO,
      });
      return;
    }

    // Record whether the active preset is among those being removed
    const removingActivePreset = presetsToRemove.some((p) => p.is_active);

    // Delete each unchecked preset; track any failures
    let successCount = 0;
    const failedNames: string[] = [];
    for (const preset of presetsToRemove) {
      const deleted = await presetRepository.deletePreset(preset.preset_id, tomoriState.server_id);
      if (deleted) {
        successCount++;
        log.info(
          `[ST Preset Remove] Deleted preset "${preset.preset_name}" (ID: ${preset.preset_id}) for server_id ${tomoriState.server_id}`,
        );
      } else {
        failedNames.push(preset.preset_name);
        log.warn(`[ST Preset Remove] Failed to delete preset "${preset.preset_name}" (ID: ${preset.preset_id})`);
      }
    }

    // Report full failure early
    if (failedNames.length > 0 && successCount === 0) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.st-preset.remove.failed_title",
        descriptionKey: "commands.st-preset.remove.failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Auto-promote the most recently imported remaining preset when
    //     the active one was deleted and at least one other survives
    let promotedPreset: (StPresetRow & { preset_id: number }) | null = null;
    if (removingActivePreset) {
      const remainingPresets = allPresets.filter((p) => !keptPresetIds.has(p.preset_id) === false);
      // loadPresetsForServer orders by created_at ASC — last entry is most recent
      const candidate = remainingPresets[remainingPresets.length - 1] ?? null;
      if (candidate) {
        const promoted = await presetRepository.setActivePreset(tomoriState.server_id, candidate.preset_id);
        if (promoted) {
          promotedPreset = candidate;
          log.success(
            `[ST Preset Remove] Auto-promoted "${candidate.preset_name}" (ID: ${candidate.preset_id}) after active preset deletion`,
          );
        }
      }
    }

    // Build success reply with optional auto-promotion note
    const removedNames = presetsToRemove
      .filter((p) => !failedNames.includes(p.preset_name))
      .map((p) => `**${p.preset_name}**`)
      .join(", ");

    const promotedNote = promotedPreset
      ? localizer(locale, "commands.st-preset.remove.auto_promoted_note", { name: promotedPreset.preset_name })
      : "";

    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.st-preset.remove.success_title",
      descriptionKey: "commands.st-preset.remove.success_description",
      descriptionVars: {
        count: successCount.toString(),
        names: removedNames,
        promoted_note: promotedNote,
      },
      color: failedNames.length > 0 ? ColorCode.WARN : ColorCode.SUCCESS,
    });

    log.success(
      `[ST Preset Remove] Removed ${successCount} preset(s) for server_id ${tomoriState.server_id}${failedNames.length > 0 ? ` (${failedNames.length} failed)` : ""}`,
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: null,
      personaId: null,
      errorType: "CommandExecutionError",
      metadata: { command: "st-preset remove" },
    };
    await log.error("Error executing /st-preset remove", error as Error, context);

    await interaction.followUp({
      content: localizer(locale, "general.errors.unknown_error_description"),
      flags: MessageFlags.Ephemeral,
    });
  }
}
