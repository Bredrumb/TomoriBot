export default {
  quota: {
    description: `Gerencie as redefinições de cota de geração.`,
    reset: {
      description: `Redefina um pool de cota para geração de imagem, texto ou vídeo.`,
      user: {
        description: `Redefina o uso diário de cota para um usuário.`,
        member_description: `O membro cuja cota diária deve ser redefinida.`,
        quota_type_description: `Escolha qual tipo de pool de cota redefinir.`,
        image_option: `Geração de Imagens`,
        text_option: `Geração de Texto`,
        video_option: `Geração de Vídeos`,
        success_title: `Cota Redefinida`,
        success_image_description: `Redefinido o uso diário de cota de geração de imagem para {user}.`,
        success_text_description: `Redefinido o uso diário de cota de gatilho de geração de texto para {user}.`,
        success_video_description: `Redefinido o uso diário de cota de geração de vídeo para {user}.`,
      },
      global: {
        description: `Redefina o pool de cota de geração para todo o servidor.`,
        quota_type_description: `Escolha qual tipo de pool de cota redefinir.`,
        image_option: `Geração de Imagens`,
        text_option: `Geração de Texto`,
        video_option: `Geração de Vídeos`,
        success_title: `Cota Redefinida`,
        success_image_description: `Redefinido o pool de cota de geração de imagem de todo o servidor.`,
        success_text_description: `Redefinido o pool de cota de gatilho de geração de texto de todo o servidor.`,
        success_video_description: `Redefinido o pool de cota de geração de vídeo de todo o servidor.`,
      },
    },
  },
};
