export default {
  forget: {
    sampledialogue: {
      description: "Remova um exemplo de diálogo usuário/bot da minha memória.",
    },
    attribute: {
      description: "Remova um atributo de personalidade da minha memória.",
    },
    document: {
      description: "Remova um documento da base de conhecimento do servidor.",
    },
    personaprompt: {
      description: "Limpar um prompt específico da persona",
      no_prompt_title: "Nenhum Prompt da Persona",
      no_prompt_description: "Não há nenhum prompt específico da persona para limpar. Defina um em `/config` > Persona > Avançado.",
      success_title: "Prompt da Persona Limpo",
      success_description: "Prompt da persona limpo para \"{persona_name}\".",
      success_description_with_prompt: `Prompt da persona limpo para "{persona_name}". Aqui está caso você queira manter uma cópia:
\`\`\`
{removed_prompt}
\`\`\``,
    },
    memory: {
      personal: {
        description: "Remova uma memória pessoal.",
      },
      server: {
        description: "Remova uma memória do servidor do meu conhecimento.",
      },
    },
  },
};
