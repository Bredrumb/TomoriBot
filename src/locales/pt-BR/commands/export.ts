export default {
  export: {
    description: "Exporte sua configuração ou memórias como um arquivo portátil.",
    config: {
      description: "Exporte a configuração deste servidor como um arquivo portátil.",
    },
    memories: {
      description: "Exporte memórias como um arquivo portátil.",
      scope_description: "Quais memórias exportar.",
      persona_description: "A persona para qual exportar memórias. Usado apenas no escopo Persona Selecionada.",
      scope_choice_main: "Persona Principal",
      scope_choice_persona: "Persona Selecionada",
      scope_choice_all: "Todas as Personas",
    },
    personal: {
      description: "Exporte a configuração ou memórias que sua conta possui.",
      config: {
        description: "Exporte sua configuração pessoal como um arquivo portátil.",
      },
      memories: {
        description: "Exporte as memórias que sua conta possui como um arquivo portátil.",
        scope_description: "Quais das suas memórias exportar.",
        persona_description: "A persona para qual exportar memórias. Usado apenas no escopo Persona Selecionada.",
        scope_choice_global: "Global",
        scope_choice_persona: "Persona Selecionada",
        scope_choice_all: "Todas as Personas",
      },
    },
  },
};
