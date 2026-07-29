/**
 * Command: /config system-prompt preset
 * Allows users to apply a preset system prompt from pre-made options
 */

import type { ChatInputCommandInteraction, Client } from "discord.js";
import { MessageFlags, SlashCommandSubcommandBuilder } from "discord.js";
import type { UserRow, SystemPromptPresetRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { configRepository } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { log, ColorCode } from "@/utils/misc/logger";
import {
  buildTextPreview,
  CONFIRMATION_PREVIEW_BUDGET,
  textPreviewFooterKey,
  textPreviewFooterVars,
} from "@/utils/text/textPreview";

// Modal configuration constants
const MODAL_CUSTOM_ID = "config_prompt_preset_modal";
const PRESET_SELECT_ID = "preset_select";

/**
 * Configure the slash command subcommand metadata
 * @returns Configured SlashCommandSubcommandBuilder
 */
export function configureSubcommand(): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName("preset")
    .setDescription("Apply a preset system prompt")
    .setDescriptionLocalizations({
      // Localizations auto-applied by commandLoader.ts
    });
}

/**
 * Execute the /config system-prompt preset command
 * @param _client - Discord client (unused)
 * @param interaction - Chat input command interaction
 * @param _userData - User data from database
 * @param locale - User's locale for localization
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  // Validate interaction channel (before try-catch)
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Determine server context (guild or DM)
  const serverId = interaction.guildId ?? interaction.user.id;
  const tomoriState = await getCachedTomoriState(serverId);

  // Validate tomoriState exists (before try-catch)
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
    // Load available system prompt presets
    const presets = await configRepository.loadSystemPromptPresets();

    // Check if presets are available
    if (!presets || presets.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.prompt.preset.no_presets_title",
        descriptionKey: "commands.config.prompt.preset.no_presets_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Create preset options for the select menu with locale-specific descriptions
    const presetSelectOptions: SelectOption[] = presets.map((preset: SystemPromptPresetRow) => {
      // Determine which description to use based on user's locale
      const description =
        locale === "ja" && preset.ja_description ? preset.ja_description : preset.system_prompt_preset_desc;

      return {
        label: safeSelectOptionText(preset.system_prompt_preset_name),
        value: safeSelectOptionText(preset.system_prompt_preset_name),
        description: safeSelectOptionText(description),
      };
    });

    // Show the modal with preset selection
    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.config.prompt.preset.modal_title",
        components: [
          {
            customId: PRESET_SELECT_ID,
            labelKey: "commands.config.prompt.preset.selection_label",
            placeholder: "commands.config.prompt.preset.selection_placeholder",
            required: true,
            options: presetSelectOptions,
          },
        ],
      },
      MessageFlags.Ephemeral, // Auto-defer with ephemeral flag
    );

    // Handle modal outcome
    if (modalResult.outcome !== "submit") {
      log.info(`Preset selection modal ${modalResult.outcome}`);
      return;
    }

    // Extract values from the modal
    // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
    const modalSubmitInteraction = modalResult.interaction!;
    // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
    const selectedPresetName = modalResult.values![PRESET_SELECT_ID];

    // Find the selected preset
    const selectedPreset = presets.find(
      (preset: SystemPromptPresetRow) => preset.system_prompt_preset_name === selectedPresetName,
    );

    // Validate selection
    if (!selectedPreset) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.config.prompt.preset.invalid_preset_title",
        descriptionKey: "commands.config.prompt.preset.invalid_preset_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Update database with the preset prompt text
    await configRepository.updateChatConfig(tomoriState.server_id, {
      system_prompt: selectedPreset.preset_prompt_text,
    });

    // Invalidate cache so next message gets fresh config
    invalidateTomoriStateCache(serverId);

    // Success response with a fence-safe preview. The footer only appears
    //     when the preset text actually exceeded the preview width.
    const preview = buildTextPreview(selectedPreset.preset_prompt_text, CONFIRMATION_PREVIEW_BUDGET);
    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.config.prompt.preset.success_title",
      descriptionKey: "commands.config.prompt.preset.success_description",
      descriptionVars: {
        presetName: selectedPreset.system_prompt_preset_name,
        preview: preview.text,
      },
      footerKey: textPreviewFooterKey(preview),
      footerVars: textPreviewFooterVars(preview),
      color: ColorCode.SUCCESS,
      flags: MessageFlags.Ephemeral,
    });

    log.info(`System prompt preset "${selectedPreset.system_prompt_preset_name}" applied for server ${serverId}`);
  } catch (error) {
    log.error("Failed to apply system prompt preset:", error as Error);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
