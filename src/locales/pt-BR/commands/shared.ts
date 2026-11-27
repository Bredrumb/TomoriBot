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
    send_blocked: {
      cannot_send_title: `Não Posso Enviar Mensagens Aqui`,
      cannot_send_description: `Preciso das permissões **Ver Canal** e **Enviar Mensagens** neste canal (ou **Enviar Mensagens em Tópicos** em um tópico) para responder ao chat aqui, e pelo menos uma está faltando. Peça a um gerente do servidor que conceda ambas.`,
      missing_permissions_description: `Não consegui ler minhas próprias permissões neste canal, então não estou respondendo ao chat aqui. Tente novamente em instantes e, se isso continuar acontecendo, verifique as permissões do meu cargo.`,
      timed_out_title: `Estou de Castigo`,
      timed_out_description: `Um moderador me colocou de castigo neste servidor, então o Discord bloqueia minhas mensagens até {time}. Remova o castigo do meu perfil de membro se quiser que eu responda antes.`,
      send_refused_title: `O Discord Recusou Minha Última Mensagem`,
      send_refused_description: `O Discord rejeitou minha última mensagem neste canal, geralmente porque uma permissão mudou ou fui colocada de castigo. Tentarei enviar neste canal novamente {time}.`,
    },
  },
};
