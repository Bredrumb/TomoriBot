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

const MODAL_CUSTOM_ID = "config_prompt_preset_modal";
const PRESET_SELECT_ID = "preset_select";

/**
 * Configure the slash command subcommand metadata
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
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const serverId = interaction.guildId ?? interaction.user.id;
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
    const presets = await configRepository.loadSystemPromptPresets();

    if (!presets || presets.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.prompt.preset.no_presets_title",
        descriptionKey: "commands.config.prompt.preset.no_presets_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const presetSelectOptions: SelectOption[] = presets.map((preset: SystemPromptPresetRow) => {
      const description =
        locale === "ja" && preset.ja_description ? preset.ja_description : preset.system_prompt_preset_desc;

      return {
        label: safeSelectOptionText(preset.system_prompt_preset_name),
        value: safeSelectOptionText(preset.system_prompt_preset_name),
        description: safeSelectOptionText(description),
      };
    });

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

    if (modalResult.outcome !== "submit") {
      log.info(`Preset selection modal ${modalResult.outcome}`);
      return;
    }

    // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
    const modalSubmitInteraction = modalResult.interaction!;
    // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
    const selectedPresetName = modalResult.values![PRESET_SELECT_ID];

    const selectedPreset = presets.find(
      (preset: SystemPromptPresetRow) => preset.system_prompt_preset_name === selectedPresetName,
    );

    if (!selectedPreset) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.config.prompt.preset.invalid_preset_title",
        descriptionKey: "commands.config.prompt.preset.invalid_preset_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

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
