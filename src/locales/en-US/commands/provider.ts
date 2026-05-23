// locales/en-US/commands/provider.ts

export default {
  provider: {
    description: `Manage saved provider configurations`,
    add: {
      description: `Add or update a saved provider configuration without switching to it.`,
      modal_title: `Add Saved Provider`,
      success_title: `Provider Saved`,
      success: `Saved credentials for **{provider}**. Select it as your text model with \`/config model text\`, or use \`/config model embedding|image|video|vision\` for other capabilities.`,
      updated_existing: `Updated the saved credentials for **{provider}**.`,
      custom_moved_title: `Custom Endpoint Moved`,
      custom_moved_description: `The legacy Custom Endpoint provider flow is deprecated. Register the endpoint with {custom_models_add_command}, then activate it with {model_text_command}. Use {help_custom_models_command} for the updated help page.`,
      provider_label: `Target Provider`,
      provider_description: `Choose the provider to add or rotate credentials for.`,
      provider_placeholder: `Select a provider...`,
      already_existing_suffix: `Already Existing`,
      already_existing_description: `This provider is already configured. Submit again to update credentials.`,
      custom_deprecated_description: `Moved to /config custom-endpoint add.`,
      api_key_description: `This key will be securely stored. Leave it blank if you selected Custom Endpoint.`,
      api_key_label: `API Key`,
      api_key_placeholder: `Do NOT share this key with anyone`,
    },
    remove: {
      description: `Remove a saved provider configuration.`,
      no_saved_title: `No Saved Configs`,
      no_saved_description: `There are no saved provider configurations to remove. Add a provider first with \`/config provider add\`.`,
      picker_title: `Remove Provider Configuration`,
      picker_description: `Select a provider to remove. This will delete the stored API key and reset any dependent model selections.`,
      active_provider_note: `**{provider}** is your active **text model** provider and cannot be removed while in use. Switch to a different provider with \`/config model text\` first.`,
      custom_endpoint_note: `To remove custom endpoints (e.g. ElevenLabs, local servers), use \`/config custom-endpoint remove\` instead.`,
      success_title: `Saved Config Removed`,
      success_description: `The saved configuration for **{provider}** has been removed. Use \`/config provider add\` to register it again.`,
      auto_reassigned_description: `The saved configuration for **{provider}** has been removed.

Updated dependent selections:
{reassignments}`,
    },
    "api-key": {
      description: `Manage AI provider API keys`,
      set: {
        no_providers_title: `No Providers Available`,
        no_providers_description: `No AI providers are available in the database. Please report through \`/support discord\`.`,
        invalid_key_title: `Invalid API Key Format`,
        invalid_key_description: `The provided API key seems too short or invalid. Please provide a valid key.`,
        unsupported_provider_title: `Unsupported Provider`,
        unsupported_provider_description: `The provider "{provider}" is not currently supported for API key validation.`,
        validation_error_title: `Validation Error`,
        validation_error_description: `An error occurred while validating the API key. Please try again.`,
        key_validation_failed_title: `API Key Validation Failed`,
        key_validation_failed_description: `The provided API key is not valid for {provider}. Please check the key and try again.`,
      },
      rotation: {
        description: `Manage API key rotation for load balancing and failover.`,
        action_description: `Choose an action: add a key or purge all keys`,
        action_add: `Add Key`,
        action_purge: `Purge All Keys`,
        key_description: `The API key to add to the rotation pool (required for add action)`,
        no_main_key_title: `No Main API Key`,
        no_main_key_description: `A saved provider with active credentials is required before adding rotation keys. Add one with \`/config provider add\`.`,
        custom_provider_title: `Not Supported`,
        custom_provider_description: `API key rotation is not supported for custom providers.`,
        key_required_title: `Key Required`,
        key_required_description: `Please provide an API key when using the "add" action.`,
        add_success_title: `Rotation Key Added`,
        add_success_description: `Successfully added a new API key to the rotation pool. You now have **{count}** rotation key(s) for {provider}. Keys will be used in round-robin order with automatic failover.`,
        purge_success_title: `Rotation Keys Purged`,
        purge_success_description: `Successfully removed **{count}** key(s) from the rotation pool. Only your main API key will be used.`,
        no_keys_title: `No Rotation Keys`,
        no_keys_description: `There are no rotation keys to purge. Only your main API key is configured.`,
      },
    },
    "custom-endpoint": {
      description: `Manage labeled custom endpoints.`,
      add: {
        description: `Register one capability under a labeled custom endpoint.`,
      },
      edit: {
        description: `Replace fields on a registered custom endpoint.`,
      },
      remove: {
        description: `Remove selected capabilities from a labeled custom endpoint.`,
      },
    },
  },
};
