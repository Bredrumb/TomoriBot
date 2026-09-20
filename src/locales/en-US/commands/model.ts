export default {
  // The config panel reads several strings from this namespace even though every `/model` leaf but
  // `override remove` is dissolved, so pruning it wholesale breaks the Channels and Models pages.
  model: {
    description: `Manage this server's default AI models.`,
    providerPicker: {
      no_providers_title: `No Saved Providers`,
      no_providers_description: `No saved providers are available for this capability. Add one with \`/providers\` first.`,
    },
    text: {
      no_models_title: `No Models Found`,
      no_models_description: `Could not load available AI models from the database.`,
      invalid_model_title: `Invalid Model`,
      invalid_model_description: `The selected model name is not valid or available.`,
      success_title: `Model Updated`,
      scope_set_persona_success: `Model for **{persona}** set to **{model}**`,
    },
    fallback: {
      custom_provider_label: `Custom`,
      no_models_description: `There are no models available for the selected provider.`,
    },
    override: {
      remove: {
        description: `Remove channel and persona model overrides.`,
        modal_title: `Remove Model Overrides`,
        channel_unknown: `Unknown`,
        channel_checkbox_label: `Channel Overrides`,
        channel_checkbox_label_continued: `Channel Overrides (Continued)`,
        channel_checkbox_description: `Uncheck any channel overrides you want to remove. Edited in /config > Channels > Overrides.`,
        persona_checkbox_label: `Persona Overrides`,
        persona_checkbox_label_continued: `Persona Overrides (Continued)`,
        persona_checkbox_description: `Uncheck any persona overrides you want to remove. Edited in /config > Persona > Overrides.`,
        mixed_checkbox_label: `Channel & Persona Overrides`,
        mixed_checkbox_label_continued: `Channel & Persona Overrides (Continued)`,
        mixed_checkbox_description: `Uncheck any channel or persona overrides you want to remove.`,
        none_title: `No Model Overrides`,
        none_description: `This server has no channel or persona model overrides configured.`,
        no_removals_title: `No Model Overrides Removed`,
        no_removals_description: `No overrides were unchecked. Model overrides remain unchanged.`,
        success_title: `Model Overrides Updated`,
        success_description: `Removed the following model overrides.
{removed_overrides}`,
        page_select_prompt: `Found {total} model overrides. Select a batch to remove:`,
        page_select_prompt_capped: `Found {total} model overrides. The first {shown} are displayed across 25 batches; remove some to reach the rest.`,
      },
      description: `Manage channel and persona model overrides.`,
    },
  },
};
