import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { loadNaiPresetsForModel } from "@/utils/db/repositories";
import { applyNaiPreset } from "@/utils/db/repositories";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed, promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/interactionHelper";
import type { UserRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";

/** Custom ID for the preset selection modal */
const PRESET_MODAL_CUSTOM_ID = "nai_preset_text_modal";

/** Custom ID for the preset select component inside the modal */
const PRESET_SELECT_ID = "preset_select";

/** NAI model codenames that support sampling presets */
const NAI_PRESET_MODELS = new Set(["kayra-v1", "llama-3-erato-v1"]);

/** Maps a supported model codename to its preset model_target category */
const MODEL_TARGET_MAP: Record<string, "kayra" | "erato"> = {
  "kayra-v1": "kayra",
  "llama-3-erato-v1": "erato",
};

// Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("text").setDescription(localizer("en-US", "commands.novelai.preset.text.description"));

/**
 * Applies a NovelAI sampling preset to this server's text generation config.
 * Only available when the provider is NovelAI and the model is Kayra or Erato.
 *
 * @param _client - Discord client instance (unused)
 * @param interaction - Command interaction
 * @param userData - Requesting user's DB row
 * @param locale - User's preferred locale
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // 1. Guild-only guard
  if (!interaction.guild) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 2. Load server state
  const tomoriState = await getCachedTomoriState(interaction.guild.id);
  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 3. Guard: must be using the NovelAI provider
  if (tomoriState.llm.llm_provider.toLowerCase() !== "novelai") {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.novelai.preset.text.not_novelai_title",
      descriptionKey: "commands.novelai.preset.text.not_novelai_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 4. Guard: must be on a preset-compatible model (Kayra or Erato)
  const modelCodename = tomoriState.llm.llm_codename;
  if (!NAI_PRESET_MODELS.has(modelCodename)) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.novelai.preset.text.not_kayra_erato_title",
      descriptionKey: "commands.novelai.preset.text.not_kayra_erato_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 5. Determine model target category and load available presets
  const modelTarget = MODEL_TARGET_MAP[modelCodename] ?? "kayra";
  const presets = await loadNaiPresetsForModel(modelTarget);
  if (presets.length === 0) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    log.error(`No NAI presets found for model target "${modelTarget}" — was seed.sql run?`);
    return;
  }

  // 6. Build select options — one per preset with locale-appropriate description
  const isJapanese = userData.language_pref.toLowerCase().startsWith("ja");
  const presetOptions: SelectOption[] = presets.map((preset) => {
    const desc = isJapanese ? preset.ja_preset_desc : preset.preset_desc;
    return {
      label: safeSelectOptionText(preset.preset_name),
      value: preset.preset_name,
      description: safeSelectOptionText(desc),
    };
  });

  // 7. Show the modal — handles >25 options with automatic page navigation
  const modalResult = await promptWithPaginatedModal(interaction, locale, {
    modalCustomId: PRESET_MODAL_CUSTOM_ID,
    modalTitleKey: "commands.novelai.preset.text.modal_title",
    components: [
      {
        customId: PRESET_SELECT_ID,
        labelKey: "commands.novelai.preset.text.select_label",
        descriptionKey: "commands.novelai.preset.text.select_description",
        placeholder: "commands.novelai.preset.text.select_placeholder",
        required: true,
        options: presetOptions,
      },
    ],
  });

  // 8. Silently return on cancel or timeout — no message needed
  if (modalResult.outcome !== "submit") return;

  // biome-ignore lint/style/noNonNullAssertion: submit outcome guarantees these values exist
  const modalInteraction = modalResult.interaction!;
  // biome-ignore lint/style/noNonNullAssertion: submit outcome guarantees these values exist
  const selectedPresetName = modalResult.values![PRESET_SELECT_ID];

  // 9. Find the chosen preset in the loaded list
  const chosenPreset = presets.find((p) => p.preset_name === selectedPresetName);
  if (!chosenPreset) {
    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "general.errors.invalid_option_title",
      descriptionKey: "general.errors.invalid_option_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // 10. Apply the preset — writes schema fields to tomori_configs + nai_preset_name
  const updated = await applyNaiPreset(tomoriState.server_id, chosenPreset, modelCodename);
  if (!updated) {
    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // 11. Invalidate cache so the next generation picks up the new preset
  invalidateTomoriStateCache(interaction.guild.id);

  // 12. Confirm success
  await replyInfoEmbed(modalInteraction, locale, {
    titleKey: "commands.novelai.preset.text.success_title",
    descriptionKey: "commands.novelai.preset.text.success_description",
    descriptionVars: { preset_name: chosenPreset.preset_name },
    color: ColorCode.SUCCESS,
  });
}
