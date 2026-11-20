export default {
  teach: {
    sampledialogue: {
      description: `Añade un par de diálogo de muestra entre usuario/bot como un ejemplo de cómo debo responder.`,
    },
    attribute: {
      description: `Añade un atributo de personalidad que me describa para este servidor.`,
    },
    document: {
      description: `Sube un documento para que lo consulte usando generación aumentada por recuperación.`,
      main_persona_description: `Persona principal`,
      alter_persona_description: `Alter`,
    },
    personaprompt: {
      description: `Establece un prompt específico de persona adjunto después del sysprompt`,
      modal_title: `Establecer prompt de persona`,
      part1_placeholder: `Ejemplo: Habla como un táctico veterano, conciso y tranquilo.`,
      part2_placeholder: `Más instrucciones para la persona...`,
      part3_placeholder: `Más instrucciones para la persona...`,
      part4_placeholder: `Instrucciones finales para la persona...`,
      success_title: `Prompt de persona actualizado`,
      success_description: `Se actualizó el prompt de la persona para "{persona_name}".`,
    },
    memory: {
      description: `Administra mis memorias`,
      personal: {
        description: `Añade una memoria personal sobre ti que podré recordar en cualquier servidor.`,
      },
      server: {
        description: `Añade una memoria del servidor a mi base de conocimientos.`,
      },
    },
  },
};
