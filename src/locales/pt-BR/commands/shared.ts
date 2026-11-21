export default {
  shared: {
    character_reference: {
      invalid_image_title: `Imagem Inválida`,
      invalid_image_description: `Por favor, envie um anexo de imagem para a referência de personagem.`,
      download_failed_title: `Falha no Download`,
      download_failed_description: `Falha ao baixar o anexo de imagem selecionado. Por favor, tente novamente.`,
      conversion_failed_title: `Falha na Conversão da Imagem`,
      conversion_failed_description: `Não foi possível converter essa imagem para PNG para armazenamento. Por favor, tente uma imagem diferente.`,
      success_title: `Referência de Personagem Atualizada`,
      success_me_description: `Sua imagem de referência de personagem foi atualizada.`,
      success_persona_description: `A imagem de referência de personagem de **{persona_name}** foi atualizada.`,
      cleared_title: `Referência de Personagem Removida`,
      cleared_me_description: `Sua imagem de referência de personagem foi removida.`,
      cleared_persona_description: `A imagem de referência de personagem de **{persona_name}** foi removida.`,
    },
    rag: {
      disabled_title: `RAG de Documento Desativado`,
      disabled_description: `A recuperação de documentos requer a extensão do PostgreSQL [pgvector](https://github.com/pgvector/pgvector) no seu banco de dados. Instale o pgvector e reinicie-me para ativá-lo (veja o [guia de configuração de hospedagem própria](https://docs.tomoribot.app/pt-BR/self-hosting/manual-setup/)).`,
    },
    persona_select: {
      main_persona_description: `Persona Principal`,
      alter_persona_description: `Alterar Persona`,
    },
  },
};
