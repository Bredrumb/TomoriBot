export default {
  forget: {
    sampledialogue: {
      description: `Elimina un par de diálogo de muestra entre usuario/bot de mi memoria.`,
    },
    attribute: {
      description: `Elimina un atributo de personalidad de mi memoria.`,
    },
    document: {
      description: `Elimina un documento de la base de conocimientos del servidor.`,
    },
    personaprompt: {
      description: `Borra un prompt específico de persona`,
      no_prompt_title: `Sin prompt de persona`,
      no_prompt_description: `No hay un prompt específico de persona para borrar. Establece uno con \`/config\` > Persona > Avanzado.`,
      success_title: `Prompt de persona borrado`,
      success_description: `Prompt de persona borrado para "{persona_name}".`,
      success_description_with_prompt: `Prompt de persona borrado para "{persona_name}". Aquí está en caso de que quieras guardar una copia:\n\`\`\`\n{removed_prompt}\n\`\`\``,
    },
    memory: {
      personal: {
        description: `Elimina una memoria personal.`,
      },
      server: {
        description: `Elimina una memoria del servidor de mi conocimiento.`,
      },
    },
  },
};
