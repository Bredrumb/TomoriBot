export default {
  shared: {
    character_reference: {
      invalid_image_title: `Imagen no válida`,
      invalid_image_description: `Por favor, sube un archivo adjunto de imagen para la referencia de personaje.`,
      download_failed_title: `Error al descargar`,
      download_failed_description: `No se pudo descargar la imagen adjunta seleccionada. Por favor, intenta de nuevo.`,
      conversion_failed_title: `Error de conversión de imagen`,
      conversion_failed_description: `No pude convertir esa imagen a PNG para almacenarla. Por favor, intenta con otra imagen.`,
      success_title: `Referencia de personaje actualizada`,
      success_me_description: `Se actualizó tu imagen de referencia de personaje.`,
      success_persona_description: `Se actualizó la imagen de referencia de personaje de **{persona_name}**.`,
      cleared_title: `Referencia de personaje eliminada`,
      cleared_me_description: `Se eliminó tu imagen de referencia de personaje.`,
      cleared_persona_description: `Se eliminó la imagen de referencia de personaje de **{persona_name}**.`,
    },
    rag: {
      disabled_title: `RAG de documentos deshabilitado`,
      disabled_description: `La recuperación de documentos requiere la extensión [pgvector](https://github.com/pgvector/pgvector) para PostgreSQL en tu base de datos. Instala pgvector y reiníciame para habilitarlo (revisa la [guía de autoalojamiento](https://docs.tomoribot.app/es-419/self-hosting/manual-setup/)).`,
    },
    persona_select: {
      main_persona_description: `Persona principal`,
      alter_persona_description: `Alter`,
    },
    send_blocked: {
      cannot_send_title: `No puedo enviar mensajes aquí`,
      cannot_send_description: `Necesito **Ver canal** y **Enviar mensajes** en este canal (o **Enviar mensajes en hilos** en un hilo) para responder al chat aquí, y falta al menos uno. Pídele a un administrador del servidor que conceda ambos.`,
      missing_permissions_description: `No pude leer mis propios permisos en este canal, así que no responderé al chat aquí. Inténtalo de nuevo en un momento y, si esto sigue ocurriendo, revisa los permisos de mi rol.`,
      timed_out_title: `Tengo una suspensión temporal`,
      timed_out_description: `Un moderador me aplicó una suspensión temporal en este servidor, así que Discord bloquea mis mensajes hasta {time}. Quita la suspensión desde mi perfil de miembro si quieres que responda antes.`,
      send_refused_title: `Discord rechazó mi último mensaje`,
      send_refused_description: `Discord rechazó mi último mensaje en este canal, normalmente porque cambió un permiso o recibí una suspensión temporal. Volveré a intentar en este canal {time}.`,
    },
  },
};
