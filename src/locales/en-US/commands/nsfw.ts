// locales/en-US/commands/nsfw.ts

export default {
  nsfw: {
    description: `Age-restricted commands and settings.`,
    jailbreaks: {
      description: `Manage optional jailbreak behaviors for my prompts on this server.`,
      modal_title: `Manage Jailbreak Strategies`,
      checkbox_label: `Enabled Jailbreak Strategies`,
      checkbox_description: `Checked strategies stay enabled. Unchecked strategies are disabled.`,
      injection_option: `Prompt Injection (18+ acknowledgement)`,
      unicode_spaces_option: `Unicode Space Replacement`,
      sanitize_option: `Sensitive Word Sanitization`,
      no_changes_title: `No Changes Made`,
      no_changes_description: `The jailbreak strategy checklist was left unchanged.`,
      success_title: `Jailbreak Strategies Updated`,
      success_description: `Updated your jailbreak strategy settings. **{enabled_count}** option(s) are currently enabled.`,
    },
  },
};
