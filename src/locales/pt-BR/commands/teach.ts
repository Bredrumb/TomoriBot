export default {
  teach: {
    sampledialogue: {
      description: "Adicione um exemplo de diálogo usuário/bot para mostrar como devo responder.",
    },
    attribute: {
      description: "Adicione um atributo de personalidade me descrevendo para este servidor.",
    },
    document: {
      description: "Envie um documento para eu consultar usando Geração Aumentada por Recuperação.",
      main_persona_description: "Persona Principal",
      alter_persona_description: `Alterar Persona`,
    },
    personaprompt: {
      description: "Defina um prompt específico da persona adicionado após o sysprompt",
      modal_title: "Definir Prompt da Persona",
      part1_placeholder: "Exemplo: Fale como um estrategista veterano, conciso e calmo.",
      part2_placeholder: "Instruções adicionais da persona...",
      part3_placeholder: "Mais instruções da persona...",
      part4_placeholder: "Instruções finais da persona...",
      success_title: "Prompt da Persona Atualizado",
      success_description: 'Prompt da persona atualizado para "{persona_name}".',
    },
    memory: {
      description: "Gerenciar minhas memórias",
      personal: {
        description: "Adicione uma memória pessoal sua que eu possa lembrar em qualquer servidor.",
      },
      server: {
        description: "Adicione uma memória do servidor à minha base de conhecimento.",
      },
    },
  },
};
