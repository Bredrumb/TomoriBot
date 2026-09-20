export default {
  teach: {
    sampledialogue: {
      description: `Add a sample user/bot dialogue pair to as an example for how I should respond.`,
    },
    attribute: {
      description: `Add a personality attribute describing me for this server.`,
    },
    document: {
      description: `Upload a document for me to reference using Retrieval-Augmented Generation.`,
      main_persona_description: `Main Persona`,
      alter_persona_description: `Alter Persona`,
    },
    personaprompt: {
      description: `Set a persona-specific prompt appended after sysprompt`,
      modal_title: `Set Persona Prompt`,
      part1_placeholder: `Example: Speak like a veteran tactician, concise and calm.`,
      part2_placeholder: `Additional persona instructions...`,
      part3_placeholder: `More persona instructions...`,
      part4_placeholder: `Final persona instructions...`,
      success_title: `Persona Prompt Updated`,
      success_description: `Updated persona prompt for "{persona_name}".`,
    },
    memory: {
      description: `Manage my memories`,
      personal: {
        description: `Add a personal memory of you I can remember across any server.`,
      },
      server: {
        description: `Add a server memory to my knowledge base.`,
      },
    },
  },
};
