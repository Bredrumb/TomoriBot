import type { ButtonInteraction, ChatInputCommandInteraction, ModalSubmitInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import type { SelectOption } from "@/types/discord/modal";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";

/** Modal field id for the custom-model string select. */
const CUSTOM_MODEL_SELECT_ID = "custom_model_select";

/** One selectable model under a custom endpoint label+capability. */
export interface CustomModelChoice<T> {
  /** The underlying model row returned to the caller on selection. */
  model: T;
  /** Unique select value — the model codename or id string. */
  value: string;
  /** User-facing option label (typically the display name). */
  label: string;
  /** Secondary description line shown under the label. */
  description: string;
}

/**
 * Outcome of a custom-model selection.
 *
 * `submitInteraction` is the modal submit interaction when a picker was shown (2+ models), or null
 * when a single model was auto-selected without a modal — in which case the caller should reply on
 * the original interaction.
 */
export interface CustomModelSelection<T> {
  model: T;
  submitInteraction: ModalSubmitInteraction | null;
}

/**
 * Prompts the user to choose among a custom endpoint's models for one capability.
 *
 * A custom endpoint label may now host several models of the same capability. When only one exists
 * it is returned immediately without a modal (preserving the previous one-tap UX); when several
 * exist a string-select modal is shown. Returns null when the modal is dismissed. Callers must
 * handle the empty (no models) case before calling.
 *
 * @param params - Picker inputs: source interaction, locale, choices, and modal/select locale keys
 */
export async function promptCustomModelSelection<T>(params: {
  interaction: ChatInputCommandInteraction | ButtonInteraction;
  locale: string;
  choices: CustomModelChoice<T>[];
  modalCustomId: string;
  modalTitleKey: string;
  selectLabelKey: string;
  selectDescriptionKey: string;
  selectPlaceholderKey: string;
}): Promise<CustomModelSelection<T> | null> {
  // 1. Single model: skip the modal entirely.
  if (params.choices.length === 1) {
    return { model: params.choices[0].model, submitInteraction: null };
  }

  // 2. Several models: present a string-select modal (auto-deferred ephemeral).
  const options: SelectOption[] = params.choices.map((choice) => ({
    label: safeSelectOptionText(choice.label),
    value: safeSelectOptionText(choice.value),
    description: safeSelectOptionText(choice.description),
  }));

  const result = await promptWithRawModal(
    params.interaction,
    params.locale,
    {
      modalCustomId: params.modalCustomId,
      modalTitleKey: params.modalTitleKey,
      components: [
        {
          customId: CUSTOM_MODEL_SELECT_ID,
          labelKey: params.selectLabelKey,
          descriptionKey: params.selectDescriptionKey,
          placeholder: params.selectPlaceholderKey,
          required: true,
          options,
        },
      ],
    },
    MessageFlags.Ephemeral,
  );

  if (result.outcome !== "submit" || !result.interaction || !result.values) {
    return null;
  }

  // 3. Match the submitted value back to a choice (compare against the safe-truncated value).
  const value = result.values[CUSTOM_MODEL_SELECT_ID];
  const picked = params.choices.find((choice) => safeSelectOptionText(choice.value) === value);
  if (!picked) {
    return null;
  }

  return { model: picked.model, submitInteraction: result.interaction };
}
