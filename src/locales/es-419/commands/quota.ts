export default {
  quota: {
    description: `Administra los reinicios de cuotas de generación.`,
    reset: {
      description: `Reinicia un fondo de cuota para generación de imágenes, texto o video.`,
      user: {
        description: `Reinicia el uso de la cuota diaria para un usuario.`,
        member_description: `El miembro cuya cuota diaria debe ser reiniciada.`,
        quota_type_description: `Elige qué tipo de fondo de cuota reiniciar.`,
        image_option: `Generación de imágenes`,
        text_option: `Generación de texto`,
        video_option: `Generación de video`,
        success_title: `Cuota reiniciada`,
        success_image_description: `Se reinició el uso de cuota diaria de generación de imágenes para {user}.`,
        success_text_description: `Se reinició el uso de cuota diaria de generación de texto para {user}.`,
        success_video_description: `Se reinició el uso de cuota diaria de generación de video para {user}.`,
      },
      global: {
        description: `Reinicia el fondo de cuota de generación a nivel de servidor.`,
        quota_type_description: `Elige qué tipo de fondo de cuota reiniciar.`,
        image_option: `Generación de imágenes`,
        text_option: `Generación de texto`,
        video_option: `Generación de video`,
        success_title: `Cuota reiniciada`,
        success_image_description: `Se reinició el fondo de cuota de generación de imágenes del servidor.`,
        success_text_description: `Se reinició el fondo de cuota de generación de texto del servidor.`,
        success_video_description: `Se reinició el fondo de cuota de generación de video del servidor.`,
      },
    },
  },
};
