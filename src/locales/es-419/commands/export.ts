export default {
  export: {
    description: "Exporta tu configuración o memorias como un archivo portátil.",
    config: {
      description: "Exporta la configuración de este servidor como un archivo portátil.",
    },
    memories: {
      description: "Exporta memorias como un archivo portátil.",
      scope_description: "Qué memorias exportar.",
      persona_description: "La persona de la que se exportarán las memorias. Solo usado por la persona seleccionada.",
      scope_choice_main: "Persona principal",
      scope_choice_persona: "Persona seleccionada",
      scope_choice_all: "Todas las personas",
    },
    personal: {
      description: "Exporta la configuración o memorias que posee tu cuenta.",
      config: {
        description: "Exporta tu configuración personal como un archivo portátil.",
      },
      memories: {
        description: "Exporta las memorias que posee tu cuenta como un archivo portátil.",
        scope_description: "Cuáles de tus memorias exportar.",
        persona_description: "La persona de la que se exportarán las memorias. Solo usado por la persona seleccionada.",
        scope_choice_global: "Global",
        scope_choice_persona: "Persona seleccionada",
        scope_choice_all: "Todas las personas",
      },
    },
  },
};
