export default {
  reset: {
    description: "Restablece la configuración del servidor o personal a los valores predeterminados.",
    config: {
      description: "Restablece la configuración de este servidor a los valores predeterminados de la base de datos.",
      confirm_title: "Restablecer configuración del servidor",
      confirm_description:
        "> Esto restaura la configuración del servidor a los valores predeterminados de la base de datos.\n> Los prompts, notas y listas de etiquetas escritos se restablecerán.\n\n**Secciones afectadas:**\n> • Persona: 0 configuraciones (todas las personas se conservan)\n> • Comportamiento: 9 configuraciones (prompt de sistema, notas, activaciones)\n> • Canales: 6 configuraciones (reglas de canal, activaciones automáticas)\n> • Permisos: 11 configuraciones (capacidades, permisos)\n> • Modelos: 3 configuraciones (muestreadores, respaldos; los ID se conservan)\n\n**No se modifica:**\n> Personas: {persona_remove}\n> Memorias: {memories} o {personal_memories}\n> Proveedores: {providers} o {personal_providers}\n> Tareas programadas: {scheduled_task_remove}\n> Borrado total del servidor: {nuke}\nEl consumo de cuota registrado y las integraciones externas se mantienen intactos.",
      confirm_button: "Restablecer configuración",
      no_permission_title: "Permiso denegado",
      no_permission_description:
        "Necesitas el permiso Administrar servidor para restablecer la configuración de este servidor.",
      no_server_data_title: "Sin datos del servidor",
      no_server_data_description: "No se encontró configuración para este servidor.",
      success_title: "Configuración restablecida",
      success_description:
        "La configuración del servidor se restableció a los valores predeterminados de la base de datos.",
    },
    personal: {
      description: "Comandos de configuración personal.",
      config: {
        description: "Restablece tu configuración personal a los valores predeterminados de la base de datos.",
        confirm_title: "Restablecer configuración personal",
        confirm_description:
          "> Esto restaura la configuración personal a los valores predeterminados de la base de datos.\n\n**Secciones afectadas:**\n> • Perfil: apodo, apariencia, género, pronombres\n> • Privacidad: nivel de privacidad, participación entre servidores\n> • Avanzado: modo de respuesta, suplantación, spotlights\n> • Modelos: 0 configuraciones (toda la configuración de proveedores se conserva)\n\n**No se modifica:**\n> Proveedores: {personal_providers}\n> Memorias: {personal_memories}\n> Tareas programadas: {scheduled_task_remove}\nLas configuraciones de proveedor guardadas, los endpoints personalizados y otros datos personales se mantienen intactos.",
        confirm_button: "Restablecer configuración",
        success_title: "Configuración personal restablecida",
        success_description:
          "La configuración personal y los spotlights de canal se restablecieron a los valores predeterminados de la base de datos.",
      },
    },
  },
};
