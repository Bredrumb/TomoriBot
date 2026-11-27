export default {
  server: {
    timezone: {
      value_description: `Horas de desfase UTC (predeterminado: 0). Ejemplos: 8, -5, 0, 5:30.`,
    },
    stm: {
      parameters: {
        supersede_option: `Reemplazar (las categorías reemplazan los turnos sin procesar)`,
        crude_summary_option: `Sin procesar + resumen (mostrar ambos de forma aditiva)`,
      },
      "categories-edit": {
        slot_1_label: `Categoría 1`,
        slot_2_label: `Categoría 2`,
        slot_3_label: `Categoría 3`,
        slot_4_label: `Categoría 4`,
        slot_5_label: `Categoría 5`,
        slot_instructions: `Caja = "Etiqueta: Descripción" (ej. "Metas: objetivos de equipo"). Vacío se omite; borrar todos reinicia.`,
      },
    },
    "crosschannel-blocklist": {
      channel_label_forum: `{channel_name} [Foro]`,
      channel_label_media: `{channel_name} [Multimedia]`,
    },
    cooldown: {
      triggers: {
        cooldown_type_description: `Cómo se aplican los enfriamientos (predeterminado: apagado; por usuario, por canal, en todo el servidor).`,
        cooldown_length_description: `Duración del enfriamiento en segundos (1-86400, predeterminado: 5).`,
        type: {
          choice_off: `Apagado`,
          choice_per_user: `Por usuario`,
          choice_per_channel: `Por canal`,
          choice_server_wide: `En todo el servidor`,
          choice_strict_server_wide: `Estricto en todo el servidor`,
        },
      },
    },
    "member-permissions": {
      servermemories_option: `Memorias del servidor`,
      promptsnapshot_option: `Capturas de prompt`,
      personaexport_option: `Exportaciones de persona`,
      servermemories_desc: `Ver tus propias memorias del servidor, agregar nuevas y editar o eliminar las tuyas`,
      promptsnapshot_desc: `Ver prompts completos desde /context y /tool prompt snapshot`,
      personaexport_desc: `Exportar públicamente tarjetas y paquetes de persona con muestras de voz opcionales`,
      select_placeholder: `Elige qué pueden hacer los miembros conmigo`,
      select_embed_title: `Permisos de miembros del servidor`,
      select_embed_description: `Selecciona qué cosas pueden hacer los miembros que no son administradores. Marcado = permitido.`,
    },

    alwaysreply: {
      description: `Alternar el modo de respuesta siempre para la persona principal.`,
    },
    deliberatetriggermode: {
      description: `Alternar el modo de activación deliberada para este servidor.`,
    },
    deliberatetoolmode: {
      description: `Alternar el modo de herramientas deliberado para este servidor.`,
    },
    "deliberate-tool-mode": {
      description: `Alternar el modo de herramientas deliberado para este servidor.`,
    },
  },
};
