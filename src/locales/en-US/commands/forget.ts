export default {
  forget: {
    sampledialogue: {
      description: `Remove a sample user/bot dialogue pair from my memory.`,
    },
    attribute: {
      description: `Remove a personality attribute from my memory.`,
    },
    document: {
      description: `Remove a document from the server knowledge base.`,
    },
    personaprompt: {
      description: `Clear a persona-specific prompt`,
      no_prompt_title: `No Persona Prompt`,
      no_prompt_description: `There is no persona-specific prompt to clear. Set one with \`/config\` > Persona > Advanced.`,
      success_title: `Persona Prompt Cleared`,
      success_description: `Cleared persona prompt for "{persona_name}".`,
      success_description_with_prompt: `Cleared persona prompt for "{persona_name}". Here it is in case you want to keep a copy:
\`\`\`
{removed_prompt}
\`\`\``,
    },
    memory: {
      personal: {
        description: `Remove a personal memory.`,
      },
      server: {
        description: `Remove a server memory from my knowledge.`,
      },
    },
  },
};
