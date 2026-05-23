// locales/en-US/commands/optional-key.ts

export default {
  "optional-key": {
    description: `Manage optional service API keys`,
    brave: {
      description: `Manage Brave Search API key`,
      set: {
        description: `Set the Brave Search API key for this server.`,
        key_description: `Your Brave Search API key.`,
        invalid_key_title: `Invalid API Key Format`,
        invalid_key_description: `The provided API key seems too short or invalid. Please provide a valid key.`,
        key_validation_failed_title: `Brave API Key Validation Failed`,
        key_validation_failed_description: `The provided Brave Search API key is not valid. Please check the key and try again.`,
        success_title: `Brave API Key Set`,
        success_description: `The Brave Search API key has been successfully validated, encrypted, and saved.

⚠️ **Important:** Brave provides $5 in free monthly credits wherein usage beyond that is billed. To avoid unexpected charges, set a $5 usage limit in your [Brave usage limits dashboard](https://api-dashboard.search.brave.com/app/subscriptions/usage-limits).`,
      },
      remove: {
        description: `Remove the currently configured Brave Search API key.`,
        no_key_title: `No Brave API Key Set`,
        no_key_description: `There is no Brave Search API key currently configured to remove.`,
        success_title: `Brave API Key Removed`,
        success_description: `The Brave Search API key has been successfully removed.`,
      },
    },
  },
};
